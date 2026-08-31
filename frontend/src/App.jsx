import { useState } from 'react'
import { AppShell } from './components/AppShell'
import { Page } from './components/Page'
import { ProcessPage } from './components/ProcessPage'
import { Sidebar } from './components/Sidebar'
import VideoAnalysis from './components/VideoAnalysis'
import VideoInput from './components/VideoInput'
import { useProcessStore } from './hooks/useProcessStore'
import { PIPELINE_STAGES } from './data/contentProcess'

function stageCountsFrom(ideas) {
  const counts = {
    'idea-selection': ideas.filter((idea) => (idea.decision || 'pending') === 'pending').length,
  }
  for (const stageId of PIPELINE_STAGES) {
    counts[stageId] = ideas.filter((idea) => idea.decision === 'approved' && idea.stage === stageId).length
  }
  return counts
}

function App() {
  const store = useProcessStore()
  const [view, setView] = useState('process')
  const [stageId, setStageId] = useState(store.state.currentStage || 'idea-generation')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleStageChange = (id) => {
    setStageId(id)
    store.setCurrentStage(id)
    setView('process')
  }

  const handleReset = () => {
    setAnalysisResult(null)
    setError(null)
    setLoading(false)
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          view={view}
          stageId={stageId}
          onViewChange={setView}
          onStageChange={handleStageChange}
          stageCounts={stageCountsFrom(store.state.ideas)}
          weeklyPosted={store.weeklyPosted}
          weeklyGoal={store.state.weeklyGoal}
        />
      }
    >
      {view === 'process' ? (
        <ProcessPage store={store} stageId={stageId} />
      ) : (
        <Page
          title="Deconstruct"
          description="Break down YouTube, TikTok, and Instagram videos into shots and scripts"
        >
          {!analysisResult && !loading && !error ? (
            <VideoInput
              onAnalysisComplete={(result) => {
                setAnalysisResult(result)
                setLoading(false)
                setError(null)
              }}
              onAnalysisStart={() => {
                setLoading(true)
                setError(null)
                setAnalysisResult(null)
              }}
              onError={(message) => {
                setError(message)
                setLoading(false)
              }}
            />
          ) : null}

          {loading ? (
            <section className="flex w-full max-w-content-width flex-col gap-4 p-6">
              <div className="surface-card">
                <div className="mb-3 size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
                <h2 className="text-sm font-medium">Analyzing video</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  This may take a few minutes depending on video length
                </p>
                <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
                  <li>Downloading video</li>
                  <li>Detecting shots</li>
                  <li>Transcribing audio</li>
                  <li>Extracting thumbnails</li>
                </ul>
              </div>
            </section>
          ) : null}

          {error ? (
            <section className="flex w-full max-w-content-width flex-col gap-4 p-6">
              <div className="surface-card">
                <h2 className="text-sm font-medium text-danger">Error</h2>
                <p className="mt-2 text-sm text-muted-foreground">{error}</p>
                <button type="button" className="button-primary mt-4" onClick={handleReset}>
                  Try again
                </button>
              </div>
            </section>
          ) : null}

          {analysisResult ? <VideoAnalysis result={analysisResult} onReset={handleReset} /> : null}
        </Page>
      )}
    </AppShell>
  )
}

export default App
