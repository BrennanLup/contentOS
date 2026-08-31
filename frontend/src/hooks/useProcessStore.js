import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { PIPELINE_STAGES, WEEKLY_GOAL_START } from '../data/contentProcess'

const STORAGE_KEY = 'contentos-process-v1'
const MIGRATION_KEY = 'contentos-notion-migration-v1'
const SETTINGS_KEY = 'contentos-settings-v1'
const STAGE_FLOW = ['idea-generation', 'idea-selection', ...PIPELINE_STAGES, 'shipped']

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function loadSettings() {
  try {
    return {
      weeklyGoal: WEEKLY_GOAL_START,
      weeklyCounts: {},
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
    }
  } catch {
    return { weeklyGoal: WEEKLY_GOAL_START, weeklyCounts: {} }
  }
}

function legacyStage(idea) {
  if (idea.decision === 'denied') return 'denied'
  if (idea.decision === 'approved') return idea.stage || 'planning'
  return 'idea-selection'
}

function legacyPayload(idea) {
  const reviews = idea.data?.reviews || []
  const reviewNotes = reviews
    .flatMap((review) => [review.blockers, review.tips])
    .filter(Boolean)
    .join('\n')
  return {
    contentosId: idea.id,
    text: idea.text,
    stage: legacyStage(idea),
    impact: idea.impact || 3,
    effort: idea.effort || 3,
    draft: idea.data?.script || '',
    hook: idea.data?.hook || '',
    shotList: idea.data?.shotList || '',
    reviewNotes,
    learning: idea.data?.learning || '',
    publishDate: idea.data?.postedAt || idea.data?.releaseDate || null,
    liveUrl: idea.data?.liveUrl || null,
  }
}

function initialState() {
  const settings = loadSettings()
  return {
    currentStage: 'idea-generation',
    ideas: [],
    weeklyGoal: settings.weeklyGoal,
    weeklyCounts: settings.weeklyCounts,
    loading: true,
    error: null,
  }
}

function errorMessage(error) {
  return error.response?.data?.error || error.message || 'Notion sync failed'
}

export function useProcessStore() {
  const [state, setState] = useState(initialState)
  const currentWeek = weekKey()

  useEffect(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ weeklyGoal: state.weeklyGoal, weeklyCounts: state.weeklyCounts }),
    )
  }, [state.weeklyGoal, state.weeklyCounts])

  const fetchContent = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const response = await axios.get('/api/content')
      setState((prev) => ({
        ...prev,
        ideas: response.data.items || [],
        loading: false,
        error: null,
      }))
      return response.data.items || []
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: errorMessage(error) }))
      return null
    }
  }, [])

  const migrateLegacyIdeas = useCallback(async () => {
    if (localStorage.getItem(MIGRATION_KEY)) return
    let ideas = []
    try {
      const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      ideas = Array.isArray(legacy.ideas) ? legacy.ideas : []
    } catch {
      ideas = []
    }
    try {
      for (const idea of ideas) {
        if (idea?.id && idea?.text) {
          await axios.post('/api/content', legacyPayload(idea))
        }
      }
      localStorage.setItem(MIGRATION_KEY, new Date().toISOString())
    } catch (error) {
      setState((prev) => ({ ...prev, error: `Legacy migration paused: ${errorMessage(error)}` }))
    }
  }, [])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      await migrateLegacyIdeas()
      if (active) await fetchContent()
    }
    initialize()
    const onFocus = () => fetchContent({ quiet: true })
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchContent, migrateLegacyIdeas])

  const patch = useCallback((partial) => {
    setState((prev) => ({ ...prev, ...partial }))
  }, [])

  const setCurrentStage = useCallback((id) => {
    setState((prev) => ({ ...prev, currentStage: id }))
  }, [])

  const replaceIdea = useCallback((item) => {
    setState((prev) => ({
      ...prev,
      ideas: prev.ideas.map((idea) => (idea.id === item.id ? item : idea)),
      error: null,
    }))
  }, [])

  const updateRemote = useCallback(async (id, changes, optimistic) => {
    let previous
    setState((prev) => {
      previous = prev.ideas.find((idea) => idea.id === id)
      return {
        ...prev,
        error: null,
        ideas: prev.ideas.map((idea) => (idea.id === id ? optimistic(idea) : idea)),
      }
    })
    try {
      const response = await axios.patch(`/api/content/${id}`, changes)
      replaceIdea(response.data.item)
      return response.data.item
    } catch (error) {
      setState((prev) => ({
        ...prev,
        ideas: prev.ideas.map((idea) => (idea.id === id && previous ? previous : idea)),
        error: errorMessage(error),
      }))
      return null
    }
  }, [replaceIdea])

  const addIdea = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      const response = await axios.post('/api/content', {
        text: trimmed,
        stage: 'idea-generation',
        impact: 3,
        effort: 3,
      })
      setState((prev) => ({
        ...prev,
        ideas: [response.data.item, ...prev.ideas.filter((idea) => idea.id !== response.data.item.id)],
        error: null,
      }))
    } catch (error) {
      setState((prev) => ({ ...prev, error: errorMessage(error) }))
    }
  }, [])

  const updateIdea = useCallback((id, partial) => {
    const allowed = Object.fromEntries(
      Object.entries(partial).filter(([key]) => ['text', 'impact', 'effort'].includes(key)),
    )
    return updateRemote(id, allowed, (idea) => ({ ...idea, ...allowed }))
  }, [updateRemote])

  const moveIdea = useCallback((id, stage, extras = {}) => (
    updateRemote(id, { stage, ...extras }, (idea) => ({
      ...idea,
      ...extras,
      stage,
      stageName: stage,
      filmingDate: extras.filmingDate ?? idea.filmingDate,
      decision: stage === 'denied'
        ? 'denied'
        : ['idea-generation', 'idea-selection'].includes(stage)
          ? 'pending'
          : 'approved',
      data: {
        ...idea.data,
        filmingDate: extras.filmingDate ?? idea.data?.filmingDate,
        publishDate: extras.publishDate ?? idea.data?.publishDate,
        postedAt: extras.postedAt ?? idea.data?.postedAt,
      },
    }))
  ), [updateRemote])

  const setIdeaDecision = useCallback((id, decision) => {
    const idea = state.ideas.find((item) => item.id === id)
    const toggling = idea?.decision === decision
    return moveIdea(id, toggling ? 'idea-selection' : decision === 'approved' ? 'planning' : 'denied')
  }, [moveIdea, state.ideas])

  const approveIdea = useCallback((id, { filmingDate, publishDate }) => {
    if (!filmingDate || !publishDate) return
    return moveIdea(id, 'planning', { filmingDate, publishDate, dueDate: filmingDate })
  }, [moveIdea])

  const advanceIdea = useCallback((id) => {
    const idea = state.ideas.find((item) => item.id === id)
    if (!idea) return
    const index = STAGE_FLOW.indexOf(idea.stage)
    if (index === -1 || index === STAGE_FLOW.length - 1) return
    return moveIdea(id, STAGE_FLOW[index + 1])
  }, [moveIdea, state.ideas])

  const sendIdeaBack = useCallback((id) => {
    const idea = state.ideas.find((item) => item.id === id)
    if (!idea) return
    const index = STAGE_FLOW.indexOf(idea.stage)
    if (index <= 0) return
    return moveIdea(id, STAGE_FLOW[index - 1])
  }, [moveIdea, state.ideas])

  const markPosted = useCallback((id) => {
    const postedAt = new Date().toISOString()
    setState((prev) => ({
      ...prev,
      weeklyCounts: {
        ...prev.weeklyCounts,
        [currentWeek]: (prev.weeklyCounts[currentWeek] || 0) + 1,
      },
    }))
    return moveIdea(id, 'engagement', { postedAt })
  }, [currentWeek, moveIdea])

  const setWeeklyCount = useCallback((count) => {
    setState((prev) => ({
      ...prev,
      weeklyCounts: { ...prev.weeklyCounts, [currentWeek]: Math.max(0, count) },
    }))
  }, [currentWeek])

  const removeIdea = useCallback((id) => moveIdea(id, 'denied'), [moveIdea])

  const weeklyPostedFromNotion = useMemo(() => state.ideas.filter((idea) => {
    const posted = idea.data?.postedAt || (
      ['engagement', 'iteration', 'shipped'].includes(idea.stage) ? idea.data?.publishDate : null
    )
    return posted && weekKey(new Date(posted)) === currentWeek
  }).length, [currentWeek, state.ideas])

  return {
    state,
    currentWeek,
    weeklyPosted: Math.max(state.weeklyCounts[currentWeek] || 0, weeklyPostedFromNotion),
    patch,
    setCurrentStage,
    refresh: fetchContent,
    addIdea,
    updateIdea,
    setIdeaDecision,
    approveIdea,
    advanceIdea,
    sendIdeaBack,
    markPosted,
    removeIdea,
    setWeeklyCount,
  }
}

export { weekKey }
