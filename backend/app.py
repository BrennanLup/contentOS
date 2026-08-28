from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import os
import json
import uuid
import threading
from video_processor import VideoProcessor

app = Flask(__name__, static_folder=None)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
RESULTS_FOLDER = os.path.join(BASE_DIR, 'results')
FRONTEND_DIST = os.path.join(BASE_DIR, '..', 'frontend', 'dist')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULTS_FOLDER, exist_ok=True)

processor = VideoProcessor(UPLOAD_FOLDER, RESULTS_FOLDER)

jobs = {}
jobs_lock = threading.Lock()


def _set_job(job_id, **kwargs):
    with jobs_lock:
        job = jobs.get(job_id, {'job_id': job_id})
        job.update(kwargs)
        jobs[job_id] = job
        return job.copy()


def _get_job(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        return job.copy() if job else None


def _process_url_job(job_id, url):
    try:
        _set_job(job_id, status='processing', step='downloading')
        video_path = processor.download_video(url, job_id)
        _set_job(job_id, status='processing', step='analyzing')
        result = processor.analyze_video(video_path, job_id)
        _set_job(job_id, status='done', step='complete', result=result)
    except Exception as e:
        _set_job(job_id, status='error', error=str(e))


def _process_upload_job(job_id, video_path):
    try:
        _set_job(job_id, status='processing', step='analyzing')
        result = processor.analyze_video(video_path, job_id)
        _set_job(job_id, status='done', step='complete', result=result)
    except Exception as e:
        _set_job(job_id, status='error', error=str(e))


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'})


@app.route('/api/process-url', methods=['POST'])
def process_url():
    """Queue a video from URL for background analysis."""
    try:
        data = request.json or {}
        url = data.get('url')

        if not url:
            return jsonify({'error': 'URL is required'}), 400

        job_id = str(uuid.uuid4())
        _set_job(job_id, status='queued', step='queued', url=url)
        thread = threading.Thread(target=_process_url_job, args=(job_id, url), daemon=True)
        thread.start()

        return jsonify({'job_id': job_id, 'status': 'queued'})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/process-upload', methods=['POST'])
def process_upload():
    """Queue an uploaded video file for background analysis."""
    try:
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400

        file = request.files['video']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        job_id = str(uuid.uuid4())
        video_path = os.path.join(UPLOAD_FOLDER, f"{job_id}_{file.filename}")
        file.save(video_path)

        _set_job(job_id, status='queued', step='queued')
        thread = threading.Thread(target=_process_upload_job, args=(job_id, video_path), daemon=True)
        thread.start()

        return jsonify({'job_id': job_id, 'status': 'queued'})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/jobs/<job_id>', methods=['GET'])
def get_job(job_id):
    job = _get_job(job_id)
    if job:
        return jsonify(job)

    results_path = os.path.join(RESULTS_FOLDER, f"{job_id}.json")
    if os.path.exists(results_path):
        with open(results_path, 'r') as f:
            result = json.load(f)
        return jsonify({'job_id': job_id, 'status': 'done', 'result': result})

    return jsonify({'error': 'Job not found'}), 404


@app.route('/api/results/<job_id>', methods=['GET'])
def get_results(job_id):
    """Get analysis results for a job"""
    try:
        results_path = os.path.join(RESULTS_FOLDER, f"{job_id}.json")

        if not os.path.exists(results_path):
            return jsonify({'error': 'Results not found'}), 404

        with open(results_path, 'r') as f:
            results = json.load(f)

        return jsonify(results)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/thumbnail/<job_id>/<int:shot_index>', methods=['GET'])
def get_thumbnail(job_id, shot_index):
    """Get thumbnail for a specific shot"""
    try:
        thumbnail_path = os.path.join(RESULTS_FOLDER, job_id, 'thumbnails', f'shot_{shot_index}.jpg')

        if not os.path.exists(thumbnail_path):
            return jsonify({'error': 'Thumbnail not found'}), 404

        return send_file(thumbnail_path, mimetype='image/jpeg')

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404

    if os.path.isdir(FRONTEND_DIST):
        file_path = os.path.join(FRONTEND_DIST, path)
        if path and os.path.isfile(file_path):
            return send_from_directory(FRONTEND_DIST, path)
        index_path = os.path.join(FRONTEND_DIST, 'index.html')
        if os.path.isfile(index_path):
            return send_from_directory(FRONTEND_DIST, 'index.html')

    return jsonify({
        'status': 'ok',
        'message': 'API is running. Frontend build not found.',
        'health': '/api/health'
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1', host='0.0.0.0', port=port)
