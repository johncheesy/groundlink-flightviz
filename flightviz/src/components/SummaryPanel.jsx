function fmtDur(s) {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function KV({ k, v, u, accent, sm, wide }) {
  return (
    <div className={'fv-kv' + (wide ? ' fv-kv--wide' : '')}>
      <div className="fv-kv__k">{k}</div>
      <div className={'fv-kv__v' + (sm ? ' fv-kv__v--sm' : '') + (accent ? ' fv-kv__v--accent' : '')}>
        {v}{u && <span className="fv-kv__u">{u}</span>}
      </div>
    </div>
  )
}

const pct = (v) => (v != null ? Math.round(v * 100) + '%' : '—')

export default function SummaryPanel({ flight }) {
  const s = flight.summary
  const dist = s.total_dist_m >= 1000 ? (s.total_dist_m / 1000).toFixed(2) : Math.round(s.total_dist_m)
  const distU = s.total_dist_m >= 1000 ? 'km' : 'm'
  const hasRssi = s.rssi_avg != null

  return (
    <div className="fv-kv-grid">
      <KV k="Duration" v={fmtDur(flight.duration_s)} accent />
      <KV k="Max alt" v={s.max_alt != null ? s.max_alt.toFixed(1) : '—'} u="m" accent />
      <KV k="Max speed" v={s.max_speed != null ? s.max_speed.toFixed(1) : '—'} u="m/s" />
      <KV k="Total dist" v={dist} u={distU} />
      <KV k="Track pts" v={s.track_points} sm />
      <KV k="Fix quality" v={s.fix_quality} sm />
      {hasRssi && <KV k="RSSI min" v={pct(s.rssi_min)} sm />}
      {hasRssi && <KV k="RSSI avg" v={pct(s.rssi_avg)} sm accent />}
      {hasRssi && <KV k="RSSI max" v={pct(s.rssi_max)} sm />}
      <KV k="Modes flown" v={s.modes_flown.length ? s.modes_flown.join(' › ') : '—'} sm wide />
      <KV k="Start DTG" v={s.start_utc || 'N/A · no GPS time'} sm wide />
      <KV k="Source file" v={flight.filename} sm wide />
    </div>
  )
}
