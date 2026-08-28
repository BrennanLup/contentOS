"""
Example script to test the video processor locally
"""

from video_processor import VideoProcessor
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python test_processor.py <video_path_or_url>")
        print("Example: python test_processor.py https://youtube.com/watch?v=...")
        print("Example: python test_processor.py /path/to/video.mp4")
        sys.exit(1)
    
    input_path = sys.argv[1]
    
    processor = VideoProcessor('uploads', 'results')
    
    print("Processing video...")
    
    # Check if it's a URL or file path
    if input_path.startswith('http'):
        print("Downloading video from URL...")
        video_path = processor.download_video(input_path, 'test_job')
    else:
        video_path = input_path
    
    print(f"Analyzing: {video_path}")
    result = processor.analyze_video(video_path, 'test_job')
    
    print("\n=== Analysis Results ===")
    print(f"Duration: {result['video_metadata']['duration']:.2f}s")
    print(f"Resolution: {result['video_metadata']['width']}x{result['video_metadata']['height']}")
    print(f"FPS: {result['video_metadata']['fps']:.2f}")
    print(f"Shots detected: {result['shot_count']}")
    print(f"\nTranscript: {result['transcript']['full_text'][:200]}...")
    
    print("\n=== Shot Breakdown ===")
    for shot in result['shots'][:5]:  # Show first 5 shots
        print(f"Shot {shot['shot_index']}: {shot['start_time']:.2f}s - {shot['end_time']:.2f}s")
        if 'transcript_segments' in shot:
            for seg in shot['transcript_segments']:
                print(f"  \"{seg['text']}\"")
    
    print("\nFull results saved to results/test_job.json")

if __name__ == '__main__':
    main()
