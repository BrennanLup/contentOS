"""Zernio -> Slack notifications.

Receives Zernio inbox webhooks (new comments on posts, new DMs) and forwards
them to a Slack channel. Bot notifications include an editable reply modal;
the incoming webhook remains a notify-only fallback.

Environment variables:
  ZERNIO_API_KEY         Zernio API key (sk_...). Used to auto-register the
                         webhook subscription and to send replies.
  ZERNIO_WEBHOOK_SECRET  Shared secret for HMAC signature verification.
                         Strongly recommended; without it any request to the
                         endpoint is accepted.
  SLACK_BOT_TOKEN        Slack bot token (xoxb-...). Enables reply-from-Slack:
                         notifications are posted by the bot with metadata,
                         and a button opens an editable reply modal.
  INSTAGRAM_SLACK_CHANNEL_ID
                         Channel the bot posts to (C...). SLACK_CHANNEL_ID is
                         also supported as a generic override.
  SLACK_SIGNING_SECRET   Verifies that events on /api/webhooks/slack really
                         come from Slack.
  CLAUDE_API_KEY         Optional. Generates contextual draft replies using
                         Claude. Without it, the modal uses a safe generic
                         draft that can still be edited before sending.
  SLACK_WEBHOOK_URL      Legacy fallback: incoming webhook URL. Used only
                         when the bot token/channel are not set (notify-only,
                         no replies).
  PUBLIC_URL             Public base URL of this app. Falls back to
                         https://$RAILWAY_PUBLIC_DOMAIN on Railway.
"""

import hashlib
import hmac
import json
import logging
import os
import threading
from collections import OrderedDict

import requests

logger = logging.getLogger(__name__)

ZERNIO_API_BASE = 'https://zernio.com/api/v1'
WEBHOOK_NAME = 'contentOS Slack notifications'
WEBHOOK_PATH = '/api/webhooks/zernio'
SUBSCRIBED_EVENTS = ['comment.received', 'message.received']

PLATFORM_LABELS = {
    'instagram': 'Instagram',
    'facebook': 'Facebook',
    'twitter': 'X (Twitter)',
    'youtube': 'YouTube',
    'linkedin': 'LinkedIn',
    'bluesky': 'Bluesky',
    'reddit': 'Reddit',
    'tiktok': 'TikTok',
    'telegram': 'Telegram',
    'whatsapp': 'WhatsApp',
    'sms': 'SMS',
}

# Zernio delivers at-least-once; remember recent event IDs to avoid duplicate
# Slack pings. In-memory is fine: a restart at worst repeats a notification.
_seen_events = OrderedDict()
_seen_lock = threading.Lock()
_SEEN_MAX = 2000


def _already_seen(event_id):
    if not event_id:
        return False
    with _seen_lock:
        if event_id in _seen_events:
            return True
        _seen_events[event_id] = True
        while len(_seen_events) > _SEEN_MAX:
            _seen_events.popitem(last=False)
        return False


def verify_signature(raw_body, signature):
    """Returns (ok, reason). If no secret is configured, accepts everything."""
    secret = os.environ.get('ZERNIO_WEBHOOK_SECRET')
    if not secret:
        return True, 'no secret configured'
    if not signature:
        return False, 'missing X-Zernio-Signature header'
    computed = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, signature):
        return False, 'signature mismatch'
    return True, 'ok'


def _platform_label(platform):
    return PLATFORM_LABELS.get(platform, platform or 'unknown platform')


def _truncate(text, limit=280):
    text = (text or '').strip()
    if len(text) > limit:
        return text[: limit - 1] + '…'
    return text


def _format_comment(payload, draft):
    comment = payload.get('comment') or {}
    post = payload.get('post') or {}
    account = payload.get('account') or {}

    author = comment.get('author') or {}
    if author.get('isOwnAccount'):
        return None  # Meta re-delivers your own replies as comment events

    who = author.get('username') or author.get('name') or 'someone'
    platform = _platform_label(comment.get('platform') or account.get('platform'))
    text = _truncate(comment.get('text'))
    kind = 'Reply to a comment' if comment.get('isReply') else 'New comment'

    lines = [f':speech_balloon: *{kind} on {platform}* from *{who}*']
    if text:
        lines.append(f'>{text}')

    context_bits = []
    post_snippet = _truncate(post.get('content'), 80)
    if post_snippet:
        context_bits.append(f'On: “{post_snippet}”')
    if post.get('permalink'):
        context_bits.append(f'<{post["permalink"]}|View post>')
    if account.get('username'):
        context_bits.append(f'Account: @{account["username"]}')
    if _bot_mode_enabled():
        context_bits.append('Review the draft before sending')

    blocks = [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': '\n'.join(lines)}}]
    if context_bits:
        blocks.append({
            'type': 'context',
            'elements': [{'type': 'mrkdwn', 'text': ' · '.join(context_bits)}],
        })
    metadata = {
        'kind': 'comment',
        'account_id': account.get('id') or account.get('accountId'),
        'platform_post_id': comment.get('platformPostId'),
        'comment_id': comment.get('id'),
    }
    if _bot_mode_enabled():
        blocks.append({
            'type': 'actions',
            'elements': [{
                'type': 'button',
                'action_id': 'zernio_review_reply',
                'text': {'type': 'plain_text', 'text': 'Review & reply'},
                'style': 'primary',
                'value': _reply_action_value(
                    metadata,
                    draft,
                    text,
                    f'{kind} from {who} on {platform}',
                ),
            }],
        })
    fallback = f'{kind} on {platform} from {who}: {text}'
    return {
        'text': fallback,
        'blocks': blocks,
        'metadata': metadata,
    }


def _format_message(payload, draft):
    message = payload.get('message') or {}
    conversation = payload.get('conversation') or {}
    account = payload.get('account') or {}

    if message.get('direction') == 'outgoing':
        return None

    sender = message.get('sender') or {}
    who = (
        sender.get('username')
        or sender.get('name')
        or conversation.get('participantName')
        or conversation.get('participantUsername')
        or 'someone'
    )
    platform = _platform_label(message.get('platform') or account.get('platform'))
    text = _truncate(message.get('text'))
    attachments = message.get('attachments') or []

    lines = [f':envelope: *New DM on {platform}* from *{who}*']
    if text:
        lines.append(f'>{text}')
    if attachments:
        kinds = ', '.join(a.get('type', 'file') for a in attachments)
        lines.append(f'_{len(attachments)} attachment(s): {kinds}_')

    context_bits = []
    if account.get('username'):
        context_bits.append(f'Account: @{account["username"]}')
    if _bot_mode_enabled():
        context_bits.append('Review the draft before sending')
    else:
        context_bits.append('Reply from the Zernio inbox')

    blocks = [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': '\n'.join(lines)}}]
    blocks.append({
        'type': 'context',
        'elements': [{'type': 'mrkdwn', 'text': ' · '.join(context_bits)}],
    })
    metadata = {
        'kind': 'dm',
        'account_id': account.get('id') or account.get('accountId'),
        'conversation_id': conversation.get('id'),
    }
    if _bot_mode_enabled():
        blocks.append({
            'type': 'actions',
            'elements': [{
                'type': 'button',
                'action_id': 'zernio_review_reply',
                'text': {'type': 'plain_text', 'text': 'Review & reply'},
                'style': 'primary',
                'value': _reply_action_value(
                    metadata,
                    draft,
                    text or '(attachment)',
                    f'DM from {who} on {platform}',
                ),
            }],
        })
    fallback = f'New DM on {platform} from {who}: {text or "(attachment)"}'
    return {
        'text': fallback,
        'blocks': blocks,
        'metadata': metadata,
    }


def _slack_channel_id():
    return os.environ.get('SLACK_CHANNEL_ID') or os.environ.get('INSTAGRAM_SLACK_CHANNEL_ID')


def _bot_mode_enabled():
    return bool(os.environ.get('SLACK_BOT_TOKEN') and _slack_channel_id())


def _reply_action_value(metadata, draft, incoming, title):
    value = {
        **metadata,
        'draft': _truncate(draft, 600),
        'incoming': _truncate(incoming, 500),
        'title': _truncate(title, 120),
    }
    return json.dumps(value, separators=(',', ':'))


def _fallback_draft(kind):
    if kind == 'comment':
        return 'Thanks for the comment!'
    return 'Thanks for reaching out!'


def _generate_draft(payload, kind):
    """Generate a short draft reply with Claude, or return a safe fallback."""
    api_key = os.environ.get('CLAUDE_API_KEY') or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return _fallback_draft(kind)

    if kind == 'comment':
        item = payload.get('comment') or {}
        post = payload.get('post') or {}
        author = item.get('author') or {}
        incoming = item.get('text') or ''
        sender = author.get('username') or author.get('name') or 'the commenter'
        context = f'Post: {post.get("content") or "(content unavailable)"}'
        channel = 'public social media comment'
    else:
        item = payload.get('message') or {}
        conversation = payload.get('conversation') or {}
        incoming = item.get('text') or '(attachment only)'
        sender_data = item.get('sender') or {}
        sender = (
            sender_data.get('username')
            or sender_data.get('name')
            or conversation.get('participantName')
            or 'the sender'
        )
        context = 'This is a private direct message.'
        channel = 'direct message'

    prompt = (
        'Write one concise, natural reply in Brennan’s voice. '
        'Be warm and conversational, not corporate. Do not use hashtags. '
        'Do not invent facts, commitments, links, prices, or availability. '
        'If context is insufficient, acknowledge the message without guessing. '
        'Return only the reply text, with no quotation marks or explanation.\n\n'
        f'Channel: {channel}\nFrom: {sender}\n{context}\nIncoming: {incoming}'
    )
    try:
        resp = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            json={
                'model': os.environ.get('CLAUDE_MODEL', 'claude-sonnet-4-6'),
                'max_tokens': 180,
                'messages': [{'role': 'user', 'content': prompt}],
            },
            timeout=20,
        )
        resp.raise_for_status()
        content = resp.json().get('content') or []
        draft = next((part.get('text', '').strip() for part in content if part.get('type') == 'text'), '')
        return _truncate(draft, 600) or _fallback_draft(kind)
    except (requests.RequestException, ValueError, KeyError):
        logger.exception('Failed to generate reply draft; using fallback')
        return _fallback_draft(kind)


def _slack_api(method, payload):
    token = os.environ.get('SLACK_BOT_TOKEN')
    resp = requests.post(
        f'https://slack.com/api/{method}',
        json=payload,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json; charset=utf-8'},
        timeout=10,
    )
    data = resp.json()
    if not data.get('ok'):
        logger.error('Slack %s failed: %s', method, data.get('error'))
    return data


def _send_to_slack(slack_payload):
    """Post a notification. Prefers the bot (threads + reply metadata); falls
    back to the incoming webhook, which can notify but not accept replies."""
    metadata = slack_payload.pop('metadata', None)

    if _bot_mode_enabled():
        body = {
            'channel': _slack_channel_id(),
            'text': slack_payload['text'],
            'unfurl_links': False,
        }
        if slack_payload.get('blocks'):
            body['blocks'] = slack_payload['blocks']
        if metadata:
            body['metadata'] = {'event_type': 'zernio_notification', 'event_payload': metadata}
        try:
            _slack_api('chat.postMessage', body)
        except requests.RequestException:
            logger.exception('Failed to post to Slack via bot')
        return

    url = os.environ.get('SLACK_WEBHOOK_URL')
    if not url:
        logger.warning('No Slack credentials set; dropping notification: %s', slack_payload.get('text'))
        return
    try:
        resp = requests.post(url, json=slack_payload, timeout=10)
        if resp.status_code != 200:
            logger.error('Slack webhook returned %s: %s', resp.status_code, resp.text[:200])
    except requests.RequestException:
        logger.exception('Failed to post to Slack')


def _build_and_send_notification(payload):
    event = payload.get('event')
    if event == 'comment.received':
        slack_payload = _format_comment(payload, _generate_draft(payload, 'comment'))
    elif event == 'message.received':
        slack_payload = _format_message(payload, _generate_draft(payload, 'dm'))
    else:
        return
    if slack_payload is not None:
        _send_to_slack(slack_payload)


def handle_event(payload):
    """Process a verified Zernio webhook payload. Returns a short status string."""
    event = payload.get('event')

    if event == 'webhook.test':
        _send_to_slack({'text': ':white_check_mark: Zernio webhook test received — Slack notifications are wired up.'})
        return 'test acknowledged'

    if _already_seen(payload.get('id')):
        return 'duplicate ignored'

    if event not in ('comment.received', 'message.received'):
        return f'ignored event {event}'

    if event == 'comment.received' and ((payload.get('comment') or {}).get('author') or {}).get('isOwnAccount'):
        return 'skipped (own/outgoing activity)'
    if event == 'message.received' and (payload.get('message') or {}).get('direction') == 'outgoing':
        return 'skipped (own/outgoing activity)'

    # Draft generation can take several seconds. Do it after acknowledging
    # Zernio's webhook so its 5-second delivery timeout is never hit.
    threading.Thread(target=_build_and_send_notification, args=(payload,), daemon=True).start()
    return 'notified'


def verify_slack_signature(raw_body, timestamp, signature):
    """Verify Slack's v0 request signature. Returns (ok, reason)."""
    secret = os.environ.get('SLACK_SIGNING_SECRET')
    if not secret:
        return True, 'no signing secret configured'
    if not timestamp or not signature:
        return False, 'missing Slack signature headers'
    import time
    try:
        if abs(time.time() - float(timestamp)) > 300:
            return False, 'stale timestamp'
    except ValueError:
        return False, 'invalid timestamp'
    base = b'v0:' + timestamp.encode() + b':' + raw_body
    computed = 'v0=' + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, signature):
        return False, 'signature mismatch'
    return True, 'ok'


def _unescape_slack(text):
    return text.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')


def _send_zernio_reply(meta, text):
    """Send a Slack thread reply back through Zernio. Returns (ok, detail)."""
    api_key = os.environ.get('ZERNIO_API_KEY')
    if not api_key:
        return False, 'ZERNIO_API_KEY not set'
    headers = {'Authorization': f'Bearer {api_key}'}

    try:
        if meta.get('kind') == 'comment':
            post_id = meta.get('platform_post_id')
            if not post_id:
                return False, 'notification is missing the post ID'
            body = {'accountId': meta.get('account_id'), 'message': text}
            if meta.get('comment_id'):
                body['commentId'] = meta['comment_id']
            resp = requests.post(
                f'{ZERNIO_API_BASE}/inbox/comments/{post_id}',
                headers=headers, json=body, timeout=20,
            )
        elif meta.get('kind') == 'dm':
            conversation_id = meta.get('conversation_id')
            if not conversation_id:
                return False, 'notification is missing the conversation ID'
            resp = requests.post(
                f'{ZERNIO_API_BASE}/inbox/conversations/{conversation_id}/messages',
                headers=headers,
                json={'accountId': meta.get('account_id'), 'message': text},
                timeout=20,
            )
        else:
            return False, 'unknown notification type'
    except requests.RequestException as exc:
        return False, f'request failed: {exc}'

    if resp.status_code >= 300:
        return False, f'Zernio returned {resp.status_code}: {resp.text[:200]}'
    return True, 'sent'


def _reply_modal(action_data, channel_id, message_ts):
    metadata = {
        key: action_data.get(key)
        for key in ('kind', 'account_id', 'platform_post_id', 'comment_id', 'conversation_id')
    }
    metadata.update({'channel_id': channel_id, 'message_ts': message_ts})
    return {
        'type': 'modal',
        'callback_id': 'zernio_reply_modal',
        'private_metadata': json.dumps(metadata, separators=(',', ':')),
        'title': {'type': 'plain_text', 'text': 'Review reply'},
        'submit': {'type': 'plain_text', 'text': 'Send reply'},
        'close': {'type': 'plain_text', 'text': 'Cancel'},
        'blocks': [
            {
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': f'*{action_data.get("title") or "Incoming message"}*\n>{_truncate(action_data.get("incoming"), 500)}',
                },
            },
            {
                'type': 'input',
                'block_id': 'reply_block',
                'label': {'type': 'plain_text', 'text': 'Reply'},
                'element': {
                    'type': 'plain_text_input',
                    'action_id': 'reply_input',
                    'multiline': True,
                    'initial_value': action_data.get('draft') or '',
                    'focus_on_load': True,
                },
            },
        ],
    }


def _finish_modal_reply(meta, text):
    ok, detail = _send_zernio_reply(meta, text)
    channel = meta.get('channel_id')
    message_ts = meta.get('message_ts')
    if ok:
        _slack_api('chat.postMessage', {
            'channel': channel,
            'thread_ts': message_ts,
            'text': f':white_check_mark: Reply sent:\n>{text}',
        })
    else:
        logger.error('Zernio reply failed: %s', detail)
        _slack_api('chat.postMessage', {
            'channel': channel,
            'thread_ts': message_ts,
            'text': f':x: Could not send the reply: {detail}',
        })


def handle_slack_interaction(payload):
    """Open the review modal and handle its explicit send submission."""
    payload_type = payload.get('type')
    if payload_type == 'block_actions':
        action = (payload.get('actions') or [{}])[0]
        if action.get('action_id') != 'zernio_review_reply':
            return {'status': 'ignored'}
        try:
            action_data = json.loads(action.get('value') or '{}')
        except ValueError:
            return {'status': 'invalid action data'}
        channel_id = (payload.get('channel') or {}).get('id')
        message_ts = (payload.get('container') or {}).get('message_ts')
        result = _slack_api('views.open', {
            'trigger_id': payload.get('trigger_id'),
            'view': _reply_modal(action_data, channel_id, message_ts),
        })
        return {'status': 'opened' if result.get('ok') else f"error: {result.get('error')}"}

    if payload_type == 'view_submission':
        view = payload.get('view') or {}
        if view.get('callback_id') != 'zernio_reply_modal':
            return {'status': 'ignored'}
        try:
            meta = json.loads(view.get('private_metadata') or '{}')
        except ValueError:
            return {
                'response_action': 'errors',
                'errors': {'reply_block': 'Reply context is invalid. Close this modal and try again.'},
            }
        text = (
            ((view.get('state') or {}).get('values') or {})
            .get('reply_block', {})
            .get('reply_input', {})
            .get('value', '')
            .strip()
        )
        if not text:
            return {'response_action': 'errors', 'errors': {'reply_block': 'Enter a reply before sending.'}}
        threading.Thread(target=_finish_modal_reply, args=(meta, text), daemon=True).start()
        return {'response_action': 'clear'}

    return {'status': 'ignored'}


def handle_slack_event(payload):
    """Handle Slack Events API requests without auto-sending thread replies."""
    if payload.get('type') == 'url_verification':
        return {'challenge': payload.get('challenge')}
    return {'status': 'ignored'}


def _public_webhook_url():
    base = os.environ.get('PUBLIC_URL')
    if not base:
        domain = os.environ.get('RAILWAY_PUBLIC_DOMAIN')
        if domain:
            base = f'https://{domain}'
    if not base:
        return None
    return base.rstrip('/') + WEBHOOK_PATH


def ensure_webhook_registered():
    """Create or update the Zernio webhook subscription to point at this app."""
    api_key = os.environ.get('ZERNIO_API_KEY')
    if not api_key:
        logger.info('ZERNIO_API_KEY not set; skipping Zernio webhook registration')
        return
    url = _public_webhook_url()
    if not url:
        logger.info('No PUBLIC_URL/RAILWAY_PUBLIC_DOMAIN; skipping Zernio webhook registration')
        return

    headers = {'Authorization': f'Bearer {api_key}'}
    secret = os.environ.get('ZERNIO_WEBHOOK_SECRET')

    try:
        resp = requests.get(f'{ZERNIO_API_BASE}/webhooks/settings', headers=headers, timeout=15)
        resp.raise_for_status()
        existing = next(
            (w for w in resp.json().get('webhooks', []) if w.get('name') == WEBHOOK_NAME),
            None,
        )

        body = {
            'name': WEBHOOK_NAME,
            'url': url,
            'events': SUBSCRIBED_EVENTS,
            'isActive': True,
        }
        if secret:
            body['secret'] = secret

        if existing:
            needs_update = (
                existing.get('url') != url
                or sorted(existing.get('events', [])) != sorted(SUBSCRIBED_EVENTS)
                or not existing.get('isActive', True)
                or bool(secret)  # re-assert the secret so env and Zernio stay in sync
            )
            if not needs_update:
                logger.info('Zernio webhook already registered at %s', url)
                return
            body['_id'] = existing.get('_id')
            resp = requests.put(f'{ZERNIO_API_BASE}/webhooks/settings', headers=headers, json=body, timeout=15)
        else:
            resp = requests.post(f'{ZERNIO_API_BASE}/webhooks/settings', headers=headers, json=body, timeout=15)

        resp.raise_for_status()
        logger.info('Zernio webhook registered: %s -> %s', WEBHOOK_NAME, url)
    except requests.RequestException as exc:
        logger.error('Zernio webhook registration failed: %s', exc)


def start_registration_thread():
    threading.Thread(target=ensure_webhook_registered, daemon=True).start()


_last_slack_test = [0.0]
_SLACK_TEST_COOLDOWN = 30  # seconds; endpoint is public, keep it un-spammable


def diagnostics(send_test=False):
    """Report integration health. Optionally posts a test message to Slack."""
    import time

    result = {
        'zernio_api_key_set': bool(os.environ.get('ZERNIO_API_KEY')),
        'webhook_secret_set': bool(os.environ.get('ZERNIO_WEBHOOK_SECRET')),
        'slack_webhook_url_set': bool(os.environ.get('SLACK_WEBHOOK_URL')),
        'slack_bot_token_set': bool(os.environ.get('SLACK_BOT_TOKEN')),
        'slack_channel_id_set': bool(_slack_channel_id()),
        'slack_channel_source': (
            'SLACK_CHANNEL_ID'
            if os.environ.get('SLACK_CHANNEL_ID')
            else 'INSTAGRAM_SLACK_CHANNEL_ID'
            if os.environ.get('INSTAGRAM_SLACK_CHANNEL_ID')
            else None
        ),
        'slack_signing_secret_set': bool(os.environ.get('SLACK_SIGNING_SECRET')),
        'reply_from_slack_enabled': _bot_mode_enabled(),
        'ai_drafts_enabled': bool(os.environ.get('CLAUDE_API_KEY') or os.environ.get('ANTHROPIC_API_KEY')),
        'expected_webhook_url': _public_webhook_url(),
    }

    if os.environ.get('SLACK_BOT_TOKEN'):
        try:
            auth = _slack_api('auth.test', {})
            result['slack_bot_auth'] = 'ok' if auth.get('ok') else f"error: {auth.get('error')}"
        except requests.RequestException as exc:
            result['slack_bot_auth'] = f'error: {exc}'

    api_key = os.environ.get('ZERNIO_API_KEY')
    if api_key:
        headers = {'Authorization': f'Bearer {api_key}'}
        try:
            resp = requests.get(f'{ZERNIO_API_BASE}/webhooks/settings', headers=headers, timeout=15)
            resp.raise_for_status()
            hook = next(
                (w for w in resp.json().get('webhooks', []) if w.get('name') == WEBHOOK_NAME),
                None,
            )
            if hook is None:
                # Self-heal: try to register now, then re-check.
                ensure_webhook_registered()
                resp = requests.get(f'{ZERNIO_API_BASE}/webhooks/settings', headers=headers, timeout=15)
                resp.raise_for_status()
                hook = next(
                    (w for w in resp.json().get('webhooks', []) if w.get('name') == WEBHOOK_NAME),
                    None,
                )
            result['zernio_webhook_registered'] = hook is not None
            if hook:
                result['zernio_webhook_url'] = hook.get('url')
                result['zernio_webhook_events'] = hook.get('events')
                result['zernio_webhook_active'] = hook.get('isActive')
        except requests.RequestException as exc:
            result['zernio_error'] = str(exc)

    if send_test:
        now = time.time()
        if now - _last_slack_test[0] < _SLACK_TEST_COOLDOWN:
            result['slack_test'] = 'rate limited, try again shortly'
        else:
            _last_slack_test[0] = now
            url = os.environ.get('SLACK_WEBHOOK_URL')
            if not url:
                result['slack_test'] = 'SLACK_WEBHOOK_URL not set'
            else:
                try:
                    resp = requests.post(
                        url,
                        json={'text': ':wave: contentOS test — Slack notifications are wired up.'},
                        timeout=10,
                    )
                    result['slack_test'] = f'{resp.status_code} {resp.text[:120]}'
                except requests.RequestException as exc:
                    result['slack_test'] = f'error: {exc}'

    return result
