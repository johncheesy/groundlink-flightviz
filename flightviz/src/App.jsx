import { useEffect, useState, useCallback, useRef } from 'react'
import MapPanel from './components/MapPanel.jsx'
import TelemetryPanel from './components/TelemetryPanel.jsx'
import RFPanel from './components/RFPanel.jsx'
import SummaryPanel from './components/SummaryPanel.jsx'
import { normalizeFlights } from './loadData.js'

const BASE = import.meta.env.BASE_URL || '/'

const BUILTINS = [
  { id: 'drone1', label: 'Drone 1', kind: 'builtin' },
  { id: 'drone2', label: 'Drone 2', kind: 'builtin' },
]

function fmtDur(s) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

// --- small reusable collapsible group (GroundLink left-menu style) ---------
function Group({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="panel-group" data-open={open}>
      <button className="panel-group__head" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg className="ico panel-group__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        <span className="panel-group__label">{title}</span>
      </button>
      <div className="panel-group__body">{children}</div>
    </div>
  )
}

export default function App() {
  const [sources, setSources] = useState(BUILTINS)
  const [flightsById, setFlightsById] = useState({})
  const [activeId, setActiveId] = useState('drone1')
  const [sel, setSel] = useState(0)
  const [hoverT, setHoverT] = useState(null)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [drawerTab, setDrawerTab] = useState('telemetry')
  const [drawerCollapsed, setDrawerCollapsed] = useState(false)
  const [theme, setTheme] = useState(() =>
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')

  const fileRef = useRef(null)
  const uploadSeq = useRef(0)
  const dragDepth = useRef(0)

  // theme -> <html data-theme>
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

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
  const activeSrc = sources.find((s) => s.id === activeId)

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
        const label = file.name.replace(/\.json$/i, '').slice(0, 18)
        setSources((prev) => [...prev, { id, label, kind: 'upload' }])
        setFlightsById((prev) => ({ ...prev, [id]: flights }))
        lastId = id
      } catch (e) {
        setNotice({ type: 'error', text: `${file.name}: could not parse — ${e.message}` })
      }
    }
    if (lastId) { setActiveId(lastId); setHoverT(null) }

    if (bins.length) {
      const names = bins.map((b) => b.name).join(' ')
      setNotice({
        type: 'info',
        text: `${bins.length} .bin file(s) can't be decoded in-browser (pymavlink is Python-only). ` +
          `Run:  python3 extract.py <drone_id> ${names}  — then drop the generated data/<drone_id>.json here.`,
      })
    } else if (jsons.length && lastId) {
      setNotice({ type: 'ok', text: `Loaded ${jsons.length} dataset(s).` })
    }
  }, [])

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
    const onDrop = (e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); handleFiles(e.dataTransfer.files) }
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
    return `Flt ${String(f.id).padStart(2, '0')} · ${f.filename} · ${fmtDur(f.duration_s)}${main ? ' · ◆ main' : ''}`
  }

  const openDrawerTab = (tab) => { setDrawerTab(tab); setDrawerCollapsed(false) }

  return (
    <div className="app" data-collapsed={collapsed}>
      {/* ============================ TOOLBAR =========================== */}
      <header className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '0 var(--sp-3)' }}>
        <div className="brand">
          <svg className="brand__mark" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <g fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <path d="M16 27V12" />
              <path d="M11 27h10" />
              <path d="M16 12l-4 6h8l-4-6z" fill="var(--accent)" stroke="none" />
              <path d="M9.5 9a9 9 0 0 1 13 0" opacity=".85" />
              <path d="M6.5 6a13.5 13.5 0 0 1 19 0" opacity=".5" />
            </g>
          </svg>
          <div className="brand__name">GroundLink&nbsp;<b>FlightViz</b></div>
        </div>

        <div className="toolbar__cluster">
          <span className="toolbar__label">Platform</span>
          <div className="segmented" role="group" aria-label="Platform">
            {sources.map((d) => (
              <button key={d.id} type="button" className={'segmented__btn' + (d.id === activeId ? ' is-active' : '')}
                aria-pressed={d.id === activeId} title={d.kind === 'upload' ? 'uploaded dataset' : ''}
                onClick={() => selectSource(d.id)}>
                {d.kind === 'upload' ? '▲ ' : ''}{d.label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn--sm" type="button" onClick={() => fileRef.current?.click()} title="Load extract.py JSON datasets">
          ▲ Load data
        </button>
        <input ref={fileRef} type="file" accept=".json,.bin" multiple style={{ display: 'none' }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />

        <div style={{ flex: 1 }} />

        <button className="btn btn--icon btn--ghost theme-toggle" type="button"
          title="Toggle light / dark" aria-label="Toggle light or dark theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
          <svg className="ico ico--moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" /></svg>
          <svg className="ico ico--sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        </button>
      </header>

      {/* ============================= PANEL ============================ */}
      <aside className="panel">
        <button className="panel__collapse-btn" type="button" aria-label="Hide panel" title="Hide panel" onClick={() => setCollapsed(true)}>‹</button>
        <div className="panel__head">
          <span className="panel__head-title">{activeSrc?.label || 'Flight'}</span>
          <span className="spacer" />
          {flight && <span className="badge">{flight.summary.fix_quality}</span>}
        </div>
        <div className="panel__body">
          <Group title="Flight">
            <div className="fv-field">
              <span className="field-label">Platform</span>
              <div className="segmented" role="group" aria-label="Platform">
                {sources.map((d) => (
                  <button key={d.id} type="button" className={'segmented__btn' + (d.id === activeId ? ' is-active' : '')}
                    aria-pressed={d.id === activeId} onClick={() => selectSource(d.id)}>
                    {d.kind === 'upload' ? '▲ ' : ''}{d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="fv-field">
              <span className="field-label">Flight</span>
              <select className="input" value={sel} disabled={!flights}
                onChange={(e) => { setSel(Number(e.target.value)); setHoverT(null) }}>
                {flights && flights.map((f, i) => (
                  <option key={i} value={i}>{flightLabel(f, i, flights)}</option>
                ))}
              </select>
            </div>
          </Group>

          {flight && (
            <Group title="Summary">
              <SummaryPanel flight={flight} />
            </Group>
          )}
        </div>
      </aside>

      {/* ============================== MAP ============================= */}
      <main className="map-wrap">
        <button className="panel-toggle" type="button" aria-label="Open panel" onClick={() => setCollapsed(false)}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>

        {flight && <MapPanel flight={flight} hoverT={hoverT} setHoverT={onHover} />}

        {err && <div className="fv-fault">Load error — {err}</div>}
        {!err && !flights && <div className="fv-loading">Loading {activeId}…</div>}
        {!err && flights && flights.length === 0 && <div className="fv-fault">No flights in dataset</div>}

        {notice && (
          <div className={'fv-banner fv-banner--' + notice.type} onClick={() => setNotice(null)}>
            <span>{notice.type === 'error' ? '✕' : notice.type === 'ok' ? '✓' : 'ℹ'} {notice.text}</span>
            <span style={{ color: 'var(--faint)' }}>[dismiss]</span>
          </div>
        )}
        {flight && !notice && !flight.summary.has_gps && (
          <div className="fv-banner" style={{ cursor: 'default' }}>
            ⚠ No GPS message in log — track from EKF/POS estimate · UTC unavailable, timeline is T+ (boot-relative seconds)
          </div>
        )}

        {/* ---- telemetry + RF bottom drawer ---- */}
        {flight && (
          <div className={'fv-drawer' + (drawerCollapsed ? ' is-collapsed' : '')}>
            <div className="fv-drawer__head">
              <div className="fv-drawer__tabs">
                <button className={'fv-tab' + (drawerTab === 'telemetry' ? ' is-active' : '')} type="button" onClick={() => openDrawerTab('telemetry')}>Telemetry</button>
                <button className={'fv-tab' + (drawerTab === 'rf' ? ' is-active' : '')} type="button" onClick={() => openDrawerTab('rf')}>RF link</button>
              </div>
              <span className="fv-drawer__spacer" />
              <span className="fv-drawer__hint">{flight.filename}</span>
              <button className="fv-drawer__toggle" type="button" aria-label={drawerCollapsed ? 'Expand' : 'Collapse'}
                onClick={() => setDrawerCollapsed((c) => !c)}>{drawerCollapsed ? '▴' : '▾'}</button>
            </div>
            <div className="fv-drawer__body">
              {drawerTab === 'telemetry'
                ? <TelemetryPanel flight={flight} onHover={onHover} />
                : <RFPanel flight={flight} hoverT={hoverT} onHover={onHover} />}
            </div>
          </div>
        )}
      </main>

      {/* ============================ STATUS ============================ */}
      <footer className="statusbar">
        <span className="statusbar__item">
          <span className="statusbar__dot" aria-hidden="true" />
          <span className="v">{activeSrc?.label || '—'}</span>
        </span>
        {flight && <>
          <span className="statusbar__sep" aria-hidden="true" />
          <span className="statusbar__item"><span className="k">Fix</span><span className="v">{flight.summary.fix_quality}</span></span>
          <span className="statusbar__sep" aria-hidden="true" />
          <span className="statusbar__item"><span className="k">Duration</span><span className="v">{fmtDur(flight.duration_s)}</span></span>
          <span className="statusbar__spacer" />
          <span className="statusbar__item"><span className="k">Track</span><span className="v">{flight.summary.track_points} pts · {flight.summary.has_gps ? 'GPS' : 'EKF'}</span></span>
          {flight.rc_protocol && <>
            <span className="statusbar__sep" aria-hidden="true" />
            <span className="statusbar__item"><span className="k">RC</span><span className="v">{flight.rc_protocol}{flight.rc_freq_ghz != null ? ` · ${flight.rc_freq_ghz} GHz` : ''}</span></span>
          </>}
        </>}
      </footer>

      {dragging && (
        <div className="fv-drop">
          <div className="fv-drop__box">
            <div className="fv-drop__title">Drop to load</div>
            <div className="fv-drop__sub">
              .json — extract.py output (data/droneN.json) loads instantly<br />
              .bin — shows the extract.py command to run first
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
