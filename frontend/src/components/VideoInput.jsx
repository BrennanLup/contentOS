import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import './VideoInput.css'

async function pollJob(jobId) {
  const started = Date.now()
  const timeoutMs = 15 * 60 * 1000

  while (Date.now() - started < timeoutMs) {
    const response = await axios.get(`/api/jobs/${jobId}`)
    const job = response.data

    if (job.status === 'done' && job.result) {
      return job.result
    }
    if (job.status === 'error') {
      throw new Error(job.error || 'Video processing failed')
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error('Processing timed out. Try a shorter video.')
}

function VideoInput({ onAnalysisComplete, onAnalysisStart, onError, initialUrl = '' }) {
  const [url, setUrl] = useState(initialUrl)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl)
    }
  }, [initialUrl])

  const handleUrlSubmit = async (e) => {
    e.preventDefault()

    if (!url.trim()) {
      onError('Please enter a valid URL')
      return
    }

    try {
      onAnalysisStart()

      const response = await axios.post('/api/process-url', { url })
      const result = await pollJob(response.data.job_id)

      onAnalysisComplete(result)
    } catch (error) {
      onError(error.response?.data?.error || error.message || 'Failed to process video')
    }
  }

  const handleFileUpload = async (file) => {
    if (!file) return

    const formData = new FormData()
    formData.append('video', file)

    try {
      onAnalysisStart()

      const response = await axios.post('/api/process-upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      const result = await pollJob(response.data.job_id)

      onAnalysisComplete(result)
    } catch (error) {
      onError(error.response?.data?.error || error.message || 'Failed to process video')
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    handleFileUpload(file)
  }

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  return (
    <div className="video-input-container">
      <div className="input-section">
        <h2>📎 Paste Video URL</h2>
        <form onSubmit={handleUrlSubmit}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=... or TikTok, Instagram link"
            className="url-input"
          />
          <button type="submit" className="btn-primary">
            Analyze Video
          </button>
        </form>
        <div className="supported-platforms">
          <span>✅ YouTube</span>
          <span>✅ TikTok</span>
          <span>✅ Instagram</span>
        </div>
      </div>

      <div className="divider">
        <span>OR</span>
      </div>

      <div className="input-section">
        <h2>📤 Upload Video File</h2>
        <div
          className={`drop-zone ${dragActive ? 'active' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <div className="drop-zone-content">
            <div className="upload-icon">📁</div>
            <p>Drag and drop a video file here</p>
            <p className="drop-zone-hint">or click to browse</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VideoInput
