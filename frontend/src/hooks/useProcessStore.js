import { useCallback, useEffect, useState } from 'react'
import { WEEKLY_GOAL_START } from '../data/contentProcess'

const STORAGE_KEY = 'contentos-process-v1'

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function emptyState() {
  return {
    currentStage: 'idea-generation',
    completedStages: [],
    skippedStages: [],
    ideas: [],
    checklists: {},
    emotions: {
      willFeel: '',
      wantThemToFeel: '',
      doTheyFeelIt: '',
    },
    shotList: '',
    filmer: '',
    editor: '',
    thumbnailDone: false,
    reviews: [
      { name: '', emotionFelt: false, blockers: '', tips: '' },
      { name: '', emotionFelt: false, blockers: '', tips: '' },
    ],
    releaseDate: '',
    released: false,
    commentsDone: false,
    learnings: [],
    weeklyCounts: {},
    weeklyGoal: WEEKLY_GOAL_START,
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    return { ...emptyState(), ...JSON.parse(raw) }
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

  const toggleComplete = useCallback((id) => {
    setState((prev) => {
      const done = prev.completedStages.includes(id)
      return {
        ...prev,
        completedStages: done
          ? prev.completedStages.filter((s) => s !== id)
          : [...prev.completedStages, id],
        skippedStages: prev.skippedStages.filter((s) => s !== id),
      }
    })
  }, [])

  const toggleSkipped = useCallback((id) => {
    setState((prev) => {
      const skipped = prev.skippedStages.includes(id)
      return {
        ...prev,
        skippedStages: skipped
          ? prev.skippedStages.filter((s) => s !== id)
          : [...prev.skippedStages, id],
        completedStages: prev.completedStages.filter((s) => s !== id),
      }
    })
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

  const removeIdea = useCallback((id) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.filter((idea) => idea.id !== id),
    }))
  }, [])

  const toggleChecklist = useCallback((itemId) => {
    setState((prev) => ({
      ...prev,
      checklists: { ...prev.checklists, [itemId]: !prev.checklists[itemId] },
    }))
  }, [])

  const setEmotion = useCallback((key, value) => {
    setState((prev) => ({
      ...prev,
      emotions: { ...prev.emotions, [key]: value },
    }))
  }, [])

  const setReview = useCallback((index, partial) => {
    setState((prev) => {
      const reviews = prev.reviews.map((review, i) =>
        i === index ? { ...review, ...partial } : review
      )
      return { ...prev, reviews }
    })
  }, [])

  const addLearning = useCallback((text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setState((prev) => ({
      ...prev,
      learnings: [
        {
          id: crypto.randomUUID(),
          text: trimmed,
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

  const resetProcess = useCallback(() => {
    setState((prev) => ({
      ...emptyState(),
      ideas: prev.ideas,
      learnings: prev.learnings,
      weeklyCounts: prev.weeklyCounts,
      weeklyGoal: prev.weeklyGoal,
    }))
  }, [])

  return {
    state,
    currentWeek,
    weeklyPosted: state.weeklyCounts[currentWeek] || 0,
    patch,
    setCurrentStage,
    toggleComplete,
    toggleSkipped,
    addIdea,
    updateIdea,
    removeIdea,
    toggleChecklist,
    setEmotion,
    setReview,
    addLearning,
    removeLearning,
    setWeeklyCount,
    resetProcess,
  }
}

export { weekKey }
