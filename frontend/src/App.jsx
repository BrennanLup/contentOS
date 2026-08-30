import React, { useState } from 'react'
import VideoInput from './components/VideoInput'
import VideoAnalysis from './components/VideoAnalysis'
import ProcessMindmap from './components/ProcessMindmap'
import ViralRadar from './components/ViralRadar'
import './App.css'

function App() {
  const [tool, setTool] = useState('radar')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pendingUrl, setPendingUrl] = useState('')

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

  const handleError = (errorMessage) => {
    setError(errorMessage)
    setLoading(false)
  }

  const handleReset = () => {
    setAnalysisResult(null)
    setError(null)
    setLoading(false)
    setPendingUrl('')
  }

  const handleDeconstruct = (url) => {
    setPendingUrl(url)
    setAnalysisResult(null)
    setError(null)
    setLoading(false)
    setTool('deconstruct')
  }

  return (
    <div className="app-shell">
      <ProcessMindmap />
      <div className="app">
        <header className="app-header">
          <h1>contentOS</h1>
          <p>Find what is working in your space, then break it down shot by shot</p>
          <nav className="tool-nav">
            <button
              type="button"
              className={tool === 'radar' ? 'active' : ''}
              onClick={() => setTool('radar')}
            >
              Viral Radar
            </button>
            <button
              type="button"
              className={tool === 'deconstruct' ? 'active' : ''}
              onClick={() => setTool('deconstruct')}
            >
              Deconstruct
            </button>
          </nav>
        </header>

        <main className={`app-main ${tool}`}>
          {tool === 'radar' && (
            <ViralRadar onDeconstruct={handleDeconstruct} />
          )}

          {tool === 'deconstruct' && !analysisResult && !loading && (
            <VideoInput
              initialUrl={pendingUrl}
              onAnalysisComplete={handleAnalysisComplete}
              onAnalysisStart={handleAnalysisStart}
              onError={handleError}
            />
          )}

          {tool === 'deconstruct' && loading && (
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

          {tool === 'deconstruct' && error && (
            <div className="error-container">
              <h2>❌ Error</h2>
              <p>{error}</p>
              <button onClick={handleReset} className="btn-primary">
                Try Again
              </button>
            </div>
          )}

          {tool === 'deconstruct' && analysisResult && (
            <VideoAnalysis
              result={analysisResult}
              onReset={handleReset}
            />
          )}
        </main>

        <footer className="app-footer">
          <p>Viral Radar tracks Instagram + YouTube. Deconstruct supports YouTube, TikTok, Instagram, and uploads.</p>
        </footer>
      </div>
    </div>
  )
}

export default App
