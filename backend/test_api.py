"""Flask API tests for the creator watchlist (no network)."""

import os
import tempfile
import unittest

os.environ.setdefault('CONTENTOS_DATA_DIR', tempfile.mkdtemp())

from app import app, creator_store  # noqa: E402


class CreatorApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_lists_seeded_watchlist(self):
        response = self.client.get('/api/creators')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        ids = {c['id'] for c in data['creators']}
        self.assertIn('sahilbloom', ids)
        self.assertIn('malachi_triathlon', ids)

    def test_add_and_delete_creator(self):
        response = self.client.post('/api/creators', json={
            'instagram_url': 'https://www.instagram.com/test_tri_creator/',
            'niche': 'Triathlon',
            'name': 'Test Tri',
        })
        self.assertEqual(response.status_code, 201)
        creator = response.get_json()
        delete = self.client.delete(f"/api/creators/{creator['id']}")
        self.assertEqual(delete.status_code, 200)

    def test_latest_scan_empty(self):
        response = self.client.get('/api/viral/latest')
        self.assertEqual(response.status_code, 200)
        self.assertIn('posts', response.get_json())


if __name__ == '__main__':
    unittest.main()
