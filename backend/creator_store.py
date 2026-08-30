"""Persistent watchlist of creators to scan for viral content."""

from __future__ import annotations

import json
import os
import re
import threading
from copy import deepcopy
from typing import Optional


INSTAGRAM_HANDLE_RE = re.compile(
    r'(?:https?://)?(?:www\.)?instagram\.com/([A-Za-z0-9._]+)/?',
    re.IGNORECASE,
)
YOUTUBE_HANDLE_RE = re.compile(
    r'(?:https?://)?(?:www\.)?youtube\.com/@([A-Za-z0-9._-]+)',
    re.IGNORECASE,
)
YOUTUBE_CHANNEL_RE = re.compile(
    r'(?:https?://)?(?:www\.)?youtube\.com/(?:channel|c|user)/([A-Za-z0-9_-]+)',
    re.IGNORECASE,
)
HANDLE_RE = re.compile(r'^[A-Za-z0-9._]{1,30}$')


def parse_instagram_handle(value: str) -> Optional[str]:
    if not value:
        return None
    value = value.strip().strip('/')
    match = INSTAGRAM_HANDLE_RE.search(value)
    if match:
        return match.group(1)
    if HANDLE_RE.match(value.lstrip('@')):
        return value.lstrip('@')
    return None


def parse_youtube_ref(value: str) -> tuple[Optional[str], Optional[str]]:
    """Return (url, handle) from a YouTube URL or @handle."""
    if not value:
        return None, None
    value = value.strip()
    handle_match = YOUTUBE_HANDLE_RE.search(value)
    if handle_match:
        handle = handle_match.group(1)
        return f'https://www.youtube.com/@{handle}', handle
    channel_match = YOUTUBE_CHANNEL_RE.search(value)
    if channel_match:
        kind = 'channel' if '/channel/' in value.lower() else (
            'c' if '/c/' in value.lower() else 'user'
        )
        slug = channel_match.group(1)
        return f'https://www.youtube.com/{kind}/{slug}', None
    if value.startswith('@') and HANDLE_RE.match(value[1:]):
        handle = value[1:]
        return f'https://www.youtube.com/@{handle}', handle
    if HANDLE_RE.match(value) and 'instagram' not in value.lower():
        return f'https://www.youtube.com/@{value}', value
    return None, None


def instagram_url(handle: str) -> str:
    return f'https://www.instagram.com/{handle}/'


class CreatorStore:
    def __init__(self, data_dir: str, seed_path: Optional[str] = None):
        self.data_dir = data_dir
        self.store_path = os.path.join(data_dir, 'creators.json')
        self.seed_path = seed_path or os.path.join(data_dir, 'creators.seed.json')
        self._lock = threading.Lock()
        os.makedirs(data_dir, exist_ok=True)
        self._ensure_store()

    def _ensure_store(self):
        if os.path.exists(self.store_path):
            return
        if os.path.exists(self.seed_path):
            with open(self.seed_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = {'niches': [], 'creators': []}
        self._write(data)

    def _read(self) -> dict:
        with open(self.store_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _write(self, data: dict):
        tmp_path = self.store_path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        os.replace(tmp_path, self.store_path)

    def snapshot(self) -> dict:
        with self._lock:
            return deepcopy(self._read())

    def list_creators(self) -> list:
        return self.snapshot()['creators']

    def list_niches(self) -> list:
        return self.snapshot()['niches']

    def get_creator(self, creator_id: str) -> Optional[dict]:
        for creator in self.list_creators():
            if creator['id'] == creator_id:
                return creator
        return None

    def add_creator(self, payload: dict) -> dict:
        instagram_handle = parse_instagram_handle(
            payload.get('instagram_handle') or payload.get('instagram_url') or ''
        )
        youtube_url, youtube_handle = parse_youtube_ref(
            payload.get('youtube_url') or payload.get('youtube_handle') or ''
        )

        # A single pasted URL can be IG or YouTube.
        raw_url = (payload.get('url') or '').strip()
        if raw_url:
            ig_from_url = parse_instagram_handle(raw_url)
            yt_url, yt_handle = parse_youtube_ref(raw_url)
            if ig_from_url and not instagram_handle:
                instagram_handle = ig_from_url
            if yt_url and not youtube_url:
                youtube_url, youtube_handle = yt_url, yt_handle

        if not instagram_handle and not youtube_url:
            raise ValueError('Provide an Instagram handle/URL or a YouTube URL')

        creator_id = (
            payload.get('id')
            or instagram_handle
            or (youtube_handle.lower() if youtube_handle else None)
        )
        if not creator_id:
            creator_id = youtube_url.rstrip('/').split('/')[-1]

        name = (payload.get('name') or '').strip() or (
            instagram_handle or youtube_handle or creator_id
        )
        niche = (payload.get('niche') or 'General').strip() or 'General'

        with self._lock:
            data = self._read()
            existing_ids = {c['id'] for c in data['creators']}
            if creator_id in existing_ids:
                raise ValueError(f'Creator {creator_id} is already on the watchlist')

            existing_ig = {
                (c.get('instagram_handle') or '').lower()
                for c in data['creators']
                if c.get('instagram_handle')
            }
            if instagram_handle and instagram_handle.lower() in existing_ig:
                raise ValueError(f'@{instagram_handle} is already on the watchlist')

            creator = {
                'id': creator_id,
                'name': name,
                'niche': niche,
                'instagram_handle': instagram_handle,
                'youtube_url': youtube_url,
                'youtube_handle': youtube_handle,
            }
            data['creators'].append(creator)
            self._sync_niche(data, niche)
            self._write(data)
            return deepcopy(creator)

    def update_creator(self, creator_id: str, payload: dict) -> dict:
        with self._lock:
            data = self._read()
            for index, creator in enumerate(data['creators']):
                if creator['id'] != creator_id:
                    continue
                updated = deepcopy(creator)
                if 'name' in payload and payload['name']:
                    updated['name'] = payload['name'].strip()
                if 'niche' in payload and payload['niche']:
                    updated['niche'] = payload['niche'].strip()
                if 'instagram_handle' in payload or 'instagram_url' in payload:
                    updated['instagram_handle'] = parse_instagram_handle(
                        payload.get('instagram_handle') or payload.get('instagram_url') or ''
                    )
                if 'youtube_url' in payload or 'youtube_handle' in payload:
                    url, handle = parse_youtube_ref(
                        payload.get('youtube_url') or payload.get('youtube_handle') or ''
                    )
                    updated['youtube_url'] = url
                    updated['youtube_handle'] = handle
                data['creators'][index] = updated
                self._sync_niche(data, updated['niche'])
                self._write(data)
                return deepcopy(updated)
        raise KeyError(f'Creator {creator_id} not found')

    def delete_creator(self, creator_id: str) -> bool:
        with self._lock:
            data = self._read()
            before = len(data['creators'])
            data['creators'] = [c for c in data['creators'] if c['id'] != creator_id]
            if len(data['creators']) == before:
                return False
            self._write(data)
            return True

    def _sync_niche(self, data: dict, niche_name: str):
        existing = {n['name'].lower() for n in data.get('niches', [])}
        if niche_name.lower() in existing:
            return
        slug = re.sub(r'[^a-z0-9]+', '-', niche_name.lower()).strip('-') or 'general'
        queries = [f'{niche_name} shorts', f'{niche_name} viral']
        data.setdefault('niches', []).append({
            'id': slug,
            'name': niche_name,
            'search_queries': queries,
        })
