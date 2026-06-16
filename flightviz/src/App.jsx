import { useEffect, useState, useCallback, useRef } from 'react'
import MapPanel from './components/MapPanel.jsx'
import TelemetryPanel from './components/TelemetryPanel.jsx'
import SummaryPanel from './components/SummaryPanel.jsx'
import { normalizeFlights } from './loadData.js'

const BASE = import.meta.env.BASE_URL || '/'

const BUILTINS = [
  { id: 'drone1', label: 'DRONE 1', kind: 'builtin' },
  { id: 'drone2', label: 'DRONE 2', kind: 'builtin' },
]

export default function App() {
  const [sources, setSources] = useState(BUILTINS)
  const [flightsById, setFlightsById] = useState({})
  const [activeId, setActiveId] = useState('drone1')
  const [sel, setSel] = useState(0)
  const [hoverT, setHoverT] = useState(null)
  const [grid, setGrid] = useState(false)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)
  const uploadSeq = useRef(0)
  const dragDepth = useRef(0)

  // lazy-load built-in datasets on first selection
  useEffect(() => {
    if (flightsById[activeId]) return
    const src = sources.find((s) => s.id === activeId)
    if (!src || src.kind !== 'builtin') return
    setErr(null)
    fetch(`${BASE}data/${activeId}.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => {
        const flights = normalizeFlights(d)
        setFlightsById((prev) => ({ ...prev, [activeId]: flights }))
        setSel(flights.length ? flights.length - 1 : 0)
      })
      .catch((e) => setErr(String(e)))
  }, [activeId, sources, flightsById])

  const flights = flightsById[activeId]
  const flight = flights && flights[sel]

  const onHover = useCallback((t) => setHoverT(t), [])

  const selectSource = (id) => {
    setActiveId(id)
    setHoverT(null)
    const f = flightsById[id]
    if (f) setSel(f.length ? f.length - 1 : 0)
  }

  // ---- upload handling --------------------------------------------------
  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const bins = files.filter((f) => /\.bin$/i.test(f.name))
    const jsons = files.filter((f) => /\.json$/i.test(f.name))

    let lastId = null
    for (const file of jsons) {
      try {
        const text = await file.text()
        const flights = normalizeFlights(JSON.parse(text))
        if (!flights.length) throw new Error('no flights in file')
        uploadSeq.current += 1
        const id = `upload-${uploadSeq.current}`
        const label = file.name.replace(/\.json$/i, '').toUpperCase().slice(0, 18)
        setSources((prev) => [...prev, { id, label, kind: 'upload' }])
        setFlightsById((prev) => ({ ...prev, [id]: flights }))
        lastId = id
      } catch (e) {
        setNotice({ type: 'error', text: `${file.name}: could not parse — ${e.message}` })
      }
    }
    if (lastId) {
      setActiveId(lastId) // sel defaults to main flight via the activeId effect
      setHoverT(null)
    }

    if (bins.length) {
      const names = bins.map((b) => b.name).join(' ')
      setNotice({
        type: 'info',
        text: `${bins.length} .bin file(s) cannot be decoded in-browser (pymavlink is Python-only). ` +
          `Run:  python3 extract.py <drone_id> ${names}  — then drop the generated data/<drone_id>.json here.`,
      })
    } else if (jsons.length && lastId) {
      setNotice({ type: 'ok', text: `Loaded ${jsons.length} dataset(s).` })
    }
  }, [flightsById])

  // when an upload becomes active, default to its main (last) flight
  useEffect(() => {
    const f = flightsById[activeId]
    const src = sources.find((s) => s.id === activeId)
    if (f && src?.kind === 'upload') setSel(f.length ? f.length - 1 : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // ---- window-wide drag & drop -----------------------------------------
  useEffect(() => {
    const onOver = (e) => { e.preventDefault() }
    const onEnter = (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return
      dragDepth.current += 1; setDragging(true)
    }
    const onLeave = () => { dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }
    const onDrop = (e) => {
      e.preventDefault(); dragDepth.current = 0; setDragging(false)
      handleFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleFiles])

  const flightLabel = (f, i, arr) => {
    const main = i === arr.length - 1
    const dur = `${Math.floor(f.duration_s / 60)}:${String(Math.round(f.duration_s % 60)).padStart(2, '0')}`
    return `FLT ${String(f.id).padStart(2, '0')}  ·  ${f.filename}  ·  ${dur}  ·  ${f.summary.fix_quality}${main ? '  ·  ◆ MAIN' : ''}`
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">GROUNDLINK<span className="sub">FLIGHTVIZ</span></div>

        <div className="ctrl-group">
          <span className="ctrl-label">Platform</span>
          <div className="seg">
            {sources.map((d) => (
              <button key={d.id}
                className={d.id === activeId ? 'active' : ''}
                title={d.kind === 'upload' ? 'uploaded dataset' : ''}
                onClick={() => selectSource(d.id)}>
                {d.kind === 'upload' ? '▲ ' : ''}{d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ctrl-group">
          <span className="ctrl-label">Flight</span>
          <select className="flight-select" value={sel}
            onChange={(e) => { setSel(Number(e.target.value)); setHoverT(null) }}
            disabled={!flights}>
            {flights && flights.map((f, i) => (
              <option key={i} value={i}>{flightLabel(f, i, flights)}</option>
            ))}
          </select>
        </div>

        <div className="ctrl-group">
          <button className="toggle-btn" onClick={() => fileRef.current?.click()}>
            ▲ LOAD DATA
          </button>
          <input ref={fileRef} type="file" accept=".json,.bin" multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>

        <div className="spacer" />
        {flight && (
          <div className="status-pill">
            PTS <b>{flight.summary.track_points}</b> &nbsp;·&nbsp; SRC <b>{flight.summary.has_gps ? 'GPS' : 'EKF'}</b>
          </div>
        )}
      </div>

      {notice && (
        <div className={'banner notice-' + notice.type} onClick={() => setNotice(null)}>
          {notice.type === 'error' ? '✕ ' : notice.type === 'ok' ? '✓ ' : 'ℹ '}{notice.text}
          <span className="banner-dismiss">  [dismiss]</span>
        </div>
      )}

      {flight && !flight.summary.has_gps && (
        <div className="banner">
          ⚠ NO GPS MESSAGE IN LOG — track from EKF/POS estimate · UTC/DTG unavailable, timeline shown as T+ (boot-relative seconds)
        </div>
      )}

      {err && <div className="empty">LOAD ERROR — {err}</div>}
      {!err && !flights && <div className="loading">LOADING {activeId.toUpperCase()} …</div>}
      {!err && flights && flights.length === 0 && <div className="empty">NO FLIGHTS IN DATASET</div>}

      {flight && (
        <div className="main">
          <div className="left-col">
            <MapPanel flight={flight} hoverT={hoverT} setHoverT={onHover}
              grid={grid} setGrid={setGrid} />
            <SummaryPanel flight={flight} />
          </div>
          <div className="right-col">
            <TelemetryPanel flight={flight} hoverT={hoverT} onHover={onHover} />
          </div>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-box">
            <div className="drop-title">DROP TO LOAD</div>
            <div className="drop-sub">
              .json — extract.py output (data/droneN.json) loads instantly<br />
              .bin — shows the extract.py command to run first
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
