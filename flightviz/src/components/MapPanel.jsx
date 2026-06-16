import { useMemo, useRef, useState, useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, useMapEvents, LayerGroup, Tooltip } from 'react-leaflet'

// nearest track point to a given lat/lng (planar approx — fine at flight scale)
function nearest(track, lat, lng) {
  let best = null, bd = Infinity
  for (const p of track) {
    const d = (p.lat - lat) ** 2 + (p.lon - lng) ** 2
    if (d < bd) { bd = d; best = p }
  }
  return best
}

// point at (or nearest to) a given time t
function atTime(track, t) {
  if (t == null || !track.length) return null
  let best = track[0], bd = Infinity
  for (const p of track) {
    const d = Math.abs(p.t - t)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

function FitBounds({ track }) {
  const map = useMap()
  useEffect(() => {
    if (!track.length) return
    const lls = track.map((p) => [p.lat, p.lon])
    const fit = () => {
      map.invalidateSize(false)
      map.fitBounds(lls, { padding: [28, 28] })
    }
    fit()
    const t = setTimeout(fit, 250) // re-fit once the flex layout has settled
    // keep the map correctly sized if the window/panel resizes
    const ro = new ResizeObserver(() => map.invalidateSize(false))
    ro.observe(map.getContainer())
    return () => { clearTimeout(t); ro.disconnect() }
  }, [track, map])
  return null
}

function HoverTracker({ track, setHoverT, setReadout }) {
  useMapEvents({
    mousemove(e) {
      const p = nearest(track, e.latlng.lat, e.latlng.lng)
      if (p) { setReadout(p); setHoverT(p.t) }
    },
    mouseout() { setReadout(null); setHoverT(null) },
  })
  return null
}

// Metric graticule (~500 m), aligned to flight area. Full MGRS string per point
// is shown in the hover readout (computed offline at MGRSPrecision=5).
function Graticule({ track }) {
  const map = useMap()
  const [lines, setLines] = useState([])

  useEffect(() => {
    function build() {
      const b = map.getBounds()
      const STEP_M = 500
      const midLat = (b.getNorth() + b.getSouth()) / 2
      const dLat = STEP_M / 111320
      const dLon = STEP_M / (111320 * Math.cos((midLat * Math.PI) / 180))
      const out = []
      const s = Math.floor(b.getSouth() / dLat) * dLat
      const w = Math.floor(b.getWest() / dLon) * dLon
      for (let lat = s; lat <= b.getNorth(); lat += dLat) {
        out.push({ pts: [[lat, b.getWest()], [lat, b.getEast()]], horiz: true, v: lat })
      }
      for (let lon = w; lon <= b.getEast(); lon += dLon) {
        out.push({ pts: [[b.getSouth(), lon], [b.getNorth(), lon]], horiz: false, v: lon })
      }
      setLines(out)
    }
    build()
    map.on('moveend zoomend', build)
    return () => map.off('moveend zoomend', build)
  }, [map, track])

  return (
    <LayerGroup>
      {lines.map((l, i) => (
        <Polyline key={i} positions={l.pts}
          pathOptions={{ color: '#1fd6c4', weight: 0.5, opacity: 0.28, interactive: false }} />
      ))}
    </LayerGroup>
  )
}

export default function MapPanel({ flight, hoverT, setHoverT, grid, setGrid }) {
  const track = flight.track
  const [readout, setReadout] = useState(null)

  const center = useMemo(() => {
    if (!track.length) return [0, 0]
    const m = track[Math.floor(track.length / 2)]
    return [m.lat, m.lon]
  }, [track])

  const path = useMemo(() => track.map((p) => [p.lat, p.lon]), [track])
  const start = track[0]
  const end = track[track.length - 1]
  const marker = atTime(track, hoverT)
  const shown = readout || marker

  return (
    <div className="panel map-panel">
      <div className="panel-head">
        <span className="panel-title">TACTICAL MAP · OSM</span>
        <button className={'toggle-btn' + (grid ? ' on' : '')}
          onClick={() => setGrid(!grid)}>GRID {grid ? 'ON' : 'OFF'}</button>
      </div>
      <div className="map-wrap">
        <MapContainer center={center} zoom={15} zoomControl={true} preferCanvas={true}
          attributionControl={true} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap'
            maxZoom={19} />
          <FitBounds track={track} />
          {grid && <Graticule track={track} />}
          {path.length > 1 && (
            <Polyline positions={path}
              pathOptions={{ color: '#1fd6c4', weight: 2, opacity: 0.9 }} />
          )}
          {start && (
            <CircleMarker center={[start.lat, start.lon]} radius={6}
              pathOptions={{ color: '#2bd66a', fillColor: '#2bd66a', fillOpacity: 0.9, weight: 2 }}>
              <Tooltip direction="top">START</Tooltip>
            </CircleMarker>
          )}
          {end && (
            <CircleMarker center={[end.lat, end.lon]} radius={6}
              pathOptions={{ color: '#d65a4a', fillColor: '#d65a4a', fillOpacity: 0.9, weight: 2 }}>
              <Tooltip direction="top">END</Tooltip>
            </CircleMarker>
          )}
          {marker && (
            <CircleMarker center={[marker.lat, marker.lon]} radius={5}
              pathOptions={{ color: '#ffffff', fillColor: '#1fd6c4', fillOpacity: 1, weight: 2 }} />
          )}
          <HoverTracker track={track} setHoverT={setHoverT} setReadout={setReadout} />
        </MapContainer>

        <div className="map-readout">
          {shown ? (
            <>
              <div><span className="k">MGRS </span><span className="mgrs">{shown.mgrs || '—'}</span></div>
              <div><span className="k">LAT  </span><span className="v">{shown.lat.toFixed(7)}</span></div>
              <div><span className="k">LON  </span><span className="v">{shown.lon.toFixed(7)}</span></div>
              <div><span className="k">ALT  </span><span className="v">{shown.alt != null ? shown.alt.toFixed(1) + ' m' : '—'}</span></div>
              <div><span className="k">TIME </span><span className="v">{shown.utc ? shown.utc : 'T+' + shown.t.toFixed(1) + 's'}</span></div>
            </>
          ) : (
            <div className="k">HOVER TRACK FOR FIX DATA</div>
          )}
        </div>
      </div>
    </div>
  )
}
