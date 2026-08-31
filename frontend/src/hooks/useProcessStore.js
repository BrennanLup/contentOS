import { useCallback, useEffect, useState } from 'react'
import { PIPELINE_STAGES, SEED_IDEAS, WEEKLY_GOAL_START } from '../data/contentProcess'

const STORAGE_KEY = 'contentos-process-v1'

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function normalizeIdea(idea) {
  const decision = idea.decision === 'approved' || idea.decision === 'denied' ? idea.decision : 'pending'
  return {
    ...idea,
    decision,
    stage: idea.stage ?? (decision === 'approved' ? PIPELINE_STAGES[0] : null),
    data: idea.data || {},
  }
}

function seedIdeas() {
  const now = new Date().toISOString()
  return SEED_IDEAS.map((idea) =>
    normalizeIdea({
      ...idea,
      createdAt: idea.createdAt || now,
    })
  )
}

function withSeedIdeas(ideas) {
  const existing = Array.isArray(ideas) ? ideas.map(normalizeIdea) : []
  const missing = seedIdeas().filter((seed) => !existing.some((idea) => idea.id === seed.id || idea.text === seed.text))
  return [...missing, ...existing]
}

function emptyState() {
  return {
    currentStage: 'idea-generation',
    ideas: seedIdeas(),
    learnings: [],
    weeklyCounts: {},
    weeklyGoal: WEEKLY_GOAL_START,
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw)
    return { ...emptyState(), ...parsed, ideas: withSeedIdeas(parsed.ideas) }
  } catch {
    return emptyState()
  }
}

export function useProcessStore() {
  const [state, setState] = useState(loadState)
  const currentWeek = weekKey()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const patch = useCallback((partial) => {
    setState((prev) => ({ ...prev, ...partial }))
  }, [])

  const setCurrentStage = useCallback((id) => {
    setState((prev) => ({ ...prev, currentStage: id }))
  }, [])

  const addIdea = useCallback((text, source) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setState((prev) => ({
      ...prev,
      ideas: [
        {
          id: crypto.randomUUID(),
          text: trimmed,
          source,
          impact: 3,
          effort: 3,
          decision: 'pending',
          stage: null,
          data: {},
          createdAt: new Date().toISOString(),
        },
        ...prev.ideas,
      ],
    }))
  }, [])

  const updateIdea = useCallback((id, partial) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.map((idea) => (idea.id === id ? { ...idea, ...partial } : idea)),
    }))
  }, [])

  const updateIdeaData = useCallback((id, partial) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.map((idea) =>
        idea.id === id ? { ...idea, data: { ...idea.data, ...partial } } : idea
      ),
    }))
  }, [])

  const setIdeaDecision = useCallback((id, decision) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.map((idea) => {
        if (idea.id !== id) return idea
        const next = idea.decision === decision ? 'pending' : decision
        return {
          ...idea,
          decision: next,
          stage: next === 'approved' ? idea.stage || PIPELINE_STAGES[0] : null,
          decidedAt: next === 'pending' ? null : new Date().toISOString(),
        }
      }),
    }))
  }, [])

  const advanceIdea = useCallback((id) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.map((idea) => {
        if (idea.id !== id) return idea
        const index = PIPELINE_STAGES.indexOf(idea.stage)
        if (index === -1) return idea
        const nextStage = PIPELINE_STAGES[index + 1] || 'shipped'
        return { ...idea, stage: nextStage }
      }),
    }))
  }, [])

  const sendIdeaBack = useCallback((id) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.map((idea) => {
        if (idea.id !== id) return idea
        const index = PIPELINE_STAGES.indexOf(idea.stage)
        if (index <= 0) return idea
        return { ...idea, stage: PIPELINE_STAGES[index - 1] }
      }),
    }))
  }, [])

  const removeIdea = useCallback((id) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.filter((idea) => idea.id !== id),
    }))
  }, [])

  const addLearning = useCallback((text, ideaText) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setState((prev) => ({
      ...prev,
      learnings: [
        {
          id: crypto.randomUUID(),
          text: trimmed,
          ideaText: ideaText || null,
          createdAt: new Date().toISOString(),
        },
        ...prev.learnings,
      ],
    }))
  }, [])

  const removeLearning = useCallback((id) => {
    setState((prev) => ({
      ...prev,
      learnings: prev.learnings.filter((item) => item.id !== id),
    }))
  }, [])

  const setWeeklyCount = useCallback((count) => {
    const next = Math.max(0, count)
    setState((prev) => ({
      ...prev,
      weeklyCounts: { ...prev.weeklyCounts, [currentWeek]: next },
    }))
  }, [currentWeek])

  const markPosted = useCallback((id) => {
    setState((prev) => {
      const posted = (prev.weeklyCounts[currentWeek] || 0) + 1
      return {
        ...prev,
        weeklyCounts: { ...prev.weeklyCounts, [currentWeek]: posted },
        ideas: prev.ideas.map((idea) =>
          idea.id === id ? { ...idea, stage: 'engagement', data: { ...idea.data, postedAt: new Date().toISOString() } } : idea
        ),
      }
    })
  }, [currentWeek])

  return {
    state,
    currentWeek,
    weeklyPosted: state.weeklyCounts[currentWeek] || 0,
    patch,
    setCurrentStage,
    addIdea,
    updateIdea,
    updateIdeaData,
    setIdeaDecision,
    advanceIdea,
    sendIdeaBack,
    markPosted,
    removeIdea,
    addLearning,
    removeLearning,
    setWeeklyCount,
  }
}

export { weekKey }
