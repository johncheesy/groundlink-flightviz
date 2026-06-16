import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'

// On-map feature colours. MapLibre paint needs literal colour values, so these
// mirror the GroundLink tokens (--feat-track azure, --mapring white) rather
// than reading the CSS variables at runtime.
const TRACK_COLOR = '#46a6ff' // var(--feat-track)
const RING = '#ffffff' // var(--mapring)
const START_COLOR = '#34e6c2' // teal-green start
const END_COLOR = '#ff5b5b' // red end
const CURSOR_FILL = '#ffffff'

// Esri World Imagery is the default dark basemap; OpenTopoMap + OpenFreeMap
// Bright are the alternates (mirrors GroundLink's basemap flyout).
const BASEMAPS = [
  {
    id: 'imagery', label: 'Esri World Imagery', kind: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'topo', label: 'OpenTopoMap', kind: 'raster',
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    maxzoom: 17,
    attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors',
  },
  {
    id: 'bright', label: 'OpenFreeMap Bright', kind: 'style',
    url: 'https://tiles.openfreemap.org/styles/bright',
  },
]

function rasterStyle(bm) {
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: bm.tiles, tileSize: 256, maxzoom: bm.maxzoom, attribution: bm.attribution },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

function styleFor(id) {
  const bm = BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]
  return bm.kind === 'style' ? bm.url : rasterStyle(bm)
}

function nearest(track, lng, lat) {
  let best = null, bd = Infinity
  for (const p of track) {
    const d = (p.lat - lat) ** 2 + (p.lon - lng) ** 2
    if (d < bd) { bd = d; best = p }
  }
  return best
}

function atTime(track, t) {
  if (t == null || !track.length) return null
  let best = track[0], bd = Infinity
  for (const p of track) {
    const d = Math.abs(p.t - t)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

function popupHTML(p) {
  const time = p.utc ? p.utc : 'T+' + p.t.toFixed(1) + ' s'
  const alt = p.alt != null ? p.alt.toFixed(1) + ' m' : '—'
  return (
    `<div class="fv-popup">` +
    `<div class="fv-popup__mgrs">${p.mgrs || '— no MGRS —'}</div>` +
    `<div class="fv-popup__row"><span class="k">UTC</span><span class="v">${time}</span></div>` +
    `<div class="fv-popup__row"><span class="k">ALT</span><span class="v">${alt}</span></div>` +
    `</div>`
  )
}

function lineFeature(track) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: track.map((p) => [p.lon, p.lat]) },
    properties: {},
  }
}

function endFeatures(track) {
  if (!track.length) return { type: 'FeatureCollection', features: [] }
  const mk = (p, role, color) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { role, color },
  })
  return {
    type: 'FeatureCollection',
    features: [
      mk(track[0], 'start', START_COLOR),
      mk(track[track.length - 1], 'end', END_COLOR),
    ],
  }
}

export default function MapPanel({ flight, hoverT, setHoverT }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const trackRef = useRef(flight.track)
  const readyRef = useRef(false)
  const appliedBasemap = useRef('imagery') // basemap the current style already shows
  const [basemap, setBasemap] = useState('imagery')
  const [flyout, setFlyout] = useState(false)

  trackRef.current = flight.track

  // ---- add (or re-add after a basemap switch) the track layers ------------
  function addTrackLayers(map) {
    const track = trackRef.current
    if (!map.getSource('fv-track')) {
      map.addSource('fv-track', { type: 'geojson', data: lineFeature(track) })
    }
    if (!map.getSource('fv-ends')) {
      map.addSource('fv-ends', { type: 'geojson', data: endFeatures(track) })
    }
    if (!map.getSource('fv-cursor')) {
      map.addSource('fv-cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    }
    if (!map.getLayer('fv-track-line')) {
      map.addLayer({
        id: 'fv-track-line', type: 'line', source: 'fv-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': TRACK_COLOR, 'line-width': 2.5, 'line-opacity': 0.95 },
      })
    }
    if (!map.getLayer('fv-track-hit')) {
      map.addLayer({
        id: 'fv-track-hit', type: 'line', source: 'fv-track',
        paint: { 'line-color': TRACK_COLOR, 'line-width': 14, 'line-opacity': 0 },
      })
    }
    if (!map.getLayer('fv-ends-circle')) {
      map.addLayer({
        id: 'fv-ends-circle', type: 'circle', source: 'fv-ends',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': RING,
          'circle-stroke-width': 2,
        },
      })
    }
    if (!map.getLayer('fv-cursor-circle')) {
      map.addLayer({
        id: 'fv-cursor-circle', type: 'circle', source: 'fv-cursor',
        paint: {
          'circle-radius': 5,
          'circle-color': CURSOR_FILL,
          'circle-stroke-color': TRACK_COLOR,
          'circle-stroke-width': 2,
        },
      })
    }
  }

  function fit(map) {
    const track = trackRef.current
    if (!track.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of track) {
      if (p.lon < minX) minX = p.lon
      if (p.lon > maxX) maxX = p.lon
      if (p.lat < minY) minY = p.lat
      if (p.lat > maxY) maxY = p.lat
    }
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, maxZoom: 17, duration: 0 })
  }

  // ---- create the map once ------------------------------------------------
  useEffect(() => {
    const track = trackRef.current
    const center = track.length ? [track[0].lon, track[0].lat] : [0, 0]
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor('imagery'),
      center,
      zoom: track.length ? 14 : 1,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    popupRef.current = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 10, className: 'fv-map-popup',
    })

    map.on('load', () => {
      readyRef.current = true
      addTrackLayers(map)
      fit(map)
    })

    const onMove = (e) => {
      const p = nearest(trackRef.current, e.lngLat.lng, e.lngLat.lat)
      if (!p) return
      popupRef.current.setLngLat([p.lon, p.lat]).setHTML(popupHTML(p)).addTo(map)
      setHoverT(p.t)
      map.getCanvas().style.cursor = 'crosshair'
    }
    const onLeave = () => {
      popupRef.current.remove()
      setHoverT(null)
      map.getCanvas().style.cursor = ''
    }
    map.on('mousemove', 'fv-track-hit', onMove)
    map.on('mouseleave', 'fv-track-hit', onLeave)

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; readyRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- flight change: update geometry + refit -----------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const track = flight.track
    map.getSource('fv-track')?.setData(lineFeature(track))
    map.getSource('fv-ends')?.setData(endFeatures(track))
    map.getSource('fv-cursor')?.setData({ type: 'FeatureCollection', features: [] })
    popupRef.current?.remove()
    fit(map)
  }, [flight])

  // ---- basemap switch (skip the no-op re-apply on mount) ------------------
  // setStyle wipes all sources/layers; re-add the track once the new style has
  // finished loading. 'idle' is the reliable "style + tiles ready" signal.
  useEffect(() => {
    const map = mapRef.current
    if (!map || basemap === appliedBasemap.current) return
    appliedBasemap.current = basemap
    map.setStyle(styleFor(basemap))
    map.once('idle', () => { if (readyRef.current) addTrackLayers(map) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap])

  // ---- hover cursor synced from charts / map ------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('fv-cursor')
    if (!src) return
    const p = atTime(flight.track, hoverT)
    src.setData(p
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} }] }
      : { type: 'FeatureCollection', features: [] })
  }, [hoverT, flight])

  const current = BASEMAPS.find((b) => b.id === basemap) || BASEMAPS[0]

  return (
    <>
      <div ref={containerRef} className="fv-map" />

      <div className="map-rail" role="toolbar" aria-orientation="vertical" aria-label="Map tools">
        <button className="map-rail__btn" type="button" aria-label="Zoom in"
          onClick={() => mapRef.current?.zoomIn()}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className="map-rail__btn" type="button" aria-label="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
        </button>
        <span className="map-rail__sep" aria-hidden="true" />
        <button className={'map-rail__btn' + (flyout ? ' is-active' : '')} type="button"
          aria-label="Basemap" aria-haspopup="true" aria-expanded={flyout}
          title="Basemap & variants" onClick={() => setFlyout((v) => !v)}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
          </svg>
        </button>
      </div>

      {flyout && (
        <div className="map-flyout" role="group" aria-label="Basemap">
          <div className="map-flyout__title">Basemap</div>
          <div className="basemap-variant-menu">
            {BASEMAPS.map((b) => (
              <button key={b.id} type="button"
                className={'basemap-variant-menu__item' + (b.id === basemap ? ' is-active' : '')}
                onClick={() => { setBasemap(b.id); setFlyout(false) }}>
                <span className="basemap-variant-menu__name">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
