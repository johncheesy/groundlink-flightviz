// GPX 1.1 export for a single flight. Pure string building — no dependency.
// Track points carry lat/lon/alt(MSL)/utc; `utc` is null when the source log
// had no GPS time, in which case <time> is omitted (GPX allows trkpt without it).

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * Build a GPX 1.1 document for a flight.
 * @param {object} flight  normalized flight (loadData.js shape)
 * @param {string} droneId display id of the platform (e.g. "Drone 1")
 */
export function buildGPX(flight, droneId) {
  const s = flight.summary
  const name = `${droneId} · Flight ${String(flight.id).padStart(2, '0')}`
  const distKm = (s.total_dist_m / 1000).toFixed(2)
  const descParts = []
  if (flight.rc_protocol) descParts.push(`RC ${flight.rc_protocol}`)
  if (flight.rc_freq_ghz != null) descParts.push(`${flight.rc_freq_ghz} GHz`)
  if (s.max_alt != null) descParts.push(`max alt ${s.max_alt.toFixed(1)} m MSL`)
  descParts.push(`total dist ${distKm} km`)
  const desc = descParts.join(' · ')

  const trkpts = flight.track.map((p) => {
    const ele = p.alt != null ? `\n        <ele>${p.alt.toFixed(2)}</ele>` : ''
    const time = p.utc ? `\n        <time>${esc(p.utc)}</time>` : ''
    return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
      `${ele}${time}\n      </trkpt>`
  }).join('\n')

  const metaTime = s.start_utc ? `\n    <time>${esc(s.start_utc)}</time>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GroundLink FlightViz"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${esc(name)}</name>${metaTime}
    <desc>${esc(desc)}</desc>
  </metadata>
  <trk>
    <name>${esc(name)}</name>
    <desc>${esc(desc)}</desc>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

/** Trigger a browser download of the GPX for a flight. */
export function downloadGPX(flight, droneLabel, droneId) {
  const xml = buildGPX(flight, droneLabel)
  const safe = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  const fname = `${safe(droneId)}-${String(flight.id).padStart(2, '0')}.gpx`
  const blob = new Blob([xml], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fname
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
