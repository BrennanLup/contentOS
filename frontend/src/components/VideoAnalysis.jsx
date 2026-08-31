import { useState } from 'react'
import { cn } from '../lib/cn'

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function VideoAnalysis({ result, onReset }) {
  const [selectedShot, setSelectedShot] = useState(null)
  const [view, setView] = useState('shots')

  const exportData = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
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
        shot.transcript_segments.forEach((seg) => {
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
    <section className="flex w-full max-w-content-width flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-1">{formatTime(result.video_metadata.duration)}</span>
          <span className="rounded-full bg-muted px-2.5 py-1">{result.shot_count} shots</span>
          <span className="rounded-full bg-muted px-2.5 py-1">
            {result.video_metadata.width}×{result.video_metadata.height}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1">{Math.round(result.video_metadata.fps)} fps</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-secondary" onClick={exportData}>
            Export JSON
          </button>
          <button type="button" className="button-secondary" onClick={exportScript}>
            Export script
          </button>
          <button type="button" className="button-primary" onClick={onReset}>
            New video
          </button>
        </div>
      </div>

      <div className="flex border-b border-border">
        <button
          type="button"
          className={cn(
            'border-b-2 px-3 py-2 text-sm',
            view === 'shots' ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground',
          )}
          onClick={() => setView('shots')}
        >
          Shots ({result.shot_count})
        </button>
        <button
          type="button"
          className={cn(
            'border-b-2 px-3 py-2 text-sm',
            view === 'transcript' ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground',
          )}
          onClick={() => setView('transcript')}
        >
          Transcript
        </button>
      </div>

      {view === 'shots' ? (
        <div className="grid gap-3 md:grid-cols-2">
          {result.shots.map((shot, idx) => (
            <button
              key={idx}
              type="button"
              className={cn('surface-card text-left', selectedShot === idx && 'border-brand')}
              onClick={() => setSelectedShot(selectedShot === idx ? null : idx)}
            >
              <div className="mb-3 overflow-hidden rounded-md bg-muted">
                {shot.thumbnail ? (
                  <img src={shot.thumbnail} alt={`Shot ${idx + 1}`} className="h-36 w-full object-cover" />
                ) : (
                  <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">No thumbnail</div>
                )}
              </div>
              <h3 className="text-sm font-medium">Shot {idx + 1}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTime(shot.start_time)} – {formatTime(shot.end_time)} · {shot.duration.toFixed(1)}s
              </p>
              {shot.transcript_segments?.length > 0 ? (
                <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {shot.transcript_segments.map((seg, segIdx) => (
                    <p key={segIdx}>“{seg.text}”</p>
                  ))}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="surface-card">
            <h3 className="mb-2 text-sm font-medium">Full transcript</h3>
            <p className="text-sm leading-6 text-muted-foreground">{result.transcript.full_text}</p>
          </div>
          <div className="flex flex-col gap-2">
            {result.transcript.segments.map((segment, idx) => (
              <div key={idx} className="surface-card flex gap-4">
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {formatTime(segment.start)} – {formatTime(segment.end)}
                </span>
                <span className="text-sm">{segment.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default VideoAnalysis
