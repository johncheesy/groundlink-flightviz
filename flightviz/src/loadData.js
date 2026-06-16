// Validate + normalize extract.py output so the viewer never crashes on a
// hand-edited or partial JSON. Accepts either a bare array of flights or an
// object wrapping one (e.g. { flights: [...] }).

const num = (v, d = null) => (typeof v === 'number' && isFinite(v) ? v : d)

function normalizeFlight(raw, idx) {
  const f = raw && typeof raw === 'object' ? raw : {}
  const track = Array.isArray(f.track)
    ? f.track.filter((p) => p && num(p.lat) != null && num(p.lon) != null).map((p) => ({
        t: num(p.t, 0),
        lat: num(p.lat),
        lon: num(p.lon),
        alt: num(p.alt),
        mgrs: p.mgrs ?? null,
        utc: p.utc ?? null,
        spd: num(p.spd),
      }))
    : []

  const tel = f.telemetry && typeof f.telemetry === 'object' ? f.telemetry : {}
  const telemetry = {}
  for (const [k, v] of Object.entries(tel)) {
    if (Array.isArray(v)) telemetry[k] = v
  }

  const modes = Array.isArray(f.modes)
    ? f.modes.filter((m) => m && typeof m === 'object').map((m) => ({
        t: num(m.t, 0),
        mode_num: m.mode_num ?? null,
        mode_name: m.mode_name ?? (m.mode_num != null ? `MODE_${m.mode_num}` : '—'),
      }))
    : []

  const s = f.summary && typeof f.summary === 'object' ? f.summary : {}
  const summary = {
    max_alt: num(s.max_alt),
    max_speed: num(s.max_speed),
    total_dist_m: num(s.total_dist_m, 0),
    modes_flown: Array.isArray(s.modes_flown) ? s.modes_flown : [],
    fix_quality: s.fix_quality || 'UNKNOWN',
    start_utc: s.start_utc ?? null,
    track_points: num(s.track_points, track.length),
    has_gps: s.has_gps === true,
  }

  return {
    id: f.id ?? idx + 1,
    filename: f.filename || `flight_${idx + 1}`,
    duration_s: num(f.duration_s, track.length ? track[track.length - 1].t : 0),
    track,
    telemetry,
    modes,
    summary,
  }
}

export function normalizeFlights(data) {
  let arr = data
  if (!Array.isArray(arr)) {
    if (arr && Array.isArray(arr.flights)) arr = arr.flights
    else if (arr && typeof arr === 'object' && (arr.track || arr.telemetry)) arr = [arr]
    else throw new Error('expected an array of flights (extract.py output)')
  }
  const out = arr.map(normalizeFlight)
  if (!out.length) throw new Error('no flights found')
  return out
}
