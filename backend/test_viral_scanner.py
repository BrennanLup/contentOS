"""Tests for watchlist parsing and viral ranking (no network)."""

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from creator_store import CreatorStore, parse_instagram_handle, parse_youtube_ref
from viral_scanner import ViralScanner, normalize_entry, virality_score


class ParseTests(unittest.TestCase):
    def test_instagram_url_and_handle(self):
        self.assertEqual(
            parse_instagram_handle('https://www.instagram.com/malachi_triathlon/'),
            'malachi_triathlon',
        )
        self.assertEqual(parse_instagram_handle('@sahilbloom'), 'sahilbloom')
        self.assertEqual(parse_instagram_handle('hannahsilberg'), 'hannahsilberg')

    def test_youtube_handle_url(self):
        url, handle = parse_youtube_ref('https://www.youtube.com/@SahilBloom')
        self.assertEqual(url, 'https://www.youtube.com/@SahilBloom')
        self.assertEqual(handle, 'SahilBloom')


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        seed = os.path.join(os.path.dirname(__file__), 'data', 'creators.seed.json')
        self.store = CreatorStore(self.tmp.name, seed_path=seed)

    def tearDown(self):
        self.tmp.cleanup()

    def test_seed_includes_requested_creators(self):
        ids = {c['id'] for c in self.store.list_creators()}
        self.assertTrue(
            {'malachi_triathlon', 'noahanderson14', 'nirvdoesfitness', 'hannahsilberg', 'sahilbloom'}
            <= ids
        )

    def test_add_instagram_creator(self):
        creator = self.store.add_creator({
            'url': 'https://www.instagram.com/newtriathlete/',
            'niche': 'Triathlon',
            'name': 'New Tri',
        })
        self.assertEqual(creator['instagram_handle'], 'newtriathlete')
        self.assertEqual(creator['niche'], 'Triathlon')

    def test_reject_duplicate(self):
        with self.assertRaises(ValueError):
            self.store.add_creator({'instagram_handle': 'sahilbloom'})


class ScoringTests(unittest.TestCase):
    def test_recent_high_views_outrank_old_posts(self):
        now = datetime(2026, 8, 30, tzinfo=timezone.utc)
        recent = virality_score(
            view_count=200_000,
            like_count=8000,
            published_at=(now - timedelta(days=2)).isoformat(),
            now=now,
            median_views=20_000,
        )
        old = virality_score(
            view_count=200_000,
            like_count=8000,
            published_at=(now - timedelta(days=400)).isoformat(),
            now=now,
            median_views=20_000,
        )
        self.assertGreater(recent, old)

    def test_breakout_beats_typical_post(self):
        now = datetime(2026, 8, 30, tzinfo=timezone.utc)
        published = (now - timedelta(days=3)).isoformat()
        breakout = virality_score(80_000, 2000, published_at=published, now=now, median_views=8_000)
        typical = virality_score(8_000, 200, published_at=published, now=now, median_views=8_000)
        self.assertGreater(breakout, typical)


class ScannerTests(unittest.TestCase):
    def test_name_match_does_not_confuse_nirv_with_nirvana(self):
        from viral_scanner import _name_matches
        self.assertFalse(_name_matches('Nirvana', 'Nirv'))
        self.assertFalse(_name_matches('Nirv', 'Nirvana'))
        self.assertTrue(_name_matches('Sahil Bloom', 'Sahil Bloom'))
        self.assertTrue(_name_matches('Malachi Cashmore | Pro Triathlete', 'Malachi Cashmore'))

    def test_normalize_youtube_watch_url(self):
        post = normalize_entry(
            {
                'id': 'abc123',
                'title': 'Ironman 70.3 recap',
                'url': 'abc123',
                'view_count': 12345,
                'timestamp': 1756500000,
                'duration': 58,
                'uploader': 'Noah Anderson',
            },
            'youtube',
            creator={'id': 'noahanderson14', 'name': 'Noah Anderson', 'niche': 'Triathlon'},
        )
        self.assertEqual(post['url'], 'https://www.youtube.com/watch?v=abc123')
        self.assertTrue(post['is_short'])
        self.assertEqual(post['niche'], 'Triathlon')

    def test_scan_and_discover_with_stubbed_extractor(self):
        creators = [
            {
                'id': 'sahilbloom',
                'name': 'Sahil Bloom',
                'niche': 'Advice',
                'instagram_handle': 'sahilbloom',
                'youtube_url': 'https://www.youtube.com/@SahilBloom',
                'youtube_handle': 'SahilBloom',
            }
        ]
        niches = [{'id': 'advice', 'name': 'Advice', 'search_queries': ['life advice']}]

        def fake_extract(url, limit):
            if 'instagram.com/sahilbloom' in url:
                return {
                    'entries': [{
                        'id': 'ig1',
                        'title': 'Morning routine',
                        'url': 'https://www.instagram.com/reel/ig1/',
                        'view_count': 50_000,
                        'timestamp': 1756500000,
                    }]
                }
            if 'youtube.com/@SahilBloom' in url:
                return {
                    'entries': [{
                        'id': 'yt1',
                        'title': 'Ask better questions',
                        'url': 'yt1',
                        'view_count': 400_000,
                        'timestamp': 1756500000,
                        'channel': 'Sahil Bloom',
                    }]
                }
            if url.startswith('ytsearch'):
                return {
                    'entries': [{
                        'id': 'new1',
                        'title': 'How I rebuilt my career',
                        'url': 'new1',
                        'view_count': 900_000,
                        'timestamp': 1756500000,
                        'channel': 'New Advice Creator',
                        'channel_url': 'https://www.youtube.com/@newadvice',
                        'uploader': 'newadvice',
                    }]
                }
            return {'entries': []}

        scanner = ViralScanner(extract_fn=fake_extract, max_workers=1)
        result = scanner.run_scan(creators, niches, include_discovery=True, limit=5)
        self.assertGreaterEqual(result['post_count'], 2)
        self.assertTrue(any(p['platform'] == 'instagram' for p in result['posts']))
        self.assertTrue(any(p['source'] == 'discovery' for p in result['posts']))
        self.assertTrue(any(s['youtube_handle'] == 'newadvice' or 'newadvice' in (s.get('youtube_url') or '') for s in result['suggestions']))


if __name__ == '__main__':
    unittest.main()
