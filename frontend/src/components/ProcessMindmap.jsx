import React, { useState } from 'react'
import { DAILY_GOAL_RAMP, STAGES, WEEKLY_GOAL_START } from '../data/contentProcess'
import { useProcessStore } from '../hooks/useProcessStore'
import './ProcessMindmap.css'

function ideaScore(idea) {
  const effort = Math.max(1, Number(idea.effort) || 1)
  return (Number(idea.impact) || 0) / effort
}

function rankedIdeas(ideas) {
  return [...ideas].sort((a, b) => ideaScore(b) - ideaScore(a))
}

function AddRow({ placeholder, onAdd }) {
  const [value, setValue] = useState('')

  const submit = (event) => {
    event.preventDefault()
    onAdd(value)
    setValue('')
  }

  return (
    <form className="mm-add-row" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      <div className="mm-add-row-actions">
        <button type="submit" className="mm-btn mm-btn-solid">Add</button>
      </div>
    </form>
  )
}

function Checklist({ items, checklists, onToggle }) {
  return (
    <ul className="mm-checklist">
      {items.map((item) => (
        <li key={item.id}>
          <label>
            <input
              type="checkbox"
              checked={Boolean(checklists[item.id])}
              onChange={() => onToggle(item.id)}
            />
            <span>{item.label}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

function StageWorkspace({ stage, store }) {
  const { state } = store

  if (stage.id === 'idea-generation') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">{stage.summary}</p>
        <IdeaComposer onAdd={store.addIdea} />
        {state.ideas.length === 0 ? (
          <p className="mm-empty">No ideas yet. Queue them here and work them over time.</p>
        ) : (
          <ul className="mm-list">
            {state.ideas.map((idea) => (
              <li key={idea.id}>
                <span className={`mm-chip mm-chip-${idea.source}`}>
                  {idea.source === 'scan' ? 'Scan' : 'Own'}
                </span>
                <span className="mm-list-text">{idea.text}</span>
                <button type="button" className="mm-icon-btn" onClick={() => store.removeIdea(idea.id)} aria-label="Remove idea">
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
    const ranked = rankedIdeas(state.ideas)
    return (
      <div className="mm-workspace">
        <p className="mm-lead">Owner: Brennan. Weight impact + effort and pick the highest.</p>
        {ranked.length === 0 ? (
          <p className="mm-empty">Add ideas in generation first, then score them here.</p>
        ) : (
          <ul className="mm-score-list">
            {ranked.map((idea, index) => (
              <li key={idea.id} className={index === 0 ? 'is-top' : ''}>
                <div className="mm-score-head">
                  <strong>{idea.text}</strong>
                  <span className="mm-score-pill">{ideaScore(idea).toFixed(2)}</span>
                </div>
                <div className="mm-sliders">
                  <label>
                    Impact {idea.impact}
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={idea.impact}
                      onChange={(e) => store.updateIdea(idea.id, { impact: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Effort {idea.effort}
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={idea.effort}
                      onChange={(e) => store.updateIdea(idea.id, { effort: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (stage.id === 'planning') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">Claude + Brennan + existing viral scripts. Content editor is a future hire.</p>
        <div className="mm-field">
          <label>What emotion are people going to feel?</label>
          <input
            value={state.emotions.willFeel}
            onChange={(e) => store.setEmotion('willFeel', e.target.value)}
            placeholder="Curiosity, envy, relief..."
          />
        </div>
        <div className="mm-field">
          <label>What do you want them to feel when they watch it?</label>
          <input
            value={state.emotions.wantThemToFeel}
            onChange={(e) => store.setEmotion('wantThemToFeel', e.target.value)}
            placeholder="The feeling this post should leave behind"
          />
        </div>
        <div className="mm-field">
          <label>Do they feel it?</label>
          <input
            value={state.emotions.doTheyFeelIt}
            onChange={(e) => store.setEmotion('doTheyFeelIt', e.target.value)}
            placeholder="Honest answer after watching the cut"
          />
        </div>
        <h4>Hook checklist</h4>
        <Checklist items={stage.checklists.hook} checklists={state.checklists} onToggle={store.toggleChecklist} />
        <h4>Post checklist</h4>
        <Checklist items={stage.checklists.post} checklists={state.checklists} onToggle={store.toggleChecklist} />
      </div>
    )
  }

  if (stage.id === 'filming') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">Take the shot list, go to the activity, film everything.</p>
        <div className="mm-field">
          <label>Filmer</label>
          <select value={state.filmer} onChange={(e) => store.patch({ filmer: e.target.value })}>
            <option value="">Unassigned</option>
            <option value="Brennan">Brennan</option>
            <option value="Garet">Garet</option>
            <option value="Hire">Hire someone</option>
          </select>
        </div>
        <div className="mm-field">
          <label>Shot list</label>
          <textarea
            rows={5}
            value={state.shotList}
            onChange={(e) => store.patch({ shotList: e.target.value })}
            placeholder={'Hook close-up\nActivity wide\nReaction\nB-roll details'}
          />
        </div>
      </div>
    )
  }

  if (stage.id === 'editing') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">Brennan or a hire cuts the video and makes the thumbnail.</p>
        <div className="mm-field">
          <label>Editor</label>
          <select value={state.editor} onChange={(e) => store.patch({ editor: e.target.value })}>
            <option value="">Unassigned</option>
            <option value="Brennan">Brennan</option>
            <option value="Hire">Hire someone</option>
          </select>
        </div>
        <label className="mm-check-line">
          <input
            type="checkbox"
            checked={state.thumbnailDone}
            onChange={(e) => store.patch({ thumbnailDone: e.target.checked })}
          />
          Thumbnail is done
        </label>
      </div>
    )
  }

  if (stage.id === 'review') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">Get feedback from 2 people. Emotion first, then blockers and tips.</p>
        {state.reviews.map((review, index) => (
          <div key={index} className="mm-review-card">
            <h4>Reviewer {index + 1}</h4>
            <div className="mm-field">
              <label>Name</label>
              <input
                value={review.name}
                onChange={(e) => store.setReview(index, { name: e.target.value })}
                placeholder="Who watched it?"
              />
            </div>
            <label className="mm-check-line">
              <input
                type="checkbox"
                checked={review.emotionFelt}
                onChange={(e) => store.setReview(index, { emotionFelt: e.target.checked })}
              />
              They felt the intended emotion
            </label>
            <div className="mm-field">
              <label>Hard blockers</label>
              <textarea
                rows={2}
                value={review.blockers}
                onChange={(e) => store.setReview(index, { blockers: e.target.value })}
                placeholder="Anything that would stop this from posting"
              />
            </div>
            <div className="mm-field">
              <label>Specific tips / improvements</label>
              <textarea
                rows={2}
                value={review.tips}
                onChange={(e) => store.setReview(index, { tips: e.target.value })}
                placeholder="Concrete changes, not vibes"
              />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (stage.id === 'scheduling') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">Some post types can skip earlier steps. This is still the core pipeline.</p>
        <div className="mm-field">
          <label>Release date</label>
          <input
            type="datetime-local"
            value={state.releaseDate}
            onChange={(e) => store.patch({ releaseDate: e.target.value })}
          />
        </div>
        <label className="mm-check-line">
          <input
            type="checkbox"
            checked={state.released}
            onChange={(e) => store.patch({ released: e.target.checked })}
          />
          Posted / live
        </label>
      </div>
    )
  }

  if (stage.id === 'engagement') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">For the 24 hours after the post is live, respond to every comment.</p>
        <label className="mm-check-line">
          <input
            type="checkbox"
            checked={state.commentsDone}
            onChange={(e) => store.patch({ commentsDone: e.target.checked })}
          />
          All comments from the first 24 hours have a reply
        </label>
      </div>
    )
  }

  if (stage.id === 'iteration') {
    return (
      <div className="mm-workspace">
        <p className="mm-lead">One week after the post goes live: what is one thing we could have improved?</p>
        <AddRow placeholder="One improvement for next time" onAdd={store.addLearning} />
        {state.learnings.length === 0 ? (
          <p className="mm-empty">The running list lives here. Add one note per post.</p>
        ) : (
          <ul className="mm-list">
            {state.learnings.map((item) => (
              <li key={item.id}>
                <span className="mm-list-text">{item.text}</span>
                <span className="mm-muted">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
                <button type="button" className="mm-icon-btn" onClick={() => store.removeLearning(item.id)} aria-label="Remove learning">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (stage.id === 'reporting') {
    const remaining = Math.max(0, state.weeklyGoal - store.weeklyPosted)
    return (
      <div className="mm-workspace">
        <p className="mm-lead">
          Start at {WEEKLY_GOAL_START}/week. Ramp over time to {DAILY_GOAL_RAMP}/day
          ({DAILY_GOAL_RAMP * 7}/week).
        </p>
        <div className="mm-goal-meter">
          <div className="mm-goal-count">
            <button type="button" onClick={() => store.setWeeklyCount(store.weeklyPosted - 1)}>–</button>
            <strong>{store.weeklyPosted}</strong>
            <span>/ {state.weeklyGoal} this week</span>
            <button type="button" onClick={() => store.setWeeklyCount(store.weeklyPosted + 1)}>+</button>
          </div>
          <div className="mm-goal-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (store.weeklyPosted / Math.max(1, state.weeklyGoal)) * 100)}%` }} />
          </div>
          <p className="mm-muted">
            {remaining === 0 ? 'Weekly goal hit.' : `${remaining} more to hit this week’s goal.`} Ramp target: {DAILY_GOAL_RAMP} posts/day.
          </p>
        </div>
        <div className="mm-field">
          <label>Current weekly goal</label>
          <input
            type="number"
            min="1"
            max="21"
            value={state.weeklyGoal}
            onChange={(e) => store.patch({ weeklyGoal: Number(e.target.value) || WEEKLY_GOAL_START })}
          />
        </div>
      </div>
    )
  }

  return null
}

function IdeaComposer({ onAdd }) {
  const [text, setText] = useState('')
  const [source, setSource] = useState('own')

  return (
    <form
      className="mm-add-row"
      onSubmit={(event) => {
        event.preventDefault()
        onAdd(text, source)
        setText('')
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Drop an idea from a scan, Slack, or a voice memo"
      />
      <div className="mm-add-row-actions">
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="scan">Scan</option>
          <option value="own">Own</option>
        </select>
        <button type="submit" className="mm-btn mm-btn-solid">Add</button>
      </div>
    </form>
  )
}

function ProcessMindmap() {
  const store = useProcessStore()
  const [open, setOpen] = useState(true)
  const [expandedId, setExpandedId] = useState('idea-generation')

  const progress = store.state.completedStages.length + store.state.skippedStages.length
  const progressLabel = `${progress}/${STAGES.length}`

  return (
    <>
      {!open && (
        <button
          type="button"
          className="mm-toggle"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="process-mindmap"
        >
          ⬡ Process
        </button>
      )}

      <aside
        id="process-mindmap"
        className={`process-mindmap ${open ? 'is-open' : ''}`}
        aria-label="Content process mindmap"
        aria-hidden={!open}
      >
        <header className="mm-header">
          <div>
            <p className="mm-kicker">Business process</p>
            <h2>Content mindmap</h2>
          </div>
          <div className="mm-header-stats">
            <span>{progressLabel} stages</span>
            <span>{store.weeklyPosted}/{store.state.weeklyGoal} this week</span>
            <button type="button" className="mm-btn" onClick={() => setOpen(false)}>
              Hide
            </button>
          </div>
        </header>

        <div className="mm-hub">
          <span className="mm-hub-dot" />
          <div>
            <strong>Scan → ship → learn</strong>
            <p>Core pipeline. Lighter posts can skip a step.</p>
          </div>
        </div>

        <ol className="mm-tree">
          {STAGES.map((stage, index) => {
            const isExpanded = expandedId === stage.id
            const isCurrent = store.state.currentStage === stage.id
            const isDone = store.state.completedStages.includes(stage.id)
            const isSkipped = store.state.skippedStages.includes(stage.id)
            const status = isDone ? 'done' : isSkipped ? 'skipped' : isCurrent ? 'current' : 'idle'

            return (
              <li
                key={stage.id}
                className={`mm-node is-${status} ${isExpanded ? 'is-expanded' : ''}`}
                style={{ '--accent': stage.accent }}
              >
                {index < STAGES.length - 1 && <span className="mm-spine" aria-hidden="true" />}
                <button
                  type="button"
                  className="mm-node-button"
                  onClick={() => {
                    setExpandedId(stage.id)
                    store.setCurrentStage(stage.id)
                  }}
                >
                  <span className="mm-node-index">{stage.icon}</span>
                  <span className="mm-node-copy">
                    <span className="mm-node-title">
                      {stage.number}. {stage.title}
                    </span>
                    <span className="mm-node-owners">{stage.owners.join(' · ')}</span>
                  </span>
                </button>

                {isExpanded && (
                  <div className="mm-branch">
                    <ul className="mm-twigs">
                      {stage.branches.map((branch) => (
                        <li key={branch.id}>
                          <strong>{branch.title}</strong>
                          <p>{branch.detail}</p>
                        </li>
                      ))}
                    </ul>
                    <StageWorkspace stage={stage} store={store} />
                    <div className="mm-stage-actions">
                      {stage.skippable && (
                        <button
                          type="button"
                          className={`mm-btn ${isSkipped ? 'is-on' : ''}`}
                          onClick={() => store.toggleSkipped(stage.id)}
                        >
                          {isSkipped ? 'Skipped for this post' : 'Skip this post'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`mm-btn mm-btn-solid ${isDone ? 'is-on' : ''}`}
                        onClick={() => store.toggleComplete(stage.id)}
                      >
                        {isDone ? 'Completed' : 'Mark done'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        <footer className="mm-footer">
          <button type="button" className="mm-btn" onClick={store.resetProcess}>
            New post (keep queue + learnings)
          </button>
        </footer>
      </aside>
    </>
  )
}

export default ProcessMindmap
