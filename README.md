# contentOS - Video Content Deconstruction Tool

A powerful web application that analyzes videos from YouTube, TikTok, Instagram, and direct uploads to break them down into individual shots with synchronized transcripts. Perfect for content creators who want to deconstruct and recreate viral videos!

## ✨ Features

- **Multi-Platform Support**: Download and analyze videos from:
  - YouTube
  - TikTok
  - Instagram
  - Direct video file uploads

- **Shot Detection**: Automatically detects scene changes and breaks videos into individual shots
- **Speech Transcription**: Uses OpenAI Whisper to transcribe audio with timestamps
- **Thumbnail Generation**: Creates preview images for each detected shot
- **Export Options**: Export analysis as JSON or formatted text scripts
- **Modern UI**: Beautiful, responsive interface with real-time progress tracking

## 🚀 Deploy to Railway

The app is configured to auto-deploy from the main branch on Railway.

1. Open [https://railway.app/new](https://railway.app/new) and sign in with GitHub
2. Choose **Deploy from GitHub repo** → `BrennanLup/contentOS`
3. Railway will automatically use the `Dockerfile` and `railway.toml` configuration
4. After deploy, click **Generate domain** under the service networking settings
5. Give the service **at least 2 GB RAM** so Whisper can transcribe

You will get a public URL like `https://<service>.up.railway.app`

## 🏗️ Architecture

### Backend (Python Flask)
- Video downloading via `yt-dlp`
- Shot detection using OpenCV
- Audio transcription with Whisper AI
- RESTful API for video processing

### Frontend (React)
- Modern React with Vite
- Drag-and-drop file upload
- URL input for social media videos
- Interactive shot timeline
- Transcript viewer with timestamps

## 🚀 Quick Start (Local Development)

### Prerequisites

- Python 3.8+
- Node.js 16+
- FFmpeg (required by Whisper and yt-dlp)

### Installation

#### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install FFmpeg (if not already installed)
# Ubuntu/Debian:
sudo apt update && sudo apt install ffmpeg

# macOS:
brew install ffmpeg
```

#### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
```

### Running the Application

#### Terminal 1 - Start Backend Server

```bash
cd backend
source venv/bin/activate  # On Windows: venv\Scripts\activate
python app.py
```

Backend will run on `http://localhost:5000`

#### Terminal 2 - Start Frontend Development Server

```bash
cd frontend
npm run dev
```

Frontend will run on `http://localhost:3000`

Open your browser and navigate to `http://localhost:3000`

## 📖 Usage

### Analyze a Video from URL

1. Paste a YouTube, TikTok, or Instagram URL into the input field
2. Click "Analyze Video"
3. Wait for processing (may take a few minutes depending on video length)
4. View the breakdown of shots and transcript

### Upload a Video File

1. Drag and drop a video file onto the upload area, or click to browse
2. The video will be automatically processed
3. View results once analysis is complete

### Export Results

- **Export JSON**: Download complete analysis data in JSON format
- **Export Script**: Download a formatted text file with shots and transcript

## 🐳 Docker Deployment (Optional)

```bash
# Build and run with Docker Compose
docker-compose up --build
```

Access the app at `http://localhost:3000`

## 🔧 API Endpoints

### `POST /api/process-url`
Process a video from URL

**Request Body:**
```json
{
  "url": "https://youtube.com/watch?v=..."
}
```

### `POST /api/process-upload`
Process an uploaded video file

**Request:** `multipart/form-data` with video file

### `GET /api/jobs/<job_id>`
Get job status and results

### `GET /api/thumbnail/<job_id>/<shot_index>`
Get thumbnail image for a specific shot

## 🎯 How It Works

1. **Video Acquisition**: Videos are downloaded via `yt-dlp` or uploaded directly
2. **Shot Detection**: OpenCV analyzes frame-by-frame differences to detect scene changes
3. **Transcription**: Whisper AI transcribes audio with precise timestamps
4. **Thumbnail Extraction**: Key frames are extracted for each shot
5. **Synchronization**: Transcript segments are matched to corresponding shots
6. **Results Delivery**: Complete analysis is returned to the frontend

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests

## 📝 License

MIT License - feel free to use this project for personal or commercial purposes.

---

**Happy Video Deconstructing! 🎥✂️📝**
