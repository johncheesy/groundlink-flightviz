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
  const bbox = s.bbox && typeof s.bbox === 'object' ? {
    sw: Array.isArray(s.bbox.sw) ? s.bbox.sw : null,
    ne: Array.isArray(s.bbox.ne) ? s.bbox.ne : null,
    sw_mgrs: s.bbox.sw_mgrs ?? null,
    ne_mgrs: s.bbox.ne_mgrs ?? null,
  } : null
  const summary = {
    max_alt: num(s.max_alt),
    min_alt: num(s.min_alt),
    avg_alt: num(s.avg_alt),
    field_elevation: num(s.field_elevation),
    max_speed: num(s.max_speed),
    total_dist_m: num(s.total_dist_m, 0),
    bbox,
    modes_flown: Array.isArray(s.modes_flown) ? s.modes_flown : [],
    fix_quality: s.fix_quality || 'UNKNOWN',
    start_utc: s.start_utc ?? null,
    end_utc: s.end_utc ?? null,
    track_points: num(s.track_points, track.length),
    has_gps: s.has_gps === true,
    rssi_min: num(s.rssi_min),
    rssi_avg: num(s.rssi_avg),
    rssi_max: num(s.rssi_max),
  }

  // RF link: channels (C1..C8 µs), RSSI series, protocol + frequency.
  const rcin = Array.isArray(f.rcin)
    ? f.rcin.filter((p) => p && typeof p === 'object').map((p) => ({ ...p, t: num(p.t, 0) }))
    : []
  const rssi = Array.isArray(f.rssi)
    ? f.rssi.filter((p) => p && typeof p === 'object' && num(p.rssi) != null)
        .map((p) => ({ t: num(p.t, 0), rssi: num(p.rssi), lq: num(p.lq) }))
    : []

  // Battery time series [{t, volt, curr, mah_used, temp?}] — dedicated panel.
  const battery = Array.isArray(f.battery)
    ? f.battery.filter((p) => p && typeof p === 'object').map((p) => ({
        t: num(p.t, 0),
        volt: num(p.volt),
        curr: num(p.curr),
        mah_used: num(p.mah_used),
        temp: num(p.temp),
      }))
    : []
  const bs = f.battery_summary && typeof f.battery_summary === 'object' ? f.battery_summary : {}
  const battery_summary = {
    start_volt: num(bs.start_volt),
    end_volt: num(bs.end_volt),
    total_mah_used: num(bs.total_mah_used),
    max_curr: num(bs.max_curr),
    max_temp: num(bs.max_temp),
  }

  return {
    id: f.id ?? idx + 1,
    filename: f.filename || `flight_${idx + 1}`,
    duration_s: num(f.duration_s, track.length ? track[track.length - 1].t : 0),
    track,
    telemetry,
    modes,
    summary,
    battery,
    battery_summary,
    rcin,
    rssi,
    rc_protocol: typeof f.rc_protocol === 'string' ? f.rc_protocol : null,
    rc_freq_ghz: num(f.rc_freq_ghz),
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
