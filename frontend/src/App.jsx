import React, { useState } from 'react'
import VideoInput from './components/VideoInput'
import VideoAnalysis from './components/VideoAnalysis'
import ProcessMindmap from './components/ProcessMindmap'
import './App.css'

function App() {
  const [analysisResult, setAnalysisResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleAnalysisComplete = (result) => {
    setAnalysisResult(result)
    setLoading(false)
    setError(null)
  }

  const handleAnalysisStart = () => {
    setLoading(true)
    setError(null)
    setAnalysisResult(null)
  }

  const handleError = (error) => {
    setError(error)
    setLoading(false)
  }

  const handleReset = () => {
    setAnalysisResult(null)
    setError(null)
    setLoading(false)
  }

  return (
    <div className="app-shell">
      <ProcessMindmap />
      <div className="app">
        <header className="app-header">
          <h1>🎬 Video Deconstruction Tool</h1>
          <p>Break down videos from YouTube, TikTok, Instagram into shots and scripts</p>
        </header>

        <main className="app-main">
          {!analysisResult && !loading && (
            <VideoInput 
              onAnalysisComplete={handleAnalysisComplete}
              onAnalysisStart={handleAnalysisStart}
              onError={handleError}
            />
          )}

          {loading && (
            <div className="loading-container">
              <div className="spinner"></div>
              <h2>Analyzing Video...</h2>
              <p>This may take a few minutes depending on video length</p>
              <div className="loading-steps">
                <div className="step">⬇️ Downloading video</div>
                <div className="step">🎥 Detecting shots</div>
                <div className="step">📝 Transcribing audio</div>
                <div className="step">🖼️ Extracting thumbnails</div>
              </div>
            </div>
          )}

          {error && (
            <div className="error-container">
              <h2>❌ Error</h2>
              <p>{error}</p>
              <button onClick={handleReset} className="btn-primary">
                Try Again
              </button>
            </div>
          )}

          {analysisResult && (
            <VideoAnalysis 
              result={analysisResult} 
              onReset={handleReset}
            />
          )}
        </main>

        <footer className="app-footer">
          <p>Supports YouTube, TikTok, Instagram, and direct video uploads</p>
        </footer>
      </div>
    </div>
  )
}

export default App
