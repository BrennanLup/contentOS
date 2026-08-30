"""Scan Instagram and YouTube for viral posts from a watchlist and related creators."""

from __future__ import annotations

import math
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Callable, Optional
from urllib.parse import urlparse

import yt_dlp


DEFAULT_USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)

YOUTUBE_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'}
INSTAGRAM_HOSTS = {'instagram.com', 'www.instagram.com'}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp_to_iso(value) -> Optional[str]:
    if value in (None, '', 0):
        return None
    try:
        ts = int(value)
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def days_old(published_at: Optional[str], now: Optional[datetime] = None) -> Optional[float]:
    if not published_at:
        return None
    now = now or utc_now()
    try:
        published = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        return max(0.0, (now - published).total_seconds() / 86400)
    except (TypeError, ValueError):
        return None


def virality_score(
    view_count: int = 0,
    like_count: int = 0,
    comment_count: int = 0,
    published_at: Optional[str] = None,
    now: Optional[datetime] = None,
    median_views: Optional[float] = None,
) -> float:
    """Rank recent breakout posts higher than old evergreen videos with similar views."""
    views = max(0, int(view_count or 0))
    likes = max(0, int(like_count or 0))
    comments = max(0, int(comment_count or 0))

    view_component = math.log10(views + 10)
    engagement = 1 + math.log10(likes + 1) / 4 + math.log10(comments + 1) / 6

    age = days_old(published_at, now)
    if age is None:
        recency = 0.55
    else:
        recency = math.exp(-age / 14)

    relative = 1.0
    if median_views and median_views > 0:
        relative = min(4.0, (views + 1) / median_views)

    return round(view_component * engagement * (0.5 + recency) * relative, 4)


def _youtube_tab_urls(url: str) -> list[str]:
    base = url.rstrip('/')
    if base.endswith(('/videos', '/shorts', '/streams')):
        return [url]
    return [f'{base}/videos', f'{base}/shorts']


def _name_matches(left: Optional[str], right: Optional[str]) -> bool:
    if not left or not right:
        return False
    a = re.sub(r'[^a-z0-9]+', '', left.lower())
    b = re.sub(r'[^a-z0-9]+', '', right.lower())
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    # Avoid "Nirv" matching "Nirvana". Require a substantial contained name.
    if len(shorter) < 6:
        return False
    return shorter in longer


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or '').lower()
    except ValueError:
        return ''


def _guess_platform(url: str) -> str:
    host = _host(url)
    if host in INSTAGRAM_HOSTS:
        return 'instagram'
    if host in YOUTUBE_HOSTS or host.endswith('.youtube.com'):
        return 'youtube'
    return 'unknown'


def _safe_int(value, default=0) -> int:
    try:
        if value in (None, ''):
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _thumbnail(entry: dict) -> Optional[str]:
    if entry.get('thumbnail'):
        return entry['thumbnail']
    thumbs = entry.get('thumbnails') or []
    if thumbs:
        best = max(thumbs, key=lambda t: t.get('width') or t.get('height') or 0)
        return best.get('url')
    return None


def normalize_entry(entry: dict, platform: str, creator: Optional[dict] = None, source: str = 'watchlist') -> Optional[dict]:
    if not entry or entry.get('_type') == 'playlist':
        return None
    url = entry.get('webpage_url') or entry.get('url') or ''
    if url and not url.startswith('http'):
        if platform == 'youtube':
            video_id = entry.get('id') or url
            url = f'https://www.youtube.com/watch?v={video_id}'
        elif platform == 'instagram':
            shortcode = entry.get('id') or entry.get('display_id') or url
            url = f'https://www.instagram.com/reel/{shortcode}/'
    if not url:
        return None

    title = (entry.get('title') or entry.get('description') or '').strip()
    if not title or title.lower() in {'na', 'unknown'}:
        title = 'Untitled post'

    published_at = timestamp_to_iso(entry.get('timestamp') or entry.get('release_timestamp'))
    if not published_at and entry.get('upload_date'):
        try:
            published_at = datetime.strptime(entry['upload_date'], '%Y%m%d').replace(
                tzinfo=timezone.utc
            ).isoformat()
        except (TypeError, ValueError):
            published_at = None

    uploader = entry.get('uploader') or entry.get('channel') or entry.get('creator')
    creator = creator or {}

    return {
        'id': str(entry.get('id') or url),
        'platform': platform or _guess_platform(url),
        'url': url,
        'title': title[:240],
        'description': (entry.get('description') or '')[:400],
        'creator_id': creator.get('id'),
        'creator_name': creator.get('name') or uploader,
        'creator_handle': creator.get('instagram_handle') or creator.get('youtube_handle') or uploader,
        'channel_url': entry.get('channel_url') or entry.get('uploader_url'),
        'niche': creator.get('niche'),
        'source': source,
        'view_count': _safe_int(entry.get('view_count')),
        'like_count': _safe_int(entry.get('like_count')),
        'comment_count': _safe_int(entry.get('comment_count')),
        'duration': _safe_int(entry.get('duration'), default=None) or entry.get('duration'),
        'published_at': published_at,
        'thumbnail': _thumbnail(entry),
        'is_short': bool(entry.get('duration') and entry['duration'] <= 90),
    }


class ViralScanner:
    def __init__(
        self,
        cookies_file: Optional[str] = None,
        extract_fn: Optional[Callable] = None,
        max_workers: int = 3,
    ):
        self.cookies_file = cookies_file or os.environ.get('YTDLP_COOKIES') or os.environ.get('INSTAGRAM_COOKIES_FILE')
        self._extract_fn = extract_fn
        self.max_workers = max_workers

    def _ydl_opts(self, playlistend: int) -> dict:
        opts = {
            'quiet': True,
            'no_warnings': True,
            'noprogress': True,
            'extract_flat': 'in_playlist',
            'skip_download': True,
            'ignoreerrors': True,
            'noplaylist': False,
            'playlistend': playlistend,
            'playlist_items': f'1:{playlistend}',
            'socket_timeout': 20,
            'retries': 1,
            'http_headers': {'User-Agent': DEFAULT_USER_AGENT},
        }
        if self.cookies_file and os.path.exists(self.cookies_file):
            opts['cookiefile'] = self.cookies_file
        return opts

    def extract(self, url: str, limit: int = 15) -> dict:
        if self._extract_fn:
            return self._extract_fn(url, limit)
        with yt_dlp.YoutubeDL(self._ydl_opts(playlistend=limit)) as ydl:
            return ydl.extract_info(url, download=False) or {}

    def extract_entries(self, url: str, platform: str, creator: Optional[dict] = None, source: str = 'watchlist', limit: int = 15) -> list[dict]:
        info = self.extract(url, limit=limit)
        if not info:
            return []
        raw_entries = info.get('entries') or [info]
        posts = []
        for entry in raw_entries:
            if not entry:
                continue
            post = normalize_entry(entry, platform, creator=creator, source=source)
            if post:
                posts.append(post)
        return posts[:limit]

    def scan_instagram(self, creator: dict, limit: int = 12) -> tuple[list[dict], Optional[str]]:
        handle = creator.get('instagram_handle')
        if not handle:
            return [], None
        urls = [
            f'https://www.instagram.com/{handle}/',
        ]
        errors = []
        for url in urls:
            try:
                posts = self.extract_entries(url, 'instagram', creator=creator, limit=limit)
                if posts:
                    return posts, None
            except Exception as exc:  # noqa: BLE001 - surface extractor failures per creator
                errors.append(str(exc))
        message = errors[-1] if errors else 'No public Instagram posts found'
        if 'login' in message.lower() or 'cookie' in message.lower():
            message = (
                'Instagram blocked the public scrape. Add a cookies file via '
                'YTDLP_COOKIES to scan Instagram, or add a YouTube URL for this creator.'
            )
        return [], message

    def scan_youtube(self, creator: dict, limit: int = 15) -> tuple[list[dict], Optional[str]]:
        candidates = []
        if creator.get('youtube_url'):
            candidates.extend(_youtube_tab_urls(creator['youtube_url']))
        handle = creator.get('youtube_handle')
        if handle:
            candidates.extend(_youtube_tab_urls(f'https://www.youtube.com/@{handle}'))

        seen_ids = set()
        posts = []
        last_error = None
        seen_urls = set()
        for candidate in candidates:
            if candidate in seen_urls:
                continue
            seen_urls.add(candidate)
            try:
                found = self.extract_entries(candidate, 'youtube', creator=creator, limit=limit)
                for post in found:
                    if post['id'] in seen_ids:
                        continue
                    seen_ids.add(post['id'])
                    posts.append(post)
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)

        if not posts:
            search_posts, search_error = self._search_creator_youtube(creator, limit=limit)
            posts.extend(search_posts)
            last_error = last_error or search_error

        if posts:
            return posts[: max(limit * 2, 12)], None
        return [], last_error or ('No YouTube videos found' if candidates else None)

    def _search_creator_youtube(self, creator: dict, limit: int = 12) -> tuple[list[dict], Optional[str]]:
        queries = []
        name = (creator.get('name') or '').strip()
        if len(name) >= 5:
            queries.append(name)
        handle = creator.get('youtube_handle') or creator.get('instagram_handle')
        if handle and len(handle) >= 5:
            queries.append(handle.replace('_', ' '))
        if name and creator.get('niche') and len(name) >= 5:
            queries.append(f"{name} {creator['niche']}")

        posts = []
        for query in queries:
            found = self.search_youtube(query, creator.get('niche') or '', limit=8, source='watchlist')
            for post in found:
                if _name_matches(post.get('creator_name'), creator.get('name')) or _name_matches(post.get('creator_handle'), handle):
                    post['creator_id'] = creator.get('id')
                    post['creator_name'] = creator.get('name') or post.get('creator_name')
                    post['niche'] = creator.get('niche')
                    posts.append(post)
            if posts:
                break
        return posts[:limit], None if posts else None

    def resolve_youtube(self, creator: dict) -> Optional[dict]:
        """If a watchlist creator has no YouTube URL, try the matching @handle."""
        if creator.get('youtube_url'):
            return None
        handle = creator.get('youtube_handle') or creator.get('instagram_handle')
        if not handle:
            return None
        url = f'https://www.youtube.com/@{handle}'
        try:
            info = self.extract(url, limit=1)
        except Exception:  # noqa: BLE001
            return None
        if not info:
            return None
        channel_url = info.get('channel_url') or info.get('uploader_url') or url
        channel_id = info.get('channel_id') or info.get('uploader_id')
        if not channel_url and not channel_id:
            return None
        return {
            'youtube_url': url,
            'youtube_handle': handle,
            'channel_id': channel_id,
        }

    def scan_creator(self, creator: dict, limit: int = 12) -> dict:
        posts = []
        errors = {}

        ig_posts, ig_error = self.scan_instagram(creator, limit=limit)
        posts.extend(ig_posts)
        if ig_error:
            errors['instagram'] = ig_error

        yt_posts, yt_error = self.scan_youtube(creator, limit=limit)
        posts.extend(yt_posts)
        if yt_error:
            errors['youtube'] = yt_error

        resolved_youtube = None
        if yt_posts and not creator.get('youtube_url'):
            handle = creator.get('youtube_handle') or _channel_handle(yt_posts[0])
            resolved_youtube = {
                'youtube_url': yt_posts[0].get('channel_url') or (
                    f'https://www.youtube.com/@{handle}' if handle else None
                ),
                'youtube_handle': handle,
            }

        return {
            'creator_id': creator.get('id'),
            'creator_name': creator.get('name'),
            'posts': posts,
            'errors': errors,
            'resolved_youtube': resolved_youtube,
        }

    def search_youtube(self, query: str, niche: str, limit: int = 15, source: str = 'discovery') -> list[dict]:
        url = f'ytsearch{limit}:{query}'
        try:
            posts = self.extract_entries(url, 'youtube', creator={'niche': niche}, source=source, limit=limit)
        except Exception:  # noqa: BLE001
            return []
        for post in posts:
            post['search_query'] = query
            post['niche'] = niche
        return posts

    def discover(
        self,
        niches: list[dict],
        existing_creators: list[dict],
        per_query: int = 12,
    ) -> dict:
        existing_handles = {
            (c.get('instagram_handle') or '').lower()
            for c in existing_creators
            if c.get('instagram_handle')
        }
        existing_handles.update(
            (c.get('youtube_handle') or '').lower()
            for c in existing_creators
            if c.get('youtube_handle')
        )
        existing_names = {(c.get('name') or '').lower() for c in existing_creators}

        posts = []
        for niche in niches:
            for query in niche.get('search_queries') or [niche['name']]:
                posts.extend(self.search_youtube(query, niche['name'], limit=per_query))

        unique_posts = []
        seen = set()
        for post in posts:
            if post['id'] in seen:
                continue
            seen.add(post['id'])
            unique_posts.append(post)

        suggestions = {}
        for post in unique_posts:
            handle = _channel_handle(post)
            key = (handle or post.get('creator_name') or '').lower()
            if not key:
                continue
            if key in existing_handles or key.lstrip('@') in existing_handles:
                continue
            if (post.get('creator_name') or '').lower() in existing_names:
                continue
            suggestion = suggestions.setdefault(key, {
                'id': handle or re.sub(r'[^a-z0-9]+', '-', key),
                'name': post.get('creator_name') or handle,
                'niche': post.get('niche'),
                'youtube_handle': handle,
                'youtube_url': post.get('channel_url') or (f'https://www.youtube.com/@{handle}' if handle else None),
                'instagram_handle': None,
                'sample_views': 0,
                'sample_title': post.get('title'),
                'sample_url': post.get('url'),
                'reason': f"Showing up in {post.get('niche')} search results",
            })
            suggestion['sample_views'] = max(suggestion['sample_views'], post.get('view_count') or 0)

        ranked_suggestions = sorted(
            suggestions.values(),
            key=lambda item: item['sample_views'],
            reverse=True,
        )
        return {
            'posts': unique_posts,
            'suggestions': ranked_suggestions[:20],
        }

    def rank(self, posts: list[dict]) -> list[dict]:
        by_creator: dict[str, list[int]] = {}
        for post in posts:
            key = post.get('creator_id') or post.get('creator_name') or 'unknown'
            by_creator.setdefault(key, []).append(post.get('view_count') or 0)

        medians = {}
        for key, views in by_creator.items():
            ordered = sorted(views)
            mid = len(ordered) // 2
            if not ordered:
                medians[key] = 0
            elif len(ordered) % 2:
                medians[key] = ordered[mid]
            else:
                medians[key] = (ordered[mid - 1] + ordered[mid]) / 2

        ranked = []
        for post in posts:
            key = post.get('creator_id') or post.get('creator_name') or 'unknown'
            scored = dict(post)
            scored['virality_score'] = virality_score(
                view_count=post.get('view_count') or 0,
                like_count=post.get('like_count') or 0,
                comment_count=post.get('comment_count') or 0,
                published_at=post.get('published_at'),
                median_views=medians.get(key),
            )
            ranked.append(scored)
        ranked.sort(key=lambda post: (post['virality_score'], post.get('view_count') or 0), reverse=True)
        return ranked

    def run_scan(
        self,
        creators: list[dict],
        niches: list[dict],
        include_discovery: bool = True,
        limit: int = 12,
        progress_cb: Optional[Callable[[dict], None]] = None,
    ) -> dict:
        def emit(step: str, **extra):
            if progress_cb:
                progress_cb({'step': step, **extra})

        all_posts = []
        creator_results = []
        resolved_updates = []

        emit('scanning_watchlist', scanned=0, total=len(creators))
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {
                pool.submit(self.scan_creator, creator, limit): creator
                for creator in creators
            }
            scanned = 0
            for future in as_completed(futures):
                creator = futures[future]
                try:
                    result = future.result()
                except Exception as exc:  # noqa: BLE001
                    result = {
                        'creator_id': creator.get('id'),
                        'creator_name': creator.get('name'),
                        'posts': [],
                        'errors': {'scan': str(exc)},
                    }
                all_posts.extend(result.get('posts') or [])
                creator_results.append(result)
                scanned += 1
                emit('scanning_watchlist', scanned=scanned, total=len(creators), creator=creator.get('name'))

                resolved = result.get('resolved_youtube')
                if resolved:
                    resolved['creator_id'] = creator['id']
                    resolved_updates.append(resolved)

        discovery = {'posts': [], 'suggestions': []}
        if include_discovery:
            emit('discovering')
            discovery = self.discover(niches, creators)
            all_posts.extend(discovery['posts'])

        emit('ranking')
        ranked = self.rank(all_posts)
        watchlist_posts = [p for p in ranked if p.get('source') == 'watchlist']
        discovery_posts = [p for p in ranked if p.get('source') == 'discovery']
        warnings = []
        for result in creator_results:
            for platform, message in (result.get('errors') or {}).items():
                warnings.append({
                    'creator_id': result.get('creator_id'),
                    'creator_name': result.get('creator_name'),
                    'platform': platform,
                    'message': message,
                })

        return {
            'generated_at': utc_now().isoformat(),
            'watchlist_count': len(creators),
            'post_count': len(ranked),
            'posts': ranked,
            'watchlist_posts': watchlist_posts,
            'discovery_posts': discovery_posts,
            'suggestions': discovery.get('suggestions') or [],
            'creator_results': creator_results,
            'resolved_youtube': resolved_updates,
            'warnings': warnings,
        }


def _channel_handle(post: dict) -> Optional[str]:
    handle = post.get('creator_handle')
    if handle and re.match(r'^[A-Za-z0-9._-]+$', handle):
        return handle.lstrip('@')
    channel_url = post.get('channel_url') or ''
    match = re.search(r'youtube\.com/@([A-Za-z0-9._-]+)', channel_url)
    if match:
        return match.group(1)
    return None
