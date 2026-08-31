import { useMemo, useRef, useState } from 'react'
import { ArrowDownWideNarrow, Check, ExternalLink, RefreshCw, X } from 'lucide-react'
import { DAILY_GOAL_RAMP, PIPELINE_STAGES, STAGES, WEEKLY_GOAL_START } from '../data/contentProcess'
import { cn } from '../lib/cn'
import { Page } from './Page'

function ideaScore(idea) {
  return (Number(idea.impact) || 0) / Math.max(1, Number(idea.effort) || 1)
}

function rankedIdeas(ideas) {
  return [...ideas].sort((a, b) => ideaScore(b) - ideaScore(a))
}

function stageTitle(stageId) {
  const stage = STAGES.find((item) => item.id === stageId)
  if (stage) return stage.title
  if (stageId === 'shipped') return 'Shipped'
  if (stageId === 'denied') return 'Denied'
  return stageId
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : ''
}

function IdeaComposer({ onAdd }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!text.trim()) return
        setSaving(true)
        await onAdd(text)
        setText('')
        setSaving(false)
      }}
    >
      <input
        className="field flex-1"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Capture a new content idea"
      />
      <button type="submit" className="button-primary" disabled={saving}>
        {saving ? 'Adding…' : 'Add to Notion'}
      </button>
    </form>
  )
}

function Readiness({ idea, stageId }) {
  const data = idea.data || {}
  const checks = {
    planning: [
      ['Hook', data.hook],
      ['Draft', data.script],
    ],
    filming: [
      ['Shot list', data.shotList],
      ['Draft', data.script],
      ['Filming date', idea.filmingDate || data.filmingDate],
    ],
    editing: [['Draft', data.script]],
    review: [['Review notes', data.reviewNotes]],
    scheduling: [['Publish date', data.publishDate]],
    engagement: [['Live URL', data.liveUrl]],
    iteration: [['Learning', data.learning]],
  }[stageId] || []

  if (!checks.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {checks.map(([label, value]) => (
        <span
          key={label}
          className={cn(
            'rounded-full px-2 py-0.5 text-2xs font-medium',
            value ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          {value ? 'Ready' : 'Missing'}: {label}
        </span>
      ))}
    </div>
  )
}

function ProjectCard({ idea, store, stageId, advanceLabel, onAdvance, showBack = true }) {
  const owners = (idea.owner || []).map((owner) => owner.name).filter(Boolean)
  return (
    <article className="surface-card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{idea.text}</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {owners.length ? <span>{owners.join(', ')}</span> : <span>Unassigned</span>}
            {idea.filmingDate || idea.data?.filmingDate ? (
              <span>Film {formatDate(idea.filmingDate || idea.data.filmingDate)}</span>
            ) : null}
            {idea.data?.publishDate ? <span>Publish {formatDate(idea.data.publishDate)}</span> : null}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-2xs font-semibold text-brand">
          {ideaScore(idea).toFixed(2)}
        </span>
      </div>

      <Readiness idea={idea} stageId={stageId} />

      {idea.data?.script ? (
        <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          {idea.data.script}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {idea.notionUrl ? (
          <a className="button-primary" href={idea.notionUrl} target="_blank" rel="noreferrer">
            Open in Notion
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        <button
          type="button"
          className="button-secondary"
          onClick={onAdvance || (() => store.advanceIdea(idea.id))}
        >
          {advanceLabel}
        </button>
        {showBack ? (
          <button type="button" className="button-secondary" onClick={() => store.sendIdeaBack(idea.id)}>
            Send back
          </button>
        ) : null}
      </div>
    </article>
  )
}

function EmptyStage({ stageId }) {
  const index = PIPELINE_STAGES.indexOf(stageId)
  const upstream = index > 0 ? stageTitle(PIPELINE_STAGES[index - 1]) : 'Idea Selection'
  return (
    <div className="surface-card border-dashed text-sm text-muted-foreground">
      Nothing in {stageTitle(stageId)} right now. Work arrives here from {upstream}.
    </div>
  )
}

function IdeaGeneration({ store }) {
  const ideas = store.state.ideas.filter((idea) => idea.stage === 'idea-generation')
  return (
    <div className="flex flex-col gap-4">
      <IdeaComposer onAdd={store.addIdea} />
      {ideas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No uncategorized ideas. Capture one above or add it directly in Notion.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {ideas.map((idea) => (
            <ProjectCard
              key={idea.id}
              idea={idea}
              store={store}
              stageId="idea-generation"
              advanceLabel="Send to Idea Selection"
              showBack={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DateField({ label, value, onChange }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
      {label}
      <input
        type="date"
        className="field h-7 w-[9.5rem] px-2 py-1 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function IdeaSelectionRow({ idea, store, highlighted }) {
  const [filmingDate, setFilmingDate] = useState(dateOnly(idea.filmingDate || idea.data?.filmingDate))
  const [publishDate, setPublishDate] = useState(dateOnly(idea.data?.publishDate))
  const [saving, setSaving] = useState(false)
  const score = ideaScore(idea)
  const datesReady = Boolean(filmingDate && publishDate)
  const datesOrdered = !datesReady || filmingDate <= publishDate

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-3 py-2',
        highlighted && 'border-brand/60',
      )}
    >
      <p className="min-w-[14rem] flex-1 break-words text-sm">{idea.text}</p>

      <ScorePicker
        label="Impact"
        value={idea.impact}
        onChange={(value) => store.updateIdea(idea.id, { impact: value })}
      />
      <ScorePicker
        label="Effort"
        value={idea.effort}
        onChange={(value) => store.updateIdea(idea.id, { effort: value })}
      />

      <span className="w-9 shrink-0 text-right text-2xs font-semibold text-brand">
        {score.toFixed(2)}
      </span>

      <DateField label="Film" value={filmingDate} onChange={setFilmingDate} />
      <DateField label="Publish" value={publishDate} onChange={setPublishDate} />

      <div className="flex shrink-0 items-center gap-1">
        {idea.notionUrl ? (
          <a
            href={idea.notionUrl}
            target="_blank"
            rel="noreferrer"
            title="Open in Notion"
            className="button size-7 p-0 text-muted-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        <button
          type="button"
          disabled={!datesReady || !datesOrdered || saving}
          title={
            !datesReady
              ? 'Set filming and publish dates to approve'
              : !datesOrdered
                ? 'Filming date must be on or before publish date'
                : 'Approve to Planning'
          }
          className="button size-7 p-0 text-success hover:bg-success/10 disabled:opacity-40"
          onClick={async () => {
            setSaving(true)
            await store.approveIdea(idea.id, { filmingDate, publishDate })
            setSaving(false)
          }}
        >
          <Check className="size-4" />
        </button>
        <button
          type="button"
          title="Deny"
          className="button size-7 p-0 text-muted-foreground hover:bg-danger/10 hover:text-danger"
          onClick={() => store.setIdeaDecision(idea.id, 'denied')}
        >
          <X className="size-4" />
        </button>
      </div>
      {!datesOrdered ? (
        <p className="w-full text-2xs text-danger">Film date must be on or before publish date.</p>
      ) : null}
    </li>
  )
}

function ScorePicker({ label, value, onChange }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="w-10 text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((step) => (
          <button
            key={step}
            type="button"
            title={`${label} ${step}`}
            onClick={() => onChange(step)}
            className={cn(
              'size-5 rounded text-2xs font-medium transition-colors',
              step === Number(value)
                ? 'bg-brand text-white'
                : 'bg-muted text-muted-foreground hover:bg-border-darker',
            )}
          >
            {step}
          </button>
        ))}
      </div>
    </div>
  )
}

// Keeps rows in a fixed position while scores are being edited: the order is
// only recomputed when ideas enter or leave the queue, or on an explicit re-rank.
function useStableOrder(ideas) {
  const orderRef = useRef([])
  const resortRef = useRef(false)
  const [resortToken, setResortToken] = useState(0)
  const idKey = ideas.map((idea) => idea.id).join('|')

  const order = useMemo(() => {
    const present = new Set(ideas.map((idea) => idea.id))
    let next
    if (resortRef.current) {
      next = rankedIdeas(ideas).map((idea) => idea.id)
    } else {
      const kept = orderRef.current.filter((id) => present.has(id))
      const known = new Set(kept)
      const added = rankedIdeas(ideas.filter((idea) => !known.has(idea.id))).map((idea) => idea.id)
      next = [...kept, ...added]
    }
    resortRef.current = false
    orderRef.current = next
    return next
  }, [idKey, resortToken])

  const ordered = order
    .map((id) => ideas.find((idea) => idea.id === id))
    .filter(Boolean)

  const resort = () => {
    resortRef.current = true
    setResortToken((token) => token + 1)
  }

  return [ordered, resort]
}

function IdeaSelection({ store }) {
  const pending = store.state.ideas.filter((idea) => idea.stage === 'idea-selection')
  const denied = store.state.ideas.filter((idea) => idea.stage === 'denied')
  const [ordered, resort] = useStableOrder(pending)
  const scores = pending.map(ideaScore)
  // Only flag a leader when the scores actually differ, otherwise every row highlights.
  const topScore = new Set(scores).size > 1 ? Math.max(...scores) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {pending.length} waiting · {denied.length} denied · Approve by setting film + publish dates
        </p>
        {pending.length > 1 ? (
          <button type="button" className="button-secondary px-2 py-1 text-xs" onClick={resort}>
            <ArrowDownWideNarrow className="size-3.5" />
            Re-rank by score
          </button>
        ) : null}
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Selection queue is clear.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ordered.map((idea) => (
            <IdeaSelectionRow
              key={idea.id}
              idea={idea}
              store={store}
              highlighted={ideaScore(idea) === topScore}
            />
          ))}
        </ul>
      )}

      {denied.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Denied</h3>
          <ul className="flex flex-col gap-1.5">
            {denied.map((idea) => (
              <li
                key={idea.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <p className="min-w-0 flex-1 break-words text-sm text-muted-foreground">{idea.text}</p>
                <button
                  type="button"
                  className="button-secondary shrink-0 px-2 py-1 text-xs"
                  onClick={() => store.setIdeaDecision(idea.id, 'denied')}
                >
                  Return to queue
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

const ADVANCE_LABELS = {
  planning: 'Move to Filming',
  filming: 'Move to Editing',
  editing: 'Move to Review',
  review: 'Move to Scheduling',
  engagement: 'Move to Iteration',
  iteration: 'Mark Shipped',
}

function PipelineStage({ stageId, store }) {
  const ideas = store.state.ideas.filter((idea) => idea.stage === stageId)
  if (!ideas.length) return <EmptyStage stageId={stageId} />
  return (
    <div className="flex flex-col gap-4">
      {ideas.map((idea) => (
        <ProjectCard
          key={idea.id}
          idea={idea}
          store={store}
          stageId={stageId}
          advanceLabel={stageId === 'scheduling' ? 'Posted — move to Engagement' : ADVANCE_LABELS[stageId]}
          onAdvance={stageId === 'scheduling' ? () => store.markPosted(idea.id) : undefined}
        />
      ))}
    </div>
  )
}

function Reporting({ store }) {
  const { state } = store
  const remaining = Math.max(0, state.weeklyGoal - store.weeklyPosted)
  const counts = Object.fromEntries(
    ['idea-generation', 'idea-selection', ...PIPELINE_STAGES, 'shipped', 'denied'].map((stageId) => [
      stageId,
      state.ideas.filter((idea) => idea.stage === stageId).length,
    ]),
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="surface-card">
        <div className="mb-3 flex items-center gap-3">
          <button type="button" className="button-secondary size-8 p-0" onClick={() => store.setWeeklyCount(store.weeklyPosted - 1)}>
            –
          </button>
          <div>
            <p className="text-2xl font-medium leading-none">{store.weeklyPosted}</p>
            <p className="mt-1 text-xs text-muted-foreground">/ {state.weeklyGoal} this week</p>
          </div>
          <button type="button" className="button-secondary size-8 p-0" onClick={() => store.setWeeklyCount(store.weeklyPosted + 1)}>
            +
          </button>
        </div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-brand"
            style={{ width: `${Math.min(100, (store.weeklyPosted / Math.max(1, state.weeklyGoal)) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {remaining === 0 ? 'Weekly goal hit.' : `${remaining} more to hit this week’s goal.`} Ramp target: {DAILY_GOAL_RAMP} posts/day.
        </p>
      </div>

      <div className="surface-card">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pipeline right now</h3>
        <ul className="flex flex-col gap-1.5 text-sm">
          {['idea-generation', 'idea-selection', ...PIPELINE_STAGES].map((stageId) => (
            <li key={stageId} className="flex justify-between">
              <span>{stageTitle(stageId)}</span>
              <span className="text-muted-foreground">{counts[stageId]}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-border pt-1.5">
            <span>Shipped</span>
            <span className="text-muted-foreground">{counts.shipped}</span>
          </li>
        </ul>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">Current weekly goal</span>
        <input
          className="field"
          type="number"
          min="1"
          max="21"
          value={state.weeklyGoal}
          onChange={(event) => store.patch({ weeklyGoal: Number(event.target.value) || WEEKLY_GOAL_START })}
        />
      </label>
    </div>
  )
}

function StageWorkspace({ stage, store }) {
  if (stage.id === 'idea-generation') return <IdeaGeneration store={store} />
  if (stage.id === 'idea-selection') return <IdeaSelection store={store} />
  if (stage.id === 'reporting') return <Reporting store={store} />
  return <PipelineStage stageId={stage.id} store={store} />
}

export function ProcessPage({ store, stageId }) {
  const stage = STAGES.find((item) => item.id === stageId) || STAGES[0]

  return (
    <Page title={`${stage.number}. ${stage.title}`} description={`${stage.summary} Owner: ${stage.owners.join(' · ')}`}>
      <section className="flex w-full max-w-content-width flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Notion is the source of truth. Approve with filming and publish dates — they show up on the Notion calendars.
          </p>
          <button type="button" className="button-secondary" onClick={() => store.refresh()} disabled={store.state.loading}>
            <RefreshCw className={cn('size-3.5', store.state.loading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {store.state.error ? (
          <div className="surface-card border-danger/30 bg-danger/5 text-sm text-danger">{store.state.error}</div>
        ) : null}

        {store.state.loading && store.state.ideas.length === 0 ? (
          <div className="surface-card text-sm text-muted-foreground">Loading content from Notion…</div>
        ) : (
          <StageWorkspace stage={stage} store={store} />
        )}
      </section>
    </Page>
  )
}
