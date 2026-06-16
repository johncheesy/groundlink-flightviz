// Coordinate / time formatting shared by the panels and the GPX export.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Decimal degrees → DMS string, e.g. 52°22'03.4"N. `axis` is 'lat' | 'lon'. */
export function toDMS(value, axis) {
  if (value == null || !isFinite(value)) return '—'
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W')
  const abs = Math.abs(value)
  let d = Math.floor(abs)
  let m = Math.floor((abs - d) * 60)
  let s = ((abs - d) * 60 - m) * 60
  // carry rounding so we never print 60" / 60'
  if (s >= 59.95) { s = 0; m += 1 }
  if (m >= 60) { m = 0; d += 1 }
  const deg = axis === 'lat' ? String(d).padStart(2, '0') : String(d).padStart(3, '0')
  return `${deg}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`
}

/** Decimal degrees pair → "52.3676, 4.9041" (4 dp). */
export function fmtLatLon(lat, lon, dp = 4) {
  if (lat == null || lon == null) return '—'
  return `${lat.toFixed(dp)}, ${lon.toFixed(dp)}`
}

/**
 * ISO-8601 UTC string → military DTG "DDHHMMZMonYYYY" (e.g. 161430ZJun2026).
 * Returns null when no UTC is available (logs with GPS time stripped).
 */
export function fmtDTG(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z` +
    `${MONTHS[d.getUTCMonth()]}${d.getUTCFullYear()}`
}

/** Seconds → HH:MM:SS. */
export function fmtHMS(s) {
  if (s == null || !isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(sec)}`
}

/** m/s → "x.x m/s · y.y km/h". */
export function fmtSpeed(ms) {
  if (ms == null || !isFinite(ms)) return '—'
  return `${ms.toFixed(1)} m/s · ${(ms * 3.6).toFixed(1)} km/h`
}
