function fmtDur(s) {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function KV({ k, v, u, accent, small }) {
  return (
    <div className="kv">
      <div className="k">{k}</div>
      <div className={'v' + (accent ? ' accent' : '') + (small ? ' small' : '')}>
        {v}{u && <span className="u">{u}</span>}
      </div>
    </div>
  )
}

export default function SummaryPanel({ flight }) {
  const s = flight.summary
  const dist = s.total_dist_m >= 1000
    ? (s.total_dist_m / 1000).toFixed(2)
    : Math.round(s.total_dist_m)
  const distU = s.total_dist_m >= 1000 ? 'km' : 'm'

  return (
    <div className="panel summary-panel">
      <div className="panel-head">
        <span className="panel-title">FLIGHT SUMMARY · FLT {String(flight.id).padStart(2, '0')}</span>
        <span className="panel-title">{s.fix_quality}</span>
      </div>
      <div className="kv-grid">
        <KV k="DURATION" v={fmtDur(flight.duration_s)} accent />
        <KV k="MAX ALT" v={s.max_alt != null ? s.max_alt.toFixed(1) : '—'} u="m" accent />
        <KV k="MAX SPEED" v={s.max_speed != null ? s.max_speed.toFixed(1) : '—'} u="m/s" accent />
        <KV k="TOTAL DIST" v={dist} u={distU} />
        <KV k="TRACK PTS" v={s.track_points} />
        <KV k="FIX QUALITY" v={s.fix_quality} small />
        <KV k="MODES FLOWN" v={s.modes_flown.length ? s.modes_flown.join(' › ') : '—'} small />
        <KV k="START DTG" v={s.start_utc || 'N/A · NO GPS TIME'} small />
        <KV k="SOURCE FILE" v={flight.filename} small />
      </div>
    </div>
  )
}
