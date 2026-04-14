import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const defaultPaletteColors = ['#d6c0a9', '#5a492f', '#c98358', '#2f4858', '#9aa88d']
const galleryPreviewLimit = 36
const networkPreviewLimit = 3000
const timelinePreviewLimit = 3000

function getLocalizedText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return value.en || value.fi || value.sv || ''
  return ''
}

function getDescription(painting) {
  const text = getLocalizedText(painting?.description)
  if (text) return text
  if (painting?.transcription?.value) return painting.transcription.value
  return 'No curatorial description is available for this artwork yet.'
}

function parseYear(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value) return null
  const match = String(value).match(/(1[5-9]\d{2}|20\d{2})/)
  return match ? Number(match[1]) : null
}

function quantizeHex(hex) {
  const clean = String(hex || '').replace('#', '')
  if (clean.length !== 6) return '#888888'
  const parts = [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16))
  const snapped = parts.map((value) => Math.max(0, Math.min(255, Math.round(value / 32) * 32)))
  return `#${snapped.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function nextPaletteColor(currentColors) {
  const usedColors = new Set(currentColors.map((color) => String(color).toLowerCase()))
  const nextColor = defaultPaletteColors.find((color) => !usedColors.has(color.toLowerCase()))
  return nextColor || defaultPaletteColors[currentColors.length % defaultPaletteColors.length]
}

function paletteForPainting(painting) {
  return painting?.dominantColors || painting?.colorPalette || []
}

function periodLabelFromYear(year, mode) {
  const parsed = parseYear(year)
  if (!parsed) return null

  if (mode === 'year') return String(parsed)
  if (mode === 'decade') return `${Math.floor(parsed / 10) * 10}s`

  const century = Math.floor((parsed - 1) / 100) + 1
  const suffix = century % 10 === 1 && century % 100 !== 11 ? 'st' : century % 10 === 2 && century % 100 !== 12 ? 'nd' : century % 10 === 3 && century % 100 !== 13 ? 'rd' : 'th'
  return `${century}${suffix} century`
}

function groupPaintingsByPeriod(paintings, mode) {
  const buckets = new Map()

  for (const painting of paintings) {
    const year = parseYear(painting.year) ?? parseYear(painting.yearFrom)
    if (!year) continue

    const label = periodLabelFromYear(year, mode)
    if (!label) continue

    if (!buckets.has(label)) {
      buckets.set(label, [])
    }
    buckets.get(label).push({ ...painting, normalizedYear: year })
  }

  return [...buckets.entries()]
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => a.normalizedYear - b.normalizedYear),
      startYear: items[0]?.normalizedYear ?? 0,
    }))
    .sort((a, b) => a.startYear - b.startYear)
}

function TopNav() {
  return (
    <header className="top-nav">
      <div className="brand-block">
        <p className="kicker">Interactive visual archive</p>
        <h1>Chromatic Atlas</h1>
      </div>
      <nav className="tabs">
        <NavLink to="/" end>
          Gallery
        </NavLink>
        <NavLink to="/network">Artist-Color Network</NavLink>
        <NavLink to="/timeline">Timeline View</NavLink>
      </nav>
    </header>
  )
}

function ArtworkCard({ painting, showSimilarity = false }) {
  const palette = paletteForPainting(painting).slice(0, 5)

  return (
    <article className="painting-card">
      <Link className="cover-link" to={`/artwork/${painting.objectID}`}>
        <img src={painting.imageURL} alt={painting.title || 'Artwork'} loading="lazy" />
      </Link>
      <div className="painting-meta">
        <strong>{painting.title || 'Untitled'}</strong>
        <span>{painting.artist || 'Unknown artist'}</span>
        <span>{painting.year || painting.yearFrom || ''}</span>
      </div>
      <div className="swatches">
        {palette.map((color) => (
          <span key={`${painting.objectID}-${color.hex}`} style={{ background: color.hex }} title={color.hex} />
        ))}
      </div>
      {showSimilarity && typeof painting.similarity === 'number' && <p className="similarity">Color match: {painting.similarity}%</p>}
    </article>
  )
}

function GalleryPage() {
  const [paintings, setPaintings] = useState([])
  const [queryColors, setQueryColors] = useState(() => defaultPaletteColors.slice(0, 3))
  const [queryText, setQueryText] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('Loading collection...')

  useEffect(() => {
    void loadPaintings()
  }, [])

  async function loadPaintings(query = '') {
    setLoading(true)
    const url = new URL('/api/paintings', API_BASE)
    url.searchParams.set('limit', String(galleryPreviewLimit))
    if (query.trim()) url.searchParams.set('query', query.trim())

    try {
      const response = await fetch(url)
      const data = await response.json()
      setPaintings(data.paintings ?? [])
      setStatus(query ? `Showing works for ${query}` : 'Tap any artwork to open its dedicated page.')
    } catch {
      setPaintings([])
      setStatus('Backend unavailable. Start the FastAPI backend.')
    } finally {
      setLoading(false)
    }
  }

  async function searchByColor(colors) {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/search-by-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colors, limit: galleryPreviewLimit }),
      })
      const data = await response.json()
      setPaintings(data.results ?? [])
      setStatus(`Palette search returned ${data.results?.length ?? 0} artworks`)
    } catch {
      setStatus('Color search failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page-grid">
      <aside className="left-column">
        <section className="panel card-like intro-card">
          <h2>Explore by title or artist</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              void loadPaintings(queryText)
            }}
          >
            <input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Title, artist, keyword" />
            <button type="submit">Search</button>
          </form>
        </section>

        <section className="panel card-like">
          <div className="row-between">
            <h2>Palette Filter</h2>
            <div className="row-between">
              <button
                type="button"
                className="ghost"
                onClick={() => setQueryColors((prev) => [...prev, nextPaletteColor(prev)])}
              >
                Add color
              </button>
              <button type="button" className="ghost" onClick={() => setQueryColors(defaultPaletteColors.slice(0, 3))}>
                Reset
              </button>
            </div>
          </div>
          <p className="muted palette-help">Edit any swatch directly. Added colors are chosen from a rotating set so the palette changes instead of repeating the same color.</p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              void searchByColor(queryColors)
            }}
          >
            {queryColors.map((color, index) => (
              <div className="palette-row" key={`${index}-${color}`}>
                <input
                  type="color"
                  value={color}
                  onChange={(event) => {
                    const next = [...queryColors]
                    next[index] = event.target.value
                    setQueryColors(next)
                  }}
                />
                <input
                  type="text"
                  value={color}
                  placeholder="#ffffff"
                  onChange={(event) => {
                    const val = event.target.value.trim()
                    if (val && (val.length === 7 || val.length === 4)) {
                      const next = [...queryColors]
                      next[index] = val.startsWith('#') ? val : `#${val}`
                      setQueryColors(next)
                    }
                  }}
                  title="Enter hex color: #RRGGBB or #RGB"
                />
                <button className="ghost" type="button" onClick={() => queryColors.length > 1 && setQueryColors((prev) => prev.filter((_, i) => i !== index))}>
                  Remove
                </button>
              </div>
            ))}
            <button type="submit">Match Palette</button>
          </form>
        </section>

        <section className="panel card-like info-card">
          <p>{status}</p>
          <p>Design direction inspired by art-first interfaces with strong color and breathing space.</p>
        </section>
      </aside>

      <main className="panel results-surface">
        {loading ? (
          <div className="empty-state">Loading artworks...</div>
        ) : (
          <div className="grid">
            {paintings.map((painting) => (
              <ArtworkCard key={painting.objectID} painting={painting} />
            ))}
          </div>
        )}
      </main>
    </section>
  )
}

function ArtworkDetailPage() {
  const { id } = useParams()
  const [painting, setPainting] = useState(null)
  const [similar, setSimilar] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    void loadDetails(id)
  }, [id])

  async function loadDetails(objectId) {
    setLoading(true)
    try {
      const detailResponse = await fetch(`${API_BASE}/api/painting/${objectId}`)
      const detail = await detailResponse.json()
      const similarResponse = await fetch(`${API_BASE}/api/similar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectID: Number(objectId), limit: 18 }),
      })
      const similarData = await similarResponse.json()
      setPainting(detail)
      setSimilar(similarData.similar_paintings ?? [])
    } catch {
      setPainting(null)
      setSimilar([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="panel detail-layout">Loading artwork...</div>
  if (!painting) return <div className="panel detail-layout">Artwork not found.</div>

  const palette = paletteForPainting(painting)

  return (
    <section className="detail-layout panel">
      <div className="detail-hero">
        <img src={painting.imageURL} alt={painting.title || 'Artwork'} />
        <div className="detail-copy">
          <p className="kicker">Artwork view</p>
          <h2>{painting.title || 'Untitled'}</h2>
          <p className="meta-line">
            {painting.artist || 'Unknown'} · {painting.year || painting.yearFrom || 'Date unknown'}
          </p>
          <p>{getDescription(painting)}</p>
          <div className="detail-palette">
            {palette.map((color) => (
              <span key={color.hex} style={{ background: color.hex }} title={`${color.hex} ${color.percentage}%`} />
            ))}
          </div>
          <p className="meta-line">
            {painting.medium || 'Medium not listed'} · {painting.owner || 'Owner not listed'}
          </p>
        </div>
      </div>

      <div className="similar-section">
        <div className="row-between">
          <h3>Similar palette matches</h3>
          <Link className="ghost" to="/">
            Back to gallery
          </Link>
        </div>
        <div className="grid">
          {similar.map((item) => (
            <ArtworkCard key={item.objectID} painting={item} showSimilarity />
          ))}
        </div>
      </div>
    </section>
  )
}

function artistNameForPainting(painting) {
  return (painting.artist || 'Unknown artist').trim() || 'Unknown artist'
}

function topPaletteBucketsForPainting(painting) {
  const buckets = []
  for (const color of paletteForPainting(painting).slice(0, 3)) {
    const bucket = quantizeHex(color.hex)
    if (!buckets.includes(bucket)) {
      buckets.push(bucket)
    }
  }
  return buckets
}

function buildArtistColorNetwork(paintings, artistLimit, colorLimit) {
  const artistCounts = new Map()
  const colorCounts = new Map()

  for (const painting of paintings) {
    const artist = artistNameForPainting(painting)
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1)
    for (const bucket of topPaletteBucketsForPainting(painting)) {
      colorCounts.set(bucket, (colorCounts.get(bucket) || 0) + 1)
    }
  }

  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, artistLimit)
    .map(([label, count]) => ({ id: `artist:${label}`, label, type: 'artist', count }))

  const topColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, colorLimit)
    .map(([color, count]) => ({ id: `color:${color}`, label: color, type: 'color', color, count }))

  const artistSet = new Set(topArtists.map((item) => item.label))
  const colorSet = new Set(topColors.map((item) => item.color))
  const artworks = paintings.filter((painting) => artistSet.has(artistNameForPainting(painting)))

  const linkMap = new Map()
  for (const painting of artworks) {
    const artist = artistNameForPainting(painting)
    for (const bucket of topPaletteBucketsForPainting(painting)) {
      if (!colorSet.has(bucket)) continue
      const key = `${artist}|${bucket}`
      linkMap.set(key, {
        source: `artist:${artist}`,
        target: `color:${bucket}`,
        value: (linkMap.get(key)?.value || 0) + 1,
      })
    }
  }

  const artistSpacing = Math.max(34, 620 / Math.max(1, topArtists.length))
  const colorSpacing = Math.max(34, 620 / Math.max(1, topColors.length))

  const nodes = [
    ...topArtists.map((item, index) => ({
      ...item,
      x: 240,
      y: 86 + index * artistSpacing,
      radius: 10 + Math.min(16, item.count * 0.1),
    })),
    ...topColors.map((item, index) => ({
      ...item,
      x: 1040,
      y: 86 + index * colorSpacing,
      radius: 10 + Math.min(12, item.count * 0.08),
    })),
  ]

  return {
    title: 'Artist-Color Bipartite Graph',
    description: 'Artists are on the left, palette families are on the right, and links represent how often they co-occur.',
    nodes,
    links: [...linkMap.values()].filter((link) => link.value > 1),
    artworks,
  }
}

function buildArtistSimilarityNetwork(paintings, artistLimit) {
  const artistCounts = new Map()
  for (const painting of paintings) {
    const artist = artistNameForPainting(painting)
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1)
  }

  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, artistLimit)
    .map(([label, count]) => ({ id: `artist:${label}`, label, type: 'artist', count }))

  const artistSet = new Set(topArtists.map((artist) => artist.label))
  const artworks = paintings.filter((painting) => artistSet.has(artistNameForPainting(painting)))
  const artistToColors = new Map(topArtists.map((artist) => [artist.label, new Set()]))

  for (const painting of artworks) {
    const artist = artistNameForPainting(painting)
    const paletteSet = artistToColors.get(artist)
    if (!paletteSet) continue
    for (const bucket of topPaletteBucketsForPainting(painting)) {
      paletteSet.add(bucket)
    }
  }

  const links = []
  for (let i = 0; i < topArtists.length; i += 1) {
    for (let j = i + 1; j < topArtists.length; j += 1) {
      const source = topArtists[i]
      const target = topArtists[j]
      const sourceSet = artistToColors.get(source.label) || new Set()
      const targetSet = artistToColors.get(target.label) || new Set()
      let overlap = 0
      for (const color of sourceSet) {
        if (targetSet.has(color)) overlap += 1
      }
      if (overlap > 0) {
        links.push({ source: source.id, target: target.id, value: overlap })
      }
    }
  }

  const centerX = 640
  const centerY = 380
  const ringRadius = 275
  const nodes = topArtists.map((artist, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, topArtists.length) - Math.PI / 2
    return {
      ...artist,
      x: centerX + Math.cos(angle) * ringRadius,
      y: centerY + Math.sin(angle) * ringRadius,
      radius: 11 + Math.min(17, artist.count * 0.14),
    }
  })

  return {
    title: 'Artist Similarity Network',
    description: 'Artists are linked when their palettes overlap across the top extracted colors.',
    nodes,
    links: links.sort((a, b) => b.value - a.value).slice(0, 100),
    artworks,
  }
}

function buildColorCooccurrenceNetwork(paintings, colorLimit) {
  const colorCounts = new Map()
  for (const painting of paintings) {
    for (const bucket of topPaletteBucketsForPainting(painting)) {
      colorCounts.set(bucket, (colorCounts.get(bucket) || 0) + 1)
    }
  }

  const topColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, colorLimit)
    .map(([color, count]) => ({ id: `color:${color}`, label: color, type: 'color', color, count }))

  const colorSet = new Set(topColors.map((item) => item.color))
  const linkMap = new Map()

  for (const painting of paintings) {
    const colors = topPaletteBucketsForPainting(painting).filter((bucket) => colorSet.has(bucket))
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        const left = colors[i]
        const right = colors[j]
        const key = left < right ? `${left}|${right}` : `${right}|${left}`
        linkMap.set(key, {
          source: `color:${left < right ? left : right}`,
          target: `color:${left < right ? right : left}`,
          value: (linkMap.get(key)?.value || 0) + 1,
        })
      }
    }
  }

  const centerX = 640
  const centerY = 380
  const ringRadius = 275
  const nodes = topColors.map((color, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, topColors.length) - Math.PI / 2
    return {
      ...color,
      x: centerX + Math.cos(angle) * ringRadius,
      y: centerY + Math.sin(angle) * ringRadius,
      radius: 11 + Math.min(13, color.count * 0.2),
    }
  })

  return {
    title: 'Color Co-occurrence Network',
    description: 'Colors are connected when they appear together in the same artwork palette.',
    nodes,
    links: [...linkMap.values()].filter((link) => link.value > 1).sort((a, b) => b.value - a.value).slice(0, 140),
    artworks: paintings,
  }
}

function NetworkPage() {
  const [paintings, setPaintings] = useState([])
  const [network, setNetwork] = useState({ title: '', description: '', nodes: [], links: [], artworks: [] })
  const [visualization, setVisualization] = useState('artist-color')
  const [artistCount, setArtistCount] = useState(14)
  const [colorCount, setColorCount] = useState(12)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadNetworkData()
  }, [])

  useEffect(() => {
    if (!paintings.length) {
      setNetwork({ title: '', description: '', nodes: [], links: [], artworks: [] })
      return
    }

    if (visualization === 'artist-artist') {
      setNetwork(buildArtistSimilarityNetwork(paintings, artistCount))
      return
    }

    if (visualization === 'color-color') {
      setNetwork(buildColorCooccurrenceNetwork(paintings, colorCount))
      return
    }

    setNetwork(buildArtistColorNetwork(paintings, artistCount, colorCount))
  }, [paintings, visualization, artistCount, colorCount])

  useEffect(() => {
    if (!network.nodes.length) {
      setSelectedNodeId(null)
      return
    }
    if (selectedNodeId && network.nodes.some((node) => node.id === selectedNodeId)) {
      return
    }
    setSelectedNodeId(network.nodes[0].id)
  }, [network.nodes, selectedNodeId])

  async function loadNetworkData() {
    setLoading(true)
    try {
      const url = new URL('/api/paintings', API_BASE)
      url.searchParams.set('limit', String(networkPreviewLimit))
      const response = await fetch(url)
      const payload = await response.json()
      setPaintings(payload.paintings ?? [])
    } catch {
      setPaintings([])
      setNetwork({ title: '', description: '', nodes: [], links: [], artworks: [] })
    } finally {
      setLoading(false)
    }
  }

  const nodeById = useMemo(() => {
    const map = new Map()
    for (const node of network.nodes) {
      map.set(node.id, node)
    }
    return map
  }, [network.nodes])

  const neighbors = useMemo(() => {
    const map = new Map()
    for (const link of network.links) {
      if (!map.has(link.source)) map.set(link.source, new Set())
      if (!map.has(link.target)) map.set(link.target, new Set())
      map.get(link.source).add(link.target)
      map.get(link.target).add(link.source)
    }
    return map
  }, [network.links])

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : null

  const relatedArtworks = useMemo(() => {
    if (!selectedNode) {
      return network.artworks.slice(0, 12)
    }

    if (selectedNode.type === 'artist') {
      return network.artworks.filter((painting) => artistNameForPainting(painting) === selectedNode.label).slice(0, 12)
    }

    if (selectedNode.type === 'color') {
      const colorKey = selectedNode.color || selectedNode.label
      return network.artworks.filter((painting) => topPaletteBucketsForPainting(painting).includes(colorKey)).slice(0, 12)
    }

    return network.artworks.slice(0, 12)
  }, [network.artworks, selectedNode])

  return (
    <section className="network-layout">
      <div className="panel network-canvas">
        {loading ? (
          <div className="empty-state">Building network from updated JSON cache...</div>
        ) : (
          <svg viewBox="0 0 1280 760" role="img" aria-label="Artwork network visualization">
            <defs>
              <linearGradient id="network-link-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1f2f2b" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#c56f43" stopOpacity="0.25" />
              </linearGradient>
            </defs>

            {network.links.map((link, index) => {
              const source = nodeById.get(link.source)
              const target = nodeById.get(link.target)
              if (!source || !target) return null

              const active =
                !selectedNodeId ||
                link.source === selectedNodeId ||
                link.target === selectedNodeId ||
                neighbors.get(selectedNodeId)?.has(link.source) ||
                neighbors.get(selectedNodeId)?.has(link.target)

              return (
                <path
                  key={`${link.source}-${link.target}-${index}`}
                  d={
                    visualization === 'artist-color'
                      ? `M ${source.x + 18} ${source.y} C ${source.x + 160} ${source.y - 24}, ${target.x - 160} ${target.y + 24}, ${target.x - 18} ${target.y}`
                      : `M ${source.x} ${source.y} L ${target.x} ${target.y}`
                  }
                  fill="none"
                  stroke={active ? 'url(#network-link-gradient)' : 'rgba(46, 42, 36, 0.06)'}
                  strokeWidth={Math.min(8, 1 + link.value * 0.16)}
                />
              )
            })}

            {network.nodes.map((node) => {
              const active = !selectedNodeId || node.id === selectedNodeId || neighbors.get(selectedNodeId)?.has(node.id)
              const labelX = visualization === 'artist-color' ? (node.type === 'artist' ? 22 : -22) : 0
              const labelY = visualization === 'artist-color' ? 4 : -(Math.max(8, node.radius) + 10)
              const labelAnchor = visualization === 'artist-color' ? (node.type === 'artist' ? 'start' : 'end') : 'middle'

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="node-group"
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <circle
                    r={Math.max(8, node.radius)}
                    fill={node.type === 'color' ? node.color : '#1f2f2b'}
                    stroke={node.type === 'color' ? '#ffffff' : '#f7f0e6'}
                    strokeWidth={active ? 2.4 : 1.2}
                    opacity={active ? 1 : 0.25}
                  />
                  <text x={labelX} y={labelY} textAnchor={labelAnchor} className="network-label" opacity={active ? 1 : 0.3}>
                    {node.label}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>

      <aside className="panel network-info">
        <h2>{network.title || 'Network View'}</h2>
        <p>{network.description || 'Choose a network view to begin exploring relationships.'}</p>

        <div className="network-controls">
          <label>
            Visualization
            <select value={visualization} onChange={(event) => setVisualization(event.target.value)}>
              <option value="artist-color">Artist-Color Bipartite</option>
              <option value="artist-artist">Artist Similarity</option>
              <option value="color-color">Color Co-occurrence</option>
            </select>
          </label>

          <div className="network-control-grid">
            <label>
              Artists
              <input
                type="number"
                min="4"
                max="28"
                value={artistCount}
                onChange={(event) => setArtistCount(Math.max(4, Math.min(28, Number(event.target.value) || 4)))}
              />
            </label>
            <label>
              Colors
              <input
                type="number"
                min="4"
                max="28"
                value={colorCount}
                onChange={(event) => setColorCount(Math.max(4, Math.min(28, Number(event.target.value) || 4)))}
              />
            </label>
          </div>

          <button type="button" className="ghost" onClick={() => void loadNetworkData()}>
            Refresh From JSON
          </button>

          <p className="network-stat-line">
            Data loaded: {paintings.length} artworks · {network.nodes.length} nodes · {network.links.length} links
          </p>
        </div>

        {selectedNode ? (
          <div className="selection-card">
            <p><strong>Selected:</strong> {selectedNode.label}</p>
            <p><strong>Type:</strong> {selectedNode.type}</p>
            <p><strong>Connections:</strong> {selectedNodeId ? neighbors.get(selectedNodeId)?.size || 0 : 0}</p>
          </div>
        ) : (
          <p className="muted">No node selected yet.</p>
        )}

        <div className="network-artworks">
          <h3>Related works</h3>
          <div className="network-artworks-grid">
            {relatedArtworks.map((painting) => (
              <Link className="network-mini-card" key={painting.objectID} to={`/artwork/${painting.objectID}`}>
                <img src={painting.imageURL} alt={painting.title || 'Artwork'} />
                <strong>{painting.title || 'Untitled'}</strong>
                <span>{painting.artist || 'Unknown artist'}</span>
              </Link>
            ))}
          </div>
        </div>
      </aside>
    </section>
  )
}

function TimelinePage() {
  const [paintings, setPaintings] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('decade')
  const [activePeriod, setActivePeriod] = useState(null)
  const railRef = useRef(null)
  const scrubRef = useRef(null)

  useEffect(() => {
    void loadTimeline()
  }, [])

  useEffect(() => {
    if (railRef.current) {
      railRef.current.scrollTo({ left: 0, behavior: 'auto' })
    }
    if (scrubRef.current) {
      scrubRef.current.value = '0'
    }
  }, [viewMode])

  async function loadTimeline() {
    setLoading(true)
    try {
      const url = new URL('/api/paintings', API_BASE)
      url.searchParams.set('limit', String(timelinePreviewLimit))
      const response = await fetch(url)
      const data = await response.json()
      const withYear = (data.paintings ?? [])
        .map((painting) => ({ ...painting, normalizedYear: parseYear(painting.year) ?? parseYear(painting.yearFrom) }))
        .filter((painting) => Number.isFinite(painting.normalizedYear))
        .sort((a, b) => a.normalizedYear - b.normalizedYear)
      setPaintings(withYear)
      const groups = groupPaintingsByPeriod(withYear, 'decade')
      setActivePeriod(groups[0]?.label || null)
    } catch {
      setPaintings([])
      setActivePeriod(null)
    } finally {
      setLoading(false)
    }
  }

  const periods = useMemo(() => groupPaintingsByPeriod(paintings, viewMode), [paintings, viewMode])

  useEffect(() => {
    if (!activePeriod && periods.length > 0) {
      setActivePeriod(periods[0].label)
    }
  }, [periods, activePeriod])

  const activeGroup = periods.find((period) => period.label === activePeriod) || periods[0] || null

  function syncScrubber() {
    if (!railRef.current || !scrubRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = railRef.current
    const max = Math.max(1, scrollWidth - clientWidth)
    scrubRef.current.value = String(Math.round((scrollLeft / max) * 100))
  }

  function moveRail(value) {
    if (!railRef.current) return
    const { scrollWidth, clientWidth } = railRef.current
    const max = Math.max(1, scrollWidth - clientWidth)
    railRef.current.scrollTo({ left: (Number(value) / 100) * max, behavior: 'smooth' })
  }

  return (
    <section className="timeline-layout panel timeline-stage">
      <div className="timeline-head timeline-hero">
        <div>
          <p className="kicker">Art timeline</p>
          <h2>Sliding through centuries, decades, and years</h2>
          <p>Use the rail, scrubber, and period chips to move through the collection like a cinematic timeline.</p>
        </div>
        <div className="timeline-modes">
          {['century', 'decade', 'year'].map((mode) => (
            <button key={mode} type="button" className={viewMode === mode ? 'year-pill active' : 'year-pill'} onClick={() => setViewMode(mode)}>
              {mode}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Building timeline...</div>
      ) : (
        <>
          <div className="timeline-scrubber">
            <span>Slide</span>
            <input ref={scrubRef} type="range" min="0" max="100" defaultValue="0" onChange={(event) => moveRail(event.target.value)} />
            <span>{viewMode}</span>
          </div>

          <div className="timeline-rail" ref={railRef} onScroll={syncScrubber}>
            {periods.map((period) => (
              <section
                className={period.label === activePeriod ? 'timeline-card active' : 'timeline-card'}
                key={`${viewMode}-${period.label}`}
                onClick={() => setActivePeriod(period.label)}
              >
                <div className="timeline-card-head">
                  <h3>{period.label}</h3>
                  <span>{period.items.length} works</span>
                </div>
                <div className="timeline-works">
                  {period.items.slice(0, 8).map((painting) => (
                    <Link className="timeline-art" key={painting.objectID} to={`/artwork/${painting.objectID}`}>
                      <img src={painting.imageURL} alt={painting.title || 'Artwork'} />
                      <strong>{painting.title || 'Untitled'}</strong>
                      <span>{painting.artist || 'Unknown artist'}</span>
                      <span>{painting.normalizedYear}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {activeGroup && (
            <section className="timeline-detail">
              <div className="row-between">
                <div>
                  <p className="kicker">Current period</p>
                  <h3>{activeGroup.label}</h3>
                </div>
                <p className="timeline-count">{activeGroup.items.length} artworks in this period</p>
              </div>
              <div className="timeline-detail-grid">
                {activeGroup.items.slice(0, 12).map((painting) => (
                  <ArtworkCard key={painting.objectID} painting={painting} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  )
}

function App() {
  return (
    <div className="app-shell">
      <TopNav />
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/artwork/:id" element={<ArtworkDetailPage />} />
        <Route path="/network" element={<NetworkPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
      </Routes>
    </div>
  )
}

export default App
