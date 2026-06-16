import { useMemo } from 'react'
import { toDMS, fmtLatLon, fmtDTG, fmtHMS } from '../format.js'

// Find the track sample nearest a time `t` (the hovered chart/map time).
function atTime(track, t) {
  if (t == null || !track.length) return null
  let best = track[0], bd = Infinity
  for (const p of track) {
    const d = Math.abs(p.t - t)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

// AGL = MSL altitude − field elevation (ORGN.Alt from the log). null if either
// is missing or the result is non-physical.
function agl(p, fieldElev) {
  if (p?.alt == null || fieldElev == null) return null
  return p.alt - fieldElev
}

function PointDetail({ p, fieldElev, label }) {
  if (!p) return null
  const a = agl(p, fieldElev)
  const kmh = p.spd != null ? (p.spd * 3.6).toFixed(1) : null
  return (
    <div className="fv-posdetail">
      {label && <div className="fv-posdetail__label">{label}</div>}
      <div className="fv-posdetail__mgrs">{p.mgrs || '— no MGRS —'}</div>
      <div className="fv-posdetail__grid">
        <span className="k">Lat/Lon</span><span className="v">{fmtLatLon(p.lat, p.lon)}</span>
        <span className="k">DMS</span><span className="v">{toDMS(p.lat, 'lat')} {toDMS(p.lon, 'lon')}</span>
        <span className="k">MSL</span><span className="v">{p.alt != null ? p.alt.toFixed(1) + ' m' : '—'}</span>
        <span className="k">AGL</span><span className="v">{a != null ? a.toFixed(1) + ' m' : '—'}</span>
        <span className="k">Speed</span><span className="v">{p.spd != null ? `${p.spd.toFixed(1)} m/s · ${kmh} km/h` : '—'}</span>
      </div>
    </div>
  )
}

// Compact one-line row for the static start/end/high/low table.
function PointRow({ tag, p, fieldElev }) {
  const a = agl(p, fieldElev)
  return (
    <tr>
      <td className="fv-postbl__tag">{tag}</td>
      <td className="fv-postbl__mgrs">{p?.mgrs || '—'}</td>
      <td>{p?.alt != null ? p.alt.toFixed(0) : '—'}</td>
      <td>{a != null ? a.toFixed(0) : '—'}</td>
      <td>{p?.spd != null ? (p.spd * 3.6).toFixed(0) : '—'}</td>
    </tr>
  )
}

export function PositionReadout({ flight, hoverT }) {
  const track = flight.track
  const fieldElev = flight.summary.field_elevation
  const p = atTime(track, hoverT) || (track.length ? track[track.length - 1] : null)

  const { start, end, high, low } = useMemo(() => {
    if (!track.length) return {}
    let high = track[0], low = track[0]
    for (const q of track) {
      if (q.alt != null) {
        if (high.alt == null || q.alt > high.alt) high = q
        if (low.alt == null || q.alt < low.alt) low = q
      }
    }
    return { start: track[0], end: track[track.length - 1], high, low }
  }, [track])

  if (!track.length) return <p className="help">No positions in this flight.</p>

  return (
    <div>
      <PointDetail p={p} fieldElev={fieldElev}
        label={hoverT != null ? 'Hovered point' : 'Latest point · hover the map or charts'} />
      <table className="fv-postbl">
        <thead>
          <tr><th></th><th>MGRS</th><th>MSL</th><th>AGL</th><th>km/h</th></tr>
        </thead>
        <tbody>
          <PointRow tag="Start" p={start} fieldElev={fieldElev} />
          <PointRow tag="End" p={end} fieldElev={fieldElev} />
          <PointRow tag="High" p={high} fieldElev={fieldElev} />
          <PointRow tag="Low" p={low} fieldElev={fieldElev} />
        </tbody>
      </table>
    </div>
  )
}

export function TrackStats({ flight }) {
  const s = flight.summary
  const distKm = (s.total_dist_m / 1000).toFixed(2)
  const startDtg = fmtDTG(s.start_utc)
  const endDtg = fmtDTG(s.end_utc)
  const row = (k, v) => (
    <div className="fv-stat"><span className="fv-stat__k">{k}</span><span className="fv-stat__v">{v}</span></div>
  )
  return (
    <div className="fv-stats">
      {row('Bbox SW', s.bbox?.sw_mgrs || '—')}
      {row('Bbox NE', s.bbox?.ne_mgrs || '—')}
      {row('Total dist', `${distKm} km`)}
      {row('Alt MSL', s.max_alt != null
        ? `${s.min_alt?.toFixed(0)} / ${s.avg_alt?.toFixed(0)} / ${s.max_alt.toFixed(0)} m`
        : '—')}
      {row('Max speed', s.max_speed != null ? `${s.max_speed.toFixed(1)} m/s · ${(s.max_speed * 3.6).toFixed(0)} km/h` : '—')}
      {row('Duration', fmtHMS(flight.duration_s))}
      {row('Start DTG', startDtg || 'N/A · no GPS time')}
      {row('End DTG', endDtg || 'N/A · no GPS time')}
      <p className="help fv-stats__note">Alt shown as min / avg / max MSL. AGL = MSL − field elevation ({s.field_elevation != null ? s.field_elevation.toFixed(0) + ' m' : 'n/a'}).</p>
    </div>
  )
}
