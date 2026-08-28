import cv2
import numpy as np
import os
import json
import subprocess
from typing import List, Dict
import whisper

class VideoProcessor:
    def __init__(self, upload_folder, results_folder):
        self.upload_folder = upload_folder
        self.results_folder = results_folder
        self.whisper_model = None
        
    def download_video(self, url: str, job_id: str) -> str:
        """Download video from URL using yt-dlp"""
        output_path = os.path.join(self.upload_folder, f"{job_id}.mp4")
        
        try:
            # Find yt-dlp - check in venv first, then system
            import shutil
            yt_dlp_path = shutil.which('yt-dlp') or os.path.join(os.path.dirname(__file__), 'venv', 'bin', 'yt-dlp')
            
            # Use yt-dlp to download video
            cmd = [
                yt_dlp_path,
                '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                '--merge-output-format', 'mp4',
                '-o', output_path,
                url
            ]
            
            subprocess.run(cmd, check=True, capture_output=True)
            
            if not os.path.exists(output_path):
                raise Exception("Video download failed")
            
            return output_path
        
        except subprocess.CalledProcessError as e:
            raise Exception(f"Failed to download video: {e.stderr.decode()}")
    
    def detect_shots(self, video_path: str, threshold: float = 30.0) -> List[Dict]:
        """Detect scene changes/shots in video using frame difference"""
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            raise Exception("Failed to open video file")
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        shots = []
        prev_frame = None
        frame_idx = 0
        shot_start = 0
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Convert to grayscale for comparison
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            if prev_frame is not None:
                # Calculate frame difference
                diff = cv2.absdiff(prev_frame, gray)
                mean_diff = np.mean(diff)
                
                # If difference exceeds threshold, it's a new shot
                if mean_diff > threshold:
                    timestamp = frame_idx / fps
                    
                    # Save previous shot
                    if shots or shot_start == 0:
                        shots.append({
                            'shot_index': len(shots),
                            'start_time': shot_start,
                            'end_time': timestamp,
                            'duration': timestamp - shot_start,
                            'start_frame': int(shot_start * fps),
                            'end_frame': frame_idx
                        })
                    
                    shot_start = timestamp
            
            prev_frame = gray
            frame_idx += 1
        
        # Add final shot
        if shot_start < duration:
            shots.append({
                'shot_index': len(shots),
                'start_time': shot_start,
                'end_time': duration,
                'duration': duration - shot_start,
                'start_frame': int(shot_start * fps),
                'end_frame': total_frames
            })
        
        cap.release()
        return shots
    
    def extract_thumbnails(self, video_path: str, shots: List[Dict], job_id: str):
        """Extract thumbnail images for each shot"""
        thumbnail_dir = os.path.join(self.results_folder, job_id, 'thumbnails')
        os.makedirs(thumbnail_dir, exist_ok=True)
        
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        
        for shot in shots:
            # Get frame from middle of shot
            mid_time = (shot['start_time'] + shot['end_time']) / 2
            mid_frame = int(mid_time * fps)
            
            cap.set(cv2.CAP_PROP_POS_FRAMES, mid_frame)
            ret, frame = cap.read()
            
            if ret:
                thumbnail_path = os.path.join(thumbnail_dir, f"shot_{shot['shot_index']}.jpg")
                cv2.imwrite(thumbnail_path, frame)
                shot['thumbnail'] = f"/api/thumbnail/{job_id}/{shot['shot_index']}"
        
        cap.release()
    
    def transcribe_audio(self, video_path: str) -> Dict:
        """Transcribe audio from video using Whisper"""
        try:
            # Load Whisper model (lazy loading)
            if self.whisper_model is None:
                print("Loading Whisper model...")
                self.whisper_model = whisper.load_model("base")
            
            # Extract audio and transcribe
            result = self.whisper_model.transcribe(video_path)
            
            # Format transcript with timestamps
            transcript = {
                'full_text': result['text'],
                'segments': []
            }
            
            for segment in result.get('segments', []):
                transcript['segments'].append({
                    'start': segment['start'],
                    'end': segment['end'],
                    'text': segment['text'].strip()
                })
            
            return transcript
        
        except Exception as e:
            print(f"Transcription error: {e}")
            return {
                'full_text': '',
                'segments': [],
                'error': str(e)
            }
    
    def analyze_video(self, video_path: str, job_id: str) -> Dict:
        """Complete video analysis pipeline"""
        print(f"Analyzing video: {video_path}")
        
        # Get video metadata
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        cap.release()
        
        # Detect shots
        print("Detecting shots...")
        shots = self.detect_shots(video_path)
        
        # Extract thumbnails
        print("Extracting thumbnails...")
        self.extract_thumbnails(video_path, shots, job_id)
        
        # Transcribe audio
        print("Transcribing audio...")
        transcript = self.transcribe_audio(video_path)
        
        # Match transcript segments to shots
        for segment in transcript.get('segments', []):
            segment_start = segment['start']
            for shot in shots:
                if shot['start_time'] <= segment_start <= shot['end_time']:
                    if 'transcript_segments' not in shot:
                        shot['transcript_segments'] = []
                    shot['transcript_segments'].append(segment)
                    break
        
        # Compile results
        result = {
            'job_id': job_id,
            'video_metadata': {
                'duration': duration,
                'fps': fps,
                'width': width,
                'height': height,
                'total_frames': total_frames
            },
            'shots': shots,
            'transcript': transcript,
            'shot_count': len(shots)
        }
        
        # Save results to file
        results_dir = os.path.join(self.results_folder, job_id)
        os.makedirs(results_dir, exist_ok=True)
        
        results_path = os.path.join(self.results_folder, f"{job_id}.json")
        with open(results_path, 'w') as f:
            json.dump(result, f, indent=2)
        
        print(f"Analysis complete: {len(shots)} shots detected")
        return result
