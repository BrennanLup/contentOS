"""Zernio -> Slack notifications.

Receives Zernio inbox webhooks (new comments on posts, new DMs) and forwards
them to a Slack channel via a Slack incoming webhook.

Environment variables:
  ZERNIO_API_KEY         Zernio API key (sk_...). Used to auto-register the
                         webhook subscription and to send replies.
  ZERNIO_WEBHOOK_SECRET  Shared secret for HMAC signature verification.
                         Strongly recommended; without it any request to the
                         endpoint is accepted.
  SLACK_BOT_TOKEN        Slack bot token (xoxb-...). Enables reply-from-Slack:
                         notifications are posted by the bot with metadata,
                         and thread replies are sent back through Zernio.
  SLACK_CHANNEL_ID       Channel the bot posts to (C...). Required with the
                         bot token.
  SLACK_SIGNING_SECRET   Verifies that events on /api/webhooks/slack really
                         come from Slack.
  SLACK_WEBHOOK_URL      Legacy fallback: incoming webhook URL. Used only
                         when the bot token/channel are not set (notify-only,
                         no replies).
  PUBLIC_URL             Public base URL of this app. Falls back to
                         https://$RAILWAY_PUBLIC_DOMAIN on Railway.
"""

import hashlib
import hmac
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


def _format_comment(payload):
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
        context_bits.append('Reply in this thread to answer publicly')

    blocks = [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': '\n'.join(lines)}}]
    if context_bits:
        blocks.append({
            'type': 'context',
            'elements': [{'type': 'mrkdwn', 'text': ' · '.join(context_bits)}],
        })
    fallback = f'{kind} on {platform} from {who}: {text}'
    return {
        'text': fallback,
        'blocks': blocks,
        'metadata': {
            'kind': 'comment',
            'account_id': account.get('id') or account.get('accountId'),
            'platform_post_id': comment.get('platformPostId'),
            'comment_id': comment.get('id'),
        },
    }


def _format_message(payload):
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
        context_bits.append('Reply in this thread to answer the DM')
    else:
        context_bits.append('Reply from the Zernio inbox')

    blocks = [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': '\n'.join(lines)}}]
    blocks.append({
        'type': 'context',
        'elements': [{'type': 'mrkdwn', 'text': ' · '.join(context_bits)}],
    })
    fallback = f'New DM on {platform} from {who}: {text or "(attachment)"}'
    return {
        'text': fallback,
        'blocks': blocks,
        'metadata': {
            'kind': 'dm',
            'account_id': account.get('id') or account.get('accountId'),
            'conversation_id': conversation.get('id'),
        },
    }


def _bot_mode_enabled():
    return bool(os.environ.get('SLACK_BOT_TOKEN') and os.environ.get('SLACK_CHANNEL_ID'))


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
            'channel': os.environ.get('SLACK_CHANNEL_ID'),
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


def handle_event(payload):
    """Process a verified Zernio webhook payload. Returns a short status string."""
    event = payload.get('event')

    if event == 'webhook.test':
        _send_to_slack({'text': ':white_check_mark: Zernio webhook test received — Slack notifications are wired up.'})
        return 'test acknowledged'

    if _already_seen(payload.get('id')):
        return 'duplicate ignored'

    if event == 'comment.received':
        slack_payload = _format_comment(payload)
    elif event == 'message.received':
        slack_payload = _format_message(payload)
    else:
        return f'ignored event {event}'

    if slack_payload is None:
        return 'skipped (own/outgoing activity)'

    # Post from a thread so the webhook is acknowledged well inside Zernio's
    # 5-second delivery timeout.
    threading.Thread(target=_send_to_slack, args=(slack_payload,), daemon=True).start()
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


def _process_slack_reply(event):
    channel = event.get('channel')
    thread_ts = event.get('thread_ts')
    reply_ts = event.get('ts')
    try:
        # Fetch the parent notification to read the Zernio IDs off its metadata.
        token = os.environ.get('SLACK_BOT_TOKEN')
        resp = requests.get(
            'https://slack.com/api/conversations.replies',
            params={'channel': channel, 'ts': thread_ts, 'limit': 1, 'include_all_metadata': 'true'},
            headers={'Authorization': f'Bearer {token}'},
            timeout=10,
        )
        data = resp.json()
        if not data.get('ok'):
            logger.error('conversations.replies failed: %s', data.get('error'))
            return
        parent = (data.get('messages') or [{}])[0]
        meta_wrapper = parent.get('metadata') or {}
        if meta_wrapper.get('event_type') != 'zernio_notification':
            return  # a thread on some unrelated message; not ours to handle

        meta = meta_wrapper.get('event_payload') or {}
        text = _unescape_slack((event.get('text') or '').strip())
        if not text:
            _slack_api('chat.postMessage', {
                'channel': channel, 'thread_ts': thread_ts,
                'text': ':x: Empty reply — nothing was sent.',
            })
            return

        ok, detail = _send_zernio_reply(meta, text)
        if ok:
            _slack_api('reactions.add', {'channel': channel, 'name': 'white_check_mark', 'timestamp': reply_ts})
        else:
            logger.error('Zernio reply failed: %s', detail)
            _slack_api('chat.postMessage', {
                'channel': channel, 'thread_ts': thread_ts,
                'text': f':x: Could not send the reply: {detail}',
            })
    except requests.RequestException:
        logger.exception('Failed processing Slack reply')


def handle_slack_event(payload):
    """Handle a verified Slack Events API request. Returns a JSON-able dict."""
    if payload.get('type') == 'url_verification':
        return {'challenge': payload.get('challenge')}
    if payload.get('type') != 'event_callback':
        return {'status': 'ignored'}
    if _already_seen('slack:' + (payload.get('event_id') or '')):
        return {'status': 'duplicate ignored'}

    event = payload.get('event') or {}
    if event.get('type') != 'message' or event.get('bot_id') or event.get('subtype'):
        return {'status': 'ignored'}
    thread_ts = event.get('thread_ts')
    if not thread_ts or thread_ts == event.get('ts'):
        return {'status': 'not a thread reply'}

    # Ack fast (Slack retries after 3s); do the Zernio call in the background.
    threading.Thread(target=_process_slack_reply, args=(event,), daemon=True).start()
    return {'status': 'processing'}


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
        'slack_channel_id_set': bool(os.environ.get('SLACK_CHANNEL_ID')),
        'slack_signing_secret_set': bool(os.environ.get('SLACK_SIGNING_SECRET')),
        'reply_from_slack_enabled': _bot_mode_enabled(),
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
