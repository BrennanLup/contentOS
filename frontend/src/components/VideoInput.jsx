import { useRef, useState } from 'react'
import axios from 'axios'
import { Link2, Upload } from 'lucide-react'
import { cn } from '../lib/cn'

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

function VideoInput({ onAnalysisComplete, onAnalysisStart, onError }) {
  const [url, setUrl] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)

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
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const result = await pollJob(response.data.job_id)
      onAnalysisComplete(result)
    } catch (error) {
      onError(error.response?.data?.error || error.message || 'Failed to process video')
    }
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
    if (e.dataTransfer.files?.[0]) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  return (
    <section className="flex w-full max-w-content-width flex-col gap-6 p-6">
      <div className="surface-card">
        <div className="mb-4 flex items-center gap-2">
          <Link2 className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Paste video URL</h2>
        </div>
        <form onSubmit={handleUrlSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=... or TikTok, Instagram link"
            className="field"
          />
          <button type="submit" className="button-primary self-start">
            Analyze video
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {['YouTube', 'TikTok', 'Instagram'].map((platform) => (
            <span key={platform} className="rounded-full bg-muted px-2.5 py-1 text-2xs text-muted-foreground">
              {platform}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="surface-card">
        <div className="mb-4 flex items-center gap-2">
          <Upload className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Upload video file</h2>
        </div>
        <button
          type="button"
          className={cn(
            'flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-border-darker px-6 py-10 text-sm transition-colors',
            dragActive ? 'border-primary bg-primary/5' : 'hover:bg-muted/60',
          )}
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
            onChange={(e) => handleFileUpload(e.target.files[0])}
            className="hidden"
          />
          <p>Drag and drop a video file here</p>
          <p className="mt-1 text-xs text-muted-foreground">or click to browse</p>
        </button>
      </div>
    </section>
  )
}

export default VideoInput
