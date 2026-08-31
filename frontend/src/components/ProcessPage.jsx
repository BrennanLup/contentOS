import { useState } from 'react'
import { DAILY_GOAL_RAMP, PIPELINE_STAGES, STAGES, WEEKLY_GOAL_START } from '../data/contentProcess'
import { cn } from '../lib/cn'
import { Page } from './Page'

function ideaScore(idea) {
  const effort = Math.max(1, Number(idea.effort) || 1)
  return (Number(idea.impact) || 0) / effort
}

function rankedIdeas(ideas) {
  return [...ideas].sort((a, b) => ideaScore(b) - ideaScore(a))
}

function stageTitle(stageId) {
  const stage = STAGES.find((item) => item.id === stageId)
  return stage ? stage.title : stageId
}

function ideasAtStage(ideas, stageId) {
  return ideas.filter((idea) => idea.decision === 'approved' && idea.stage === stageId)
}

function IdeaComposer({ onAdd }) {
  const [text, setText] = useState('')
  const [source, setSource] = useState('own')

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onAdd(text, source)
        setText('')
      }}
    >
      <input
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Drop an idea from a scan, Slack, or a voice memo"
      />
      <div className="flex gap-2">
        <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="scan">Scan</option>
          <option value="own">Own</option>
        </select>
        <button type="submit" className="button-primary">
          Add
        </button>
      </div>
    </form>
  )
}

function Checklist({ items, checked, onToggle }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={Boolean(checked[item.id])}
              onChange={() => onToggle(item.id)}
            />
            <span>{item.label}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

function PipelineCard({ idea, store, children, advanceLabel, onAdvance, canGoBack = true }) {
  return (
    <div className="surface-card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <strong className="text-sm font-medium">{idea.text}</strong>
        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-2xs font-semibold text-brand">
          {ideaScore(idea).toFixed(2)}
        </span>
      </div>
      {children}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button type="button" className="button-primary" onClick={onAdvance || (() => store.advanceIdea(idea.id))}>
          {advanceLabel}
        </button>
        {canGoBack ? (
          <button type="button" className="button-secondary" onClick={() => store.sendIdeaBack(idea.id)}>
            Send back
          </button>
        ) : null}
      </div>
    </div>
  )
}

function EmptyStage({ stageId }) {
  const index = PIPELINE_STAGES.indexOf(stageId)
  const upstream = index > 0 ? stageTitle(PIPELINE_STAGES[index - 1]) : 'Idea Selection'
  return (
    <p className="text-sm text-muted-foreground">
      Nothing in {stageTitle(stageId)} right now. Ideas arrive here from {upstream}.
    </p>
  )
}

function StageWorkspace({ stage, store }) {
  const { state } = store

  if (stage.id === 'idea-generation') {
    return (
      <div className="flex flex-col gap-4">
        <IdeaComposer onAdd={store.addIdea} />
        {state.ideas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ideas yet. Queue them here and work them over time.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.ideas.map((idea) => (
              <li key={idea.id} className="surface-card flex items-center gap-3">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-2xs font-medium',
                    idea.source === 'scan' ? 'bg-primary/10 text-primary' : 'bg-warning/10 text-warning',
                  )}
                >
                  {idea.source === 'scan' ? 'Scan' : 'Own'}
                </span>
                <span className="min-w-0 flex-1 text-sm">{idea.text}</span>
                {idea.decision === 'approved' ? (
                  <span className="text-2xs text-muted-foreground">
                    {idea.stage === 'shipped' ? 'Shipped' : `In ${stageTitle(idea.stage)}`}
                  </span>
                ) : null}
                <button type="button" className="button px-2 text-muted-foreground" onClick={() => store.removeIdea(idea.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (stage.id === 'idea-selection') {
    const pending = rankedIdeas(state.ideas.filter((idea) => (idea.decision || 'pending') === 'pending'))
    const decided = rankedIdeas(state.ideas.filter((idea) => idea.decision === 'approved' || idea.decision === 'denied'))

    if (state.ideas.length === 0) {
      return <p className="text-sm text-muted-foreground">Add ideas in generation first, then score and approve them here.</p>
    }

    return (
      <div className="flex flex-col gap-6">
        <p className="text-xs text-muted-foreground">
          {pending.length} waiting · {state.ideas.filter((idea) => idea.decision === 'approved').length} approved ·{' '}
          {state.ideas.filter((idea) => idea.decision === 'denied').length} denied
        </p>

        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queue is clear. Add more ideas and come back next week.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((idea, index) => (
              <li key={idea.id} className={cn('surface-card', index === 0 && 'border-brand')}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <strong className="text-sm font-medium">{idea.text}</strong>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-2xs font-semibold text-brand">
                    {ideaScore(idea).toFixed(2)}
                  </span>
                </div>
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Impact {idea.impact}
                    <input
                      type="range"
                      min="1"
                      max="5"
                      className="accent-brand"
                      value={idea.impact}
                      onChange={(e) => store.updateIdea(idea.id, { impact: Number(e.target.value) })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Effort {idea.effort}
                    <input
                      type="range"
                      min="1"
                      max="5"
                      className="accent-brand"
                      value={idea.effort}
                      onChange={(e) => store.updateIdea(idea.id, { effort: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="button-primary" onClick={() => store.setIdeaDecision(idea.id, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className="button-secondary" onClick={() => store.setIdeaDecision(idea.id, 'denied')}>
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Already decided</h3>
            <ul className="flex flex-col gap-2">
              {decided.map((idea) => (
                <li key={idea.id} className="surface-card flex flex-wrap items-center gap-3">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-2xs font-medium',
                      idea.decision === 'approved' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
                    )}
                  >
                    {idea.decision === 'approved' ? 'Approved' : 'Denied'}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{idea.text}</span>
                  {idea.decision === 'approved' ? (
                    <span className="text-2xs text-muted-foreground">
                      {idea.stage === 'shipped' ? 'Shipped' : `In ${stageTitle(idea.stage)}`}
                    </span>
                  ) : null}
                  <button type="button" className="button-secondary" onClick={() => store.setIdeaDecision(idea.id, idea.decision)}>
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  if (stage.id === 'planning') {
    const ideas = ideasAtStage(state.ideas, 'planning')
    if (ideas.length === 0) return <EmptyStage stageId="planning" />
    return (
      <div className="flex flex-col gap-4">
        {ideas.map((idea) => {
          const checked = idea.data.checklists || {}
          const toggle = (itemId) =>
            store.updateIdeaData(idea.id, { checklists: { ...checked, [itemId]: !checked[itemId] } })
          return (
            <PipelineCard key={idea.id} idea={idea} store={store} advanceLabel="Move to Filming" canGoBack={false}>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">What emotion are people going to feel?</span>
                <input
                  className="field"
                  value={idea.data.willFeel || ''}
                  onChange={(e) => store.updateIdeaData(idea.id, { willFeel: e.target.value })}
                  placeholder="Curiosity, envy, relief..."
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">What do you want them to feel when they watch it?</span>
                <input
                  className="field"
                  value={idea.data.wantThemToFeel || ''}
                  onChange={(e) => store.updateIdeaData(idea.id, { wantThemToFeel: e.target.value })}
                  placeholder="The feeling this post should leave behind"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">Script / outline</span>
                <textarea
                  className="field min-h-24"
                  value={idea.data.script || ''}
                  onChange={(e) => store.updateIdeaData(idea.id, { script: e.target.value })}
                  placeholder="Hook, beats, payoff. Steal structure from proven viral scripts."
                />
              </label>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-md bg-muted/60 p-3">
                  <h4 className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Hook checklist</h4>
                  <Checklist items={stage.checklists.hook} checked={checked} onToggle={toggle} />
                </div>
                <div className="rounded-md bg-muted/60 p-3">
                  <h4 className="mb-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Post checklist</h4>
                  <Checklist items={stage.checklists.post} checked={checked} onToggle={toggle} />
                </div>
              </div>
            </PipelineCard>
          )
        })}
      </div>
    )
  }

  if (stage.id === 'filming') {
    const ideas = ideasAtStage(state.ideas, 'filming')
    if (ideas.length === 0) return <EmptyStage stageId="filming" />
    return (
      <div className="flex flex-col gap-4">
        {ideas.map((idea) => (
          <PipelineCard key={idea.id} idea={idea} store={store} advanceLabel="Move to Editing">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Filmer</span>
              <select
                className="field"
                value={idea.data.filmer || ''}
                onChange={(e) => store.updateIdeaData(idea.id, { filmer: e.target.value })}
              >
                <option value="">Unassigned</option>
                <option value="Brennan">Brennan</option>
                <option value="Garet">Garet</option>
                <option value="Hire">Hire someone</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Shot list — take it to the activity and film everything</span>
              <textarea
                className="field min-h-32"
                value={idea.data.shotList || ''}
                onChange={(e) => store.updateIdeaData(idea.id, { shotList: e.target.value })}
                placeholder={'Hook close-up\nActivity wide\nReaction\nB-roll details'}
              />
            </label>
          </PipelineCard>
        ))}
      </div>
    )
  }

  if (stage.id === 'editing') {
    const ideas = ideasAtStage(state.ideas, 'editing')
    if (ideas.length === 0) return <EmptyStage stageId="editing" />
    return (
      <div className="flex flex-col gap-4">
        {ideas.map((idea) => (
          <PipelineCard key={idea.id} idea={idea} store={store} advanceLabel="Move to Review">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Editor</span>
              <select
                className="field"
                value={idea.data.editor || ''}
                onChange={(e) => store.updateIdeaData(idea.id, { editor: e.target.value })}
              >
                <option value="">Unassigned</option>
                <option value="Brennan">Brennan</option>
                <option value="Hire">Hire someone</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={Boolean(idea.data.thumbnailDone)}
                onChange={(e) => store.updateIdeaData(idea.id, { thumbnailDone: e.target.checked })}
              />
              Thumbnail is done
            </label>
          </PipelineCard>
        ))}
      </div>
    )
  }

  if (stage.id === 'review') {
    const ideas = ideasAtStage(state.ideas, 'review')
    if (ideas.length === 0) return <EmptyStage stageId="review" />
    return (
      <div className="flex flex-col gap-4">
        {ideas.map((idea) => {
          const reviews = idea.data.reviews || [
            { name: '', emotionFelt: false, blockers: '', tips: '' },
            { name: '', emotionFelt: false, blockers: '', tips: '' },
          ]
          const setReview = (index, partial) =>
            store.updateIdeaData(idea.id, {
              reviews: reviews.map((review, i) => (i === index ? { ...review, ...partial } : review)),
            })
          return (
            <PipelineCard key={idea.id} idea={idea} store={store} advanceLabel="Move to Scheduling">
              <div className="grid gap-4 lg:grid-cols-2">
                {reviews.map((review, index) => (
                  <div key={index} className="flex flex-col gap-3 rounded-md bg-muted/60 p-3">
                    <h4 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                      Reviewer {index + 1}
                    </h4>
                    <input
                      className="field"
                      value={review.name}
                      onChange={(e) => setReview(index, { name: e.target.value })}
                      placeholder="Who watched it?"
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={review.emotionFelt}
                        onChange={(e) => setReview(index, { emotionFelt: e.target.checked })}
                      />
                      They felt the intended emotion
                    </label>
                    <textarea
                      className="field min-h-16"
                      value={review.blockers}
                      onChange={(e) => setReview(index, { blockers: e.target.value })}
                      placeholder="Hard blockers"
                    />
                    <textarea
                      className="field min-h-16"
                      value={review.tips}
                      onChange={(e) => setReview(index, { tips: e.target.value })}
                      placeholder="Specific tips / improvements"
                    />
                  </div>
                ))}
              </div>
            </PipelineCard>
          )
        })}
      </div>
    )
  }

  if (stage.id === 'scheduling') {
    const ideas = ideasAtStage(state.ideas, 'scheduling')
    if (ideas.length === 0) return <EmptyStage stageId="scheduling" />
    return (
      <div className="flex flex-col gap-4">
        {ideas.map((idea) => (
          <PipelineCard
            key={idea.id}
            idea={idea}
            store={store}
            advanceLabel="Posted — move to Engagement"
            onAdvance={() => store.markPosted(idea.id)}
          >
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Release date</span>
              <input
                className="field"
                type="datetime-local"
                value={idea.data.releaseDate || ''}
                onChange={(e) => store.updateIdeaData(idea.id, { releaseDate: e.target.value })}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Marking it posted counts toward this week’s goal ({store.weeklyPosted}/{state.weeklyGoal}).
            </p>
          </PipelineCard>
        ))}
      </div>
    )
  }

  if (stage.id === 'engagement') {
    const ideas = ideasAtStage(state.ideas, 'engagement')
    if (ideas.length === 0) return <EmptyStage stageId="engagement" />
    return (
      <div className="flex flex-col gap-4">
        {ideas.map((idea) => (
          <PipelineCard key={idea.id} idea={idea} store={store} advanceLabel="Move to Iteration">
            {idea.data.postedAt ? (
              <p className="text-xs text-muted-foreground">
                Posted {new Date(idea.data.postedAt).toLocaleString()}. Reply to every comment for the first 24 hours.
              </p>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={Boolean(idea.data.commentsDone)}
                onChange={(e) => store.updateIdeaData(idea.id, { commentsDone: e.target.checked })}
              />
              All comments from the first 24 hours have a reply
            </label>
          </PipelineCard>
        ))}
      </div>
    )
  }

  if (stage.id === 'iteration') {
    const ideas = ideasAtStage(state.ideas, 'iteration')
    return (
      <div className="flex flex-col gap-6">
        {ideas.length === 0 ? (
          <EmptyStage stageId="iteration" />
        ) : (
          <div className="flex flex-col gap-4">
            {ideas.map((idea) => (
              <PipelineCard
                key={idea.id}
                idea={idea}
                store={store}
                advanceLabel="Log learning & archive"
                onAdvance={() => {
                  store.addLearning(idea.data.learning || '', idea.text)
                  store.advanceIdea(idea.id)
                }}
              >
                <label className="flex flex-col gap-1.5">
                  <span className="field-label">
                    One week after it went live: what is one thing we could have improved?
                  </span>
                  <textarea
                    className="field min-h-16"
                    value={idea.data.learning || ''}
                    onChange={(e) => store.updateIdeaData(idea.id, { learning: e.target.value })}
                    placeholder="One improvement for next time"
                  />
                </label>
              </PipelineCard>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Running learnings list</h3>
          {state.learnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing logged yet. Every shipped post should leave one note here.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.learnings.map((item) => (
                <li key={item.id} className="surface-card flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{item.text}</p>
                    {item.ideaText ? <p className="mt-0.5 text-2xs text-muted-foreground">{item.ideaText}</p> : null}
                  </div>
                  <span className="text-2xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
                  <button type="button" className="button px-2 text-muted-foreground" onClick={() => store.removeLearning(item.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  if (stage.id === 'reporting') {
    const remaining = Math.max(0, state.weeklyGoal - store.weeklyPosted)
    const shipped = state.ideas.filter((idea) => idea.stage === 'shipped').length
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
            {remaining === 0 ? 'Weekly goal hit.' : `${remaining} more to hit this week’s goal.`} Ramp target:{' '}
            {DAILY_GOAL_RAMP} posts/day.
          </p>
        </div>

        <div className="surface-card">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pipeline right now</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex justify-between">
              <span>Waiting on approval</span>
              <span className="text-muted-foreground">
                {state.ideas.filter((idea) => (idea.decision || 'pending') === 'pending').length}
              </span>
            </li>
            {PIPELINE_STAGES.map((stageId) => (
              <li key={stageId} className="flex justify-between">
                <span>{stageTitle(stageId)}</span>
                <span className="text-muted-foreground">{ideasAtStage(state.ideas, stageId).length}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-border pt-1.5">
              <span>Shipped all-time</span>
              <span className="text-muted-foreground">{shipped}</span>
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
            onChange={(e) => store.patch({ weeklyGoal: Number(e.target.value) || WEEKLY_GOAL_START })}
          />
        </label>
      </div>
    )
  }

  return null
}

export function ProcessPage({ store, stageId }) {
  const stage = STAGES.find((item) => item.id === stageId) || STAGES[0]

  return (
    <Page
      title={`${stage.number}. ${stage.title}`}
      description={`${stage.summary} Owner: ${stage.owners.join(' · ')}`}
    >
      <section className="flex w-full max-w-content-width flex-col gap-6 p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {stage.branches.map((branch) => (
            <div key={branch.id} className="surface-card">
              <h3 className="text-sm font-medium">{branch.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{branch.detail}</p>
            </div>
          ))}
        </div>

        <StageWorkspace stage={stage} store={store} />
      </section>
    </Page>
  )
}
