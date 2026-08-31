from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import os
import json
import uuid
import threading
from creator_store import CreatorStore
from viral_scanner import ViralScanner
import zernio_slack

app = Flask(__name__, static_folder=None)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
RESULTS_FOLDER = os.path.join(BASE_DIR, 'results')
DATA_FOLDER = os.environ.get('CONTENTOS_DATA_DIR') or os.path.join(BASE_DIR, 'data')
FRONTEND_DIST = os.path.join(BASE_DIR, '..', 'frontend', 'dist')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULTS_FOLDER, exist_ok=True)

creator_store = CreatorStore(
    DATA_FOLDER,
    seed_path=os.path.join(BASE_DIR, 'data', 'creators.seed.json'),
)
scanner = ViralScanner()
latest_scan_path = os.path.join(DATA_FOLDER, 'latest_scan.json')
_processor = None


def get_processor():
    global _processor
    if _processor is None:
        from video_processor import VideoProcessor
        _processor = VideoProcessor(UPLOAD_FOLDER, RESULTS_FOLDER)
    return _processor

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
        video_path = get_processor().download_video(url, job_id)
        _set_job(job_id, status='processing', step='analyzing')
        result = get_processor().analyze_video(video_path, job_id)
        _set_job(job_id, status='done', step='complete', result=result)
    except Exception as e:
        _set_job(job_id, status='error', error=str(e))


def _process_upload_job(job_id, video_path):
    try:
        _set_job(job_id, status='processing', step='analyzing')
        result = get_processor().analyze_video(video_path, job_id)
        _set_job(job_id, status='done', step='complete', result=result)
    except Exception as e:
        _set_job(job_id, status='error', error=str(e))


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'})


@app.route('/api/webhooks/zernio', methods=['POST'])
def zernio_webhook():
    raw_body = request.get_data()
    ok, reason = zernio_slack.verify_signature(raw_body, request.headers.get('X-Zernio-Signature'))
    if not ok:
        return jsonify({'error': reason}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid JSON body'}), 400

    status = zernio_slack.handle_event(payload)
    return jsonify({'status': status})


@app.route('/api/webhooks/slack', methods=['POST'])
def slack_webhook():
    raw_body = request.get_data()
    ok, reason = zernio_slack.verify_slack_signature(
        raw_body,
        request.headers.get('X-Slack-Request-Timestamp'),
        request.headers.get('X-Slack-Signature'),
    )
    if not ok:
        return jsonify({'error': reason}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid JSON body'}), 400

    return jsonify(zernio_slack.handle_slack_event(payload))


@app.route('/api/integrations/zernio/status', methods=['GET'])
def zernio_integration_status():
    """Integration health check. Add ?test=1 to also send a Slack test message."""
    send_test = request.args.get('test') == '1'
    return jsonify(zernio_slack.diagnostics(send_test=send_test))


# Register the Zernio webhook subscription (no-op unless ZERNIO_API_KEY and a
# public URL are configured). Runs in a background thread so boot isn't blocked.
zernio_slack.start_registration_thread()


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


@app.route('/api/creators', methods=['GET'])
def list_creators():
    snapshot = creator_store.snapshot()
    return jsonify(snapshot)


@app.route('/api/creators', methods=['POST'])
def add_creator():
    try:
        creator = creator_store.add_creator(request.json or {})
        return jsonify(creator), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/creators/<creator_id>', methods=['PATCH'])
def update_creator(creator_id):
    try:
        creator = creator_store.update_creator(creator_id, request.json or {})
        return jsonify(creator)
    except KeyError:
        return jsonify({'error': 'Creator not found'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/creators/<creator_id>', methods=['DELETE'])
def delete_creator(creator_id):
    if not creator_store.delete_creator(creator_id):
        return jsonify({'error': 'Creator not found'}), 404
    return jsonify({'ok': True})


def _apply_resolved_youtube(updates):
    for update in updates or []:
        creator_id = update.get('creator_id')
        if not creator_id:
            continue
        try:
            creator_store.update_creator(creator_id, {
                'youtube_url': update.get('youtube_url'),
                'youtube_handle': update.get('youtube_handle'),
            })
        except KeyError:
            continue


def _save_latest_scan(result):
    payload = {k: v for k, v in result.items() if k != 'creator_results'}
    with open(latest_scan_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f)


def _run_viral_scan(job_id, include_discovery, creator_ids, limit):
    try:
        snapshot = creator_store.snapshot()
        creators = snapshot['creators']
        if creator_ids:
            wanted = set(creator_ids)
            creators = [c for c in creators if c['id'] in wanted]
        if not creators:
            raise ValueError('No creators on the watchlist to scan')

        def progress(info):
            _set_job(job_id, status='processing', **info)

        result = scanner.run_scan(
            creators=creators,
            niches=snapshot['niches'],
            include_discovery=include_discovery,
            limit=limit,
            progress_cb=progress,
        )
        _apply_resolved_youtube(result.get('resolved_youtube'))
        _save_latest_scan(result)
        _set_job(job_id, status='done', step='complete', result=result)
    except Exception as e:
        _set_job(job_id, status='error', error=str(e))


@app.route('/api/viral/scan', methods=['POST'])
def start_viral_scan():
    data = request.json or {}
    job_id = str(uuid.uuid4())
    include_discovery = data.get('include_discovery', True)
    creator_ids = data.get('creator_ids')
    limit = int(data.get('limit') or 12)
    _set_job(job_id, kind='viral_scan', status='queued', step='queued')
    thread = threading.Thread(
        target=_run_viral_scan,
        args=(job_id, include_discovery, creator_ids, limit),
        daemon=True,
    )
    thread.start()
    return jsonify({'job_id': job_id, 'status': 'queued'})


@app.route('/api/viral/latest', methods=['GET'])
def latest_viral_scan():
    if os.path.exists(latest_scan_path):
        with open(latest_scan_path, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    return jsonify({'posts': [], 'suggestions': [], 'post_count': 0})


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
