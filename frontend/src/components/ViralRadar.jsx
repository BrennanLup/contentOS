import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import './ViralRadar.css'

const NICHES = ['Triathlon', 'Advice']

async function pollJob(jobId) {
  const started = Date.now()
  const timeoutMs = 8 * 60 * 1000

  while (Date.now() - started < timeoutMs) {
    const response = await axios.get(`/api/jobs/${jobId}`)
    const job = response.data
    if (job.status === 'done' && job.result) {
      return job.result
    }
    if (job.status === 'error') {
      throw new Error(job.error || 'Scan failed')
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error('Scan timed out. Try again with fewer creators.')
}

function formatCount(value) {
  const n = Number(value) || 0
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatAge(iso) {
  if (!iso) return 'Unknown date'
  const published = new Date(iso)
  const days = Math.max(0, (Date.now() - published.getTime()) / 86400000)
  if (days < 1) return 'Today'
  if (days < 2) return '1 day ago'
  if (days < 14) return `${Math.floor(days)} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return published.toLocaleDateString()
}

function YoutubeAttach({ creatorId, onLinked, onError }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    if (!value.trim()) return
    try {
      setSaving(true)
      await axios.patch(`/api/creators/${creatorId}`, { youtube_url: value })
      setValue('')
      await onLinked()
    } catch (err) {
      onError(err.response?.data?.error || err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="youtube-attach" onSubmit={save}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste YouTube URL"
      />
      <button type="submit" className="btn-ghost" disabled={saving}>
        Link
      </button>
    </form>
  )
}

function ViralRadar({ onDeconstruct }) {
  const [creators, setCreators] = useState([])
  const [niches, setNiches] = useState([])
  const [scan, setScan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [source, setSource] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [niche, setNiche] = useState('all')
  const [sort, setSort] = useState('virality')
  const [form, setForm] = useState({
    instagram: '',
    youtube: '',
    name: '',
    niche: 'Triathlon',
  })

  const load = async () => {
    const [watchlist, latest] = await Promise.all([
      axios.get('/api/creators'),
      axios.get('/api/viral/latest'),
    ])
    setCreators(watchlist.data.creators || [])
    setNiches(watchlist.data.niches || [])
    setScan(latest.data?.posts?.length ? latest.data : null)
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false))
  }, [])

  const runScan = async (includeDiscovery) => {
    try {
      setScanning(true)
      setError(null)
      const response = await axios.post('/api/viral/scan', {
        include_discovery: includeDiscovery,
        limit: 12,
      })
      const result = await pollJob(response.data.job_id)
      setScan(result)
      const watchlist = await axios.get('/api/creators')
      setCreators(watchlist.data.creators || [])
      setNiches(watchlist.data.niches || [])
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const addCreator = async (e) => {
    e.preventDefault()
    try {
      setError(null)
      await axios.post('/api/creators', {
        instagram_url: form.instagram,
        youtube_url: form.youtube,
        name: form.name,
        niche: form.niche,
      })
      setForm({ instagram: '', youtube: '', name: '', niche: form.niche })
      const watchlist = await axios.get('/api/creators')
      setCreators(watchlist.data.creators || [])
      setNiches(watchlist.data.niches || [])
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    }
  }

  const addSuggestion = async (suggestion) => {
    try {
      setError(null)
      await axios.post('/api/creators', {
        name: suggestion.name,
        niche: suggestion.niche,
        youtube_url: suggestion.youtube_url || suggestion.youtube_handle,
      })
      const watchlist = await axios.get('/api/creators')
      setCreators(watchlist.data.creators || [])
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    }
  }

  const removeCreator = async (id) => {
    await axios.delete(`/api/creators/${id}`)
    setCreators((current) => current.filter((creator) => creator.id !== id))
  }

  const posts = useMemo(() => {
    const list = scan?.posts || []
    const filtered = list.filter((post) => {
      if (source === 'watchlist' && post.source !== 'watchlist') return false
      if (source === 'discovery' && post.source !== 'discovery') return false
      if (platform !== 'all' && post.platform !== platform) return false
      if (niche !== 'all' && post.niche !== niche) return false
      return true
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sort === 'views') return (b.view_count || 0) - (a.view_count || 0)
      if (sort === 'recent') {
        return (b.published_at || '').localeCompare(a.published_at || '')
      }
      return (b.virality_score || 0) - (a.virality_score || 0)
    })
    return sorted
  }, [scan, source, platform, niche, sort])

  const groupedCreators = useMemo(() => {
    const groups = {}
    creators.forEach((creator) => {
      const key = creator.niche || 'General'
      groups[key] = groups[key] || []
      groups[key].push(creator)
    })
    return groups
  }, [creators])

  if (loading) {
    return (
      <div className="radar-shell">
        <p>Loading watchlist…</p>
      </div>
    )
  }

  return (
    <div className="radar-shell">
      <section className="radar-sidebar">
        <div className="radar-card">
          <h2>Watchlist</h2>
          <p className="radar-help">
            Track Instagram and YouTube accounts. Scans rank recent posts by views,
            engagement, and how far they overperformed that creator&apos;s usual numbers.
          </p>
          {Object.entries(groupedCreators).map(([group, people]) => (
            <div key={group} className="creator-group">
              <h3>{group}</h3>
              {people.map((creator) => (
                <div key={creator.id} className="creator-row">
                  <div>
                    <strong>{creator.name}</strong>
                    <div className="creator-meta">
                      {creator.instagram_handle && <span>IG @{creator.instagram_handle}</span>}
                      {creator.youtube_url ? (
                        <span>YouTube connected</span>
                      ) : (
                        <span className="muted">YouTube not linked</span>
                      )}
                    </div>
                    {!creator.youtube_url && (
                      <YoutubeAttach
                        creatorId={creator.id}
                        onLinked={load}
                        onError={setError}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => removeCreator(creator.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <form className="radar-card" onSubmit={addCreator}>
          <h2>Add a creator</h2>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Display name (optional)"
          />
          <input
            value={form.instagram}
            onChange={(e) => setForm({ ...form, instagram: e.target.value })}
            placeholder="Instagram URL or @handle"
          />
          <input
            value={form.youtube}
            onChange={(e) => setForm({ ...form, youtube: e.target.value })}
            placeholder="YouTube URL or @handle (optional)"
          />
          <select
            value={form.niche}
            onChange={(e) => setForm({ ...form, niche: e.target.value })}
          >
            {Array.from(new Set([...NICHES, ...niches.map((item) => item.name)])).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button type="submit" className="btn-primary">Add to watchlist</button>
        </form>
      </section>

      <section className="radar-main">
        <div className="radar-toolbar">
          <div>
            <h2>Viral Radar</h2>
            <p>
              {scan?.generated_at
                ? `Last scan ${new Date(scan.generated_at).toLocaleString()}`
                : 'No scan yet — run one to rank recent posts.'}
            </p>
          </div>
          <div className="radar-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={scanning}
              onClick={() => runScan(false)}
            >
              Scan watchlist
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={scanning}
              onClick={() => runScan(true)}
            >
              {scanning ? 'Scanning…' : 'Scan + find new people'}
            </button>
          </div>
        </div>

        {error && <div className="radar-error">{error}</div>}

        {scan?.warnings?.length > 0 && (
          <div className="radar-warning">
            Instagram listing is blocked without cookies, so those profiles were skipped.
            YouTube still scanned. Link a YouTube URL or set <code>YTDLP_COOKIES</code> for Instagram.
          </div>
        )}

        {scanning && (
          <div className="radar-progress">
            Pulling recent Instagram and YouTube posts, then ranking by virality.
            Discovery searches YouTube for each niche to surface new creators.
          </div>
        )}

        <div className="radar-filters">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All sources</option>
            <option value="watchlist">Watchlist only</option>
            <option value="discovery">New people</option>
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="all">IG + YouTube</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
          <select value={niche} onChange={(e) => setNiche(e.target.value)}>
            <option value="all">All niches</option>
            {Array.from(new Set(creators.map((creator) => creator.niche).filter(Boolean))).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="virality">Sort: virality</option>
            <option value="views">Sort: views</option>
            <option value="recent">Sort: newest</option>
          </select>
        </div>

        <div className="post-grid">
          {posts.length === 0 && !scanning && (
            <div className="empty-state">
              {scan ? 'No posts match these filters.' : 'Run a scan to see viral posts from your space.'}
            </div>
          )}
          {posts.map((post) => (
            <article key={`${post.platform}-${post.id}`} className="post-card">
              <div className="post-thumb">
                {post.thumbnail ? (
                  <img src={post.thumbnail} alt="" />
                ) : (
                  <div className="thumb-fallback">{post.platform === 'instagram' ? 'IG' : 'YT'}</div>
                )}
                <span className={`platform-chip ${post.platform}`}>{post.platform}</span>
              </div>
              <div className="post-body">
                <div className="post-kicker">
                  <span>{post.creator_name || post.creator_handle}</span>
                  {post.niche && <span>{post.niche}</span>}
                  {post.source === 'discovery' && <span className="new-chip">New</span>}
                </div>
                <h3>{post.title}</h3>
                <p className="post-metrics">
                  <span>{formatCount(post.view_count)} views</span>
                  {post.like_count ? <span>{formatCount(post.like_count)} likes</span> : null}
                  <span>{formatAge(post.published_at)}</span>
                  <span>score {post.virality_score}</span>
                </p>
                <div className="post-actions">
                  <a href={post.url} target="_blank" rel="noreferrer" className="btn-secondary">
                    Open
                  </a>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onDeconstruct(post.url)}
                  >
                    Deconstruct
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {scan?.suggestions?.length > 0 && (
          <div className="radar-card suggestions">
            <h2>New people to watch</h2>
            <p className="radar-help">
              These channels showed up in niche searches and are not on your watchlist yet.
            </p>
            <div className="suggestion-list">
              {scan.suggestions.slice(0, 8).map((suggestion) => (
                <div key={suggestion.id} className="suggestion-row">
                  <div>
                    <strong>{suggestion.name}</strong>
                    <div className="creator-meta">
                      <span>{suggestion.niche}</span>
                      <span>{formatCount(suggestion.sample_views)} views on a recent post</span>
                    </div>
                    {suggestion.sample_title && <p className="sample-title">{suggestion.sample_title}</p>}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => addSuggestion(suggestion)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default ViralRadar
