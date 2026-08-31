"""Zernio -> Slack notifications.

Receives Zernio inbox webhooks (new comments on posts, new DMs) and forwards
them to a Slack channel via a Slack incoming webhook.

Environment variables:
  ZERNIO_API_KEY         Zernio API key (sk_...). Used once at startup to
                         auto-register the webhook subscription.
  ZERNIO_WEBHOOK_SECRET  Shared secret for HMAC signature verification.
                         Strongly recommended; without it any request to the
                         endpoint is accepted.
  SLACK_WEBHOOK_URL      Slack incoming webhook URL (https://hooks.slack.com/...).
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

    blocks = [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': '\n'.join(lines)}}]
    if context_bits:
        blocks.append({
            'type': 'context',
            'elements': [{'type': 'mrkdwn', 'text': ' · '.join(context_bits)}],
        })
    fallback = f'{kind} on {platform} from {who}: {text}'
    return {'text': fallback, 'blocks': blocks}


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
    context_bits.append('Reply from the Zernio inbox')

    blocks = [{'type': 'section', 'text': {'type': 'mrkdwn', 'text': '\n'.join(lines)}}]
    blocks.append({
        'type': 'context',
        'elements': [{'type': 'mrkdwn', 'text': ' · '.join(context_bits)}],
    })
    fallback = f'New DM on {platform} from {who}: {text or "(attachment)"}'
    return {'text': fallback, 'blocks': blocks}


def _send_to_slack(slack_payload):
    url = os.environ.get('SLACK_WEBHOOK_URL')
    if not url:
        logger.warning('SLACK_WEBHOOK_URL not set; dropping notification: %s', slack_payload.get('text'))
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
