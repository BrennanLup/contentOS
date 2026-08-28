# Example URLs for Testing

## YouTube
- Short video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
- Tutorial: https://www.youtube.com/watch?v=jNQXAC9IVRw

## TikTok
- Standard TikTok: https://www.tiktok.com/@username/video/1234567890

## Instagram
- Reels: https://www.instagram.com/reel/ABC123/
- Video post: https://www.instagram.com/p/ABC123/

## Notes
- Replace with actual working URLs
- Some platforms may require authentication
- Video length affects processing time:
  - < 1 min: ~30 seconds
  - 1-5 min: 1-3 minutes
  - 5-10 min: 3-5 minutes

## Testing Locally
Use the test script:
```bash
cd backend
source venv/bin/activate
python test_processor.py "https://youtube.com/watch?v=..."
```
