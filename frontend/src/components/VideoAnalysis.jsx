import React, { useState } from 'react'
import './VideoAnalysis.css'

function VideoAnalysis({ result, onReset }) {
  const [selectedShot, setSelectedShot] = useState(null)
  const [view, setView] = useState('shots') // 'shots' or 'transcript'

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const exportData = () => {
    const exportJson = JSON.stringify(result, null, 2)
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `video-analysis-${result.job_id}.json`
    a.click()
  }

  const exportScript = () => {
    let script = `Video Analysis - ${result.job_id}\n\n`
    script += `Duration: ${formatTime(result.video_metadata.duration)}\n`
    script += `Shots: ${result.shot_count}\n\n`
    script += `=== FULL TRANSCRIPT ===\n\n`
    script += result.transcript.full_text + '\n\n'
    script += `=== SHOTS BREAKDOWN ===\n\n`
    
    result.shots.forEach((shot, idx) => {
      script += `Shot ${idx + 1}: ${formatTime(shot.start_time)} - ${formatTime(shot.end_time)}\n`
      if (shot.transcript_segments) {
        shot.transcript_segments.forEach(seg => {
          script += `  "${seg.text}"\n`
        })
      }
      script += '\n'
    })

    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `video-script-${result.job_id}.txt`
    a.click()
  }

  return (
    <div className="video-analysis-container">
      <div className="analysis-header">
        <div>
          <h2>✅ Analysis Complete</h2>
          <div className="video-stats">
            <span>⏱️ {formatTime(result.video_metadata.duration)}</span>
            <span>🎬 {result.shot_count} shots</span>
            <span>📐 {result.video_metadata.width}x{result.video_metadata.height}</span>
            <span>🎞️ {Math.round(result.video_metadata.fps)} fps</span>
          </div>
        </div>
        <div className="header-actions">
          <button onClick={exportData} className="btn-secondary">
            💾 Export JSON
          </button>
          <button onClick={exportScript} className="btn-secondary">
            📄 Export Script
          </button>
          <button onClick={onReset} className="btn-primary">
            ← New Video
          </button>
        </div>
      </div>

      <div className="view-tabs">
        <button 
          className={`tab ${view === 'shots' ? 'active' : ''}`}
          onClick={() => setView('shots')}
        >
          🎬 Shots ({result.shot_count})
        </button>
        <button 
          className={`tab ${view === 'transcript' ? 'active' : ''}`}
          onClick={() => setView('transcript')}
        >
          📝 Full Transcript
        </button>
      </div>

      {view === 'shots' && (
        <div className="shots-grid">
          {result.shots.map((shot, idx) => (
            <div 
              key={idx} 
              className={`shot-card ${selectedShot === idx ? 'selected' : ''}`}
              onClick={() => setSelectedShot(selectedShot === idx ? null : idx)}
            >
              <div className="shot-thumbnail">
                {shot.thumbnail ? (
                  <img src={shot.thumbnail} alt={`Shot ${idx + 1}`} />
                ) : (
                  <div className="thumbnail-placeholder">🎬</div>
                )}
              </div>
              <div className="shot-info">
                <h3>Shot {idx + 1}</h3>
                <p className="shot-time">
                  {formatTime(shot.start_time)} - {formatTime(shot.end_time)}
                </p>
                <p className="shot-duration">
                  Duration: {shot.duration.toFixed(1)}s
                </p>
                {shot.transcript_segments && shot.transcript_segments.length > 0 && (
                  <div className="shot-transcript">
                    <strong>Speech:</strong>
                    {shot.transcript_segments.map((seg, segIdx) => (
                      <p key={segIdx} className="transcript-segment">
                        "{seg.text}"
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'transcript' && (
        <div className="transcript-view">
          <div className="transcript-full">
            <h3>Full Transcript</h3>
            <p className="transcript-text">{result.transcript.full_text}</p>
          </div>
          
          <div className="transcript-segments">
            <h3>Timestamped Segments</h3>
            {result.transcript.segments.map((segment, idx) => (
              <div key={idx} className="segment-item">
                <span className="segment-time">
                  {formatTime(segment.start)} - {formatTime(segment.end)}
                </span>
                <span className="segment-text">{segment.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default VideoAnalysis
