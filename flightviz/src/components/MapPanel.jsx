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
const MAP_BG = '#0b1018' // --mapbg, dark in both themes

// AWS Terrarium DEM — free, token-free; encoding 'terrarium' (mirrors GroundLink).
const DEM_SOURCE = 'fv-dem'
const DEM_SPEC = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  attribution: 'Elevation: Terrain Tiles (AWS)',
}
const TERRAIN_EXAGGERATION = 1.5

// OpenFreeMap vector tiles — free, keyless OSM (OpenMapTiles schema). The
// `building` source-layer carries render_height / render_min_height, exactly
// what fill-extrusion needs. Mirrors GroundLink's basemaps.js (OPENFREEMAP +
// BUILDINGS_LAYER): declared up-front in the raster styles but hidden; the 3D
// toggle makes it visible alongside terrain. minzoom 14 keeps extrusion where
// it reads and the map performant.
const OFM_SOURCE = 'openfreemap'
const OFM_URL = 'https://tiles.openfreemap.org/planet'
const OFM_ATTRIB = 'Buildings: © OpenFreeMap · © OpenStreetMap contributors'
const BUILDINGS_LAYER = 'buildings-3d'
const BUILDING_COLOR = '#3b4250' // muted neutral surface on the dark map (not a bright fill)

// The exact basemap set GroundLink ships (src/map/basemaps.js): Esri World
// Imagery (default dark satellite), PDOK NL ortho, EOX Sentinel-2, OpenTopoMap,
// OpenFreeMap Bright. PDOK/EOX use RESTful WMTS XYZ endpoints (token-free).
const BASEMAPS = [
  {
    id: 'imagery', label: 'Esri World Imagery', kind: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'pdok', label: 'NL Luchtfoto (PDOK)', kind: 'raster',
    tiles: ['https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg'],
    maxzoom: 20,
    attribution: 'Imagery © PDOK / Beeldmateriaal Nederland (CC BY 4.0)',
  },
  {
    id: 'eox', label: 'Sentinel-2 cloudless', kind: 'raster',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'],
    maxzoom: 15,
    attribution: 'Imagery © EOX / ESA Sentinel-2 cloudless 2020 (CC BY-NC-SA)',
  },
  {
    id: 'topo', label: 'OpenTopoMap', kind: 'raster',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'],
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
      // OpenFreeMap vector buildings, declared up-front but hidden (the 3D
      // toggle reveals them). Only the OpenFreeMap *style* basemap embeds its
      // own buildings — for every raster basemap we supply them here.
      [OFM_SOURCE]: { type: 'vector', url: OFM_URL, attribution: OFM_ATTRIB },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': MAP_BG } },
      { id: 'base', type: 'raster', source: 'base' },
      {
        id: BUILDINGS_LAYER,
        type: 'fill-extrusion',
        source: OFM_SOURCE,
        'source-layer': 'building',
        minzoom: 14,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': BUILDING_COLOR,
          'fill-extrusion-height': ['get', 'render_height'],
          'fill-extrusion-base': ['get', 'render_min_height'],
          'fill-extrusion-opacity': 0.85,
        },
      },
    ],
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

// Build the floating 3D track: one short ribbon slab per segment, extruded at
// the segment's altitude AGL (alt − field elevation). fill-extrusion base/height
// are metres above terrain, so AGL places the ribbon ≈ at the true flight
// altitude above the terrain surface. THICK gives the ribbon visible body.
const RIBBON_HALF_W = 2.5 // metres each side
const RIBBON_THICK = 6 // metres vertical body
function track3DFeatures(track, fieldElev) {
  const features = []
  const fe = fieldElev != null ? fieldElev : 0
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i]
    if (a.alt == null || b.alt == null) continue
    const lat = (a.lat + b.lat) / 2
    const mPerLat = 111320
    const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180) || 1e-6
    const vx = (b.lon - a.lon) * mPerLon
    const vy = (b.lat - a.lat) * mPerLat
    const L = Math.hypot(vx, vy)
    // perpendicular unit vector (metres) → degrees offset
    const px = L ? -vy / L : 0
    const py = L ? vx / L : 1
    const offLon = (px * RIBBON_HALF_W) / mPerLon
    const offLat = (py * RIBBON_HALF_W) / mPerLat
    const base = Math.max(0, (a.alt + b.alt) / 2 - fe)
    features.push({
      type: 'Feature',
      properties: { base, top: base + RIBBON_THICK },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [a.lon + offLon, a.lat + offLat],
          [b.lon + offLon, b.lat + offLat],
          [b.lon - offLon, b.lat - offLat],
          [a.lon - offLon, a.lat - offLat],
          [a.lon + offLon, a.lat + offLat],
        ]],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

export default function MapPanel({ flight, hoverT, setHoverT }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const trackRef = useRef(flight.track)
  const fieldElevRef = useRef(flight.summary.field_elevation)
  const readyRef = useRef(false)
  const threeDRef = useRef(false) // read inside style.load handler
  const buildingsRef = useRef(false) // read inside style.load handler
  const pitchRef = useRef(0)
  const bearingRef = useRef(0)
  const appliedBasemap = useRef('imagery')
  const [basemap, setBasemap] = useState('imagery')
  const [flyout, setFlyout] = useState(null) // 'basemap' | 'view' | null
  const [threeD, setThreeD] = useState(false)
  const [buildings, setBuildings] = useState(false)
  const [pitch, setPitch] = useState(0)
  const [bearing, setBearing] = useState(0)

  trackRef.current = flight.track
  fieldElevRef.current = flight.summary.field_elevation

  // ---- (re)create the track sources + layers on the active style -----------
  function addTrackLayers(map) {
    const track = trackRef.current
    if (!map.getSource(DEM_SOURCE)) map.addSource(DEM_SOURCE, DEM_SPEC)
    if (!map.getSource('fv-track')) map.addSource('fv-track', { type: 'geojson', data: lineFeature(track) })
    if (!map.getSource('fv-ends')) map.addSource('fv-ends', { type: 'geojson', data: endFeatures(track) })
    if (!map.getSource('fv-cursor')) map.addSource('fv-cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    if (!map.getSource('fv-track-3d')) map.addSource('fv-track-3d', { type: 'geojson', data: track3DFeatures(track, fieldElevRef.current) })

    if (!map.getLayer('fv-track-3d-fill')) {
      map.addLayer({
        id: 'fv-track-3d-fill', type: 'fill-extrusion', source: 'fv-track-3d',
        layout: { visibility: threeDRef.current ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': TRACK_COLOR,
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-opacity': 0.9,
        },
      })
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
          'circle-radius': 6, 'circle-color': ['get', 'color'],
          'circle-stroke-color': RING, 'circle-stroke-width': 2,
        },
      })
    }
    if (!map.getLayer('fv-cursor-circle')) {
      map.addLayer({
        id: 'fv-cursor-circle', type: 'circle', source: 'fv-cursor',
        paint: {
          'circle-radius': 5, 'circle-color': CURSOR_FILL,
          'circle-stroke-color': TRACK_COLOR, 'circle-stroke-width': 2,
        },
      })
    }
  }

  // Dark sky matching the GroundLink dark canvas. Feature-detected (setSky is
  // available in maplibre-gl v4+); harmless to skip if not.
  function applySky(map, on) {
    if (typeof map.setSky !== 'function') return
    try {
      map.setSky(on ? {
        'sky-color': '#0b1018', 'horizon-color': '#101725', 'fog-color': '#0b1018',
        'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.8,
      } : {})
    } catch { /* style may not support sky yet */ }
  }

  // Apply / clear 3D terrain + sky. Pitch is driven separately so the slider
  // and the toggle stay consistent.
  function applyTerrain(map, on) {
    try {
      if (on) {
        if (!map.getSource(DEM_SOURCE)) map.addSource(DEM_SOURCE, DEM_SPEC)
        map.setTerrain({ source: DEM_SOURCE, exaggeration: TERRAIN_EXAGGERATION })
      } else {
        map.setTerrain(null)
      }
    } catch { /* DEM not ready yet — style.load re-applies */ }
    applySky(map, on)
  }

  // Show/hide the OpenFreeMap building extrusion. Driven by its own toggle,
  // independent of 3D terrain. No-op when the layer is absent — the OpenFreeMap
  // *style* basemap ships its own buildings, so we never add ours on top of it
  // (mirrors GroundLink's setBuildings guard).
  function applyBuildings(map, on) {
    if (!map.getLayer(BUILDINGS_LAYER)) return
    map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', on ? 'visible' : 'none')
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
      pitch: 0,
      maxPitch: 85,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    popupRef.current = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, offset: 10, className: 'fv-map-popup',
    })

    // Re-apply overlays after every style load (initial + each basemap switch).
    // setStyle clears terrain (a style property) but keeps the camera; restore
    // both so 3D survives a basemap switch.
    map.on('style.load', () => {
      addTrackLayers(map)
      applyBuildings(map, buildingsRef.current)
      if (threeDRef.current) {
        applyTerrain(map, true)
        map.jumpTo({ pitch: pitchRef.current || 45, bearing: bearingRef.current })
      }
    })

    map.on('load', () => {
      readyRef.current = true
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
    map.getSource('fv-track-3d')?.setData(track3DFeatures(track, flight.summary.field_elevation))
    map.getSource('fv-cursor')?.setData({ type: 'FeatureCollection', features: [] })
    popupRef.current?.remove()
    fit(map)
  }, [flight])

  // ---- basemap switch -----------------------------------------------------
  // setStyle wipes sources/layers; the persistent 'style.load' handler re-adds
  // the track and re-applies terrain once the new style is ready.
  useEffect(() => {
    const map = mapRef.current
    if (!map || basemap === appliedBasemap.current) return
    appliedBasemap.current = basemap
    // diff:false forces a clean reload (reliable style.load) instead of the
    // raster↔vector diff path that throws benign tile-abort errors.
    map.setStyle(styleFor(basemap), { diff: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap])

  // ---- 3D terrain toggle --------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    threeDRef.current = threeD
    if (map.getLayer('fv-track-3d-fill')) {
      map.setLayoutProperty('fv-track-3d-fill', 'visibility', threeD ? 'visible' : 'none')
    }
    applyTerrain(map, threeD)
    // Camera is driven one-way (state → map) by the pitch/bearing effects below;
    // just set the target state here. Enabling pitches to 45°, disabling resets.
    setPitch(threeD ? 45 : 0)
    if (!threeD) setBearing(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threeD])

  // ---- buildings toggle (independent of 3D terrain) -----------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    buildingsRef.current = buildings
    applyBuildings(map, buildings)
  }, [buildings])

  // ---- pitch / bearing sliders (single source of truth: React → map) ------
  useEffect(() => {
    pitchRef.current = pitch
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (Math.round(map.getPitch()) !== pitch) map.easeTo({ pitch, duration: 400 })
  }, [pitch])
  useEffect(() => {
    bearingRef.current = bearing
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (Math.round(map.getBearing()) !== bearing) map.easeTo({ bearing, duration: 400 })
  }, [bearing])

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

  const toggleFlyout = (key) => setFlyout((cur) => (cur === key ? null : key))

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
        <button className={'map-rail__btn' + (flyout === 'basemap' ? ' is-active' : '')} type="button"
          aria-label="Basemap" aria-haspopup="true" aria-expanded={flyout === 'basemap'}
          title="Basemap & variants" onClick={() => toggleFlyout('basemap')}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
          </svg>
        </button>
        <button className={'map-rail__btn' + (flyout === 'view' ? ' is-active' : '') + (threeD ? ' is-on' : '')} type="button"
          aria-label="View — 3D terrain, tilt" aria-haspopup="true" aria-expanded={flyout === 'view'}
          title="View — 3D terrain, tilt, bearing" onClick={() => toggleFlyout('view')}>
          <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18l5.5-8 4 5.5L16 11l5 7H3z" /><path d="M16 5.5h.01" />
          </svg>
        </button>
      </div>

      {flyout === 'basemap' && (
        <div className="map-flyout" role="group" aria-label="Basemap">
          <div className="map-flyout__title">Basemap</div>
          <div className="basemap-variant-menu">
            {BASEMAPS.map((b) => (
              <button key={b.id} type="button"
                className={'basemap-variant-menu__item' + (b.id === basemap ? ' is-active' : '')}
                onClick={() => { setBasemap(b.id); setFlyout(null) }}>
                <span className="basemap-variant-menu__name">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {flyout === 'view' && (
        <div className="map-flyout" role="group" aria-label="View">
          <div className="map-flyout__title">View</div>
          <div className="map-flyout__row">
            <button className={'map-flyout__toggle' + (threeD ? ' is-active' : '')} type="button"
              aria-pressed={threeD} title="3D terrain relief (tilt + pitch)"
              onClick={() => setThreeD((v) => !v)}>3D terrain</button>
          </div>
          <div className="map-flyout__row">
            <button className={'map-flyout__toggle' + (buildings ? ' is-active' : '')} type="button"
              aria-pressed={buildings} title="Extruded 3D buildings (from zoom 14)"
              onClick={() => setBuildings((v) => !v)}>
              <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18" /><path d="M5 21V7l7-4v18" /><path d="M19 21V11l-7-4" />
                <path d="M9 9h.01M9 13h.01M9 17h.01" />
              </svg>
              Buildings
            </button>
          </div>
          {threeD && (
            <div className="view-sliders" role="group" aria-label="3D view controls">
              <div className="view-slider">
                <label htmlFor="fvTilt">Tilt</label>
                <input className="range" id="fvTilt" type="range" min="0" max="85" value={pitch}
                  onChange={(e) => setPitch(Number(e.target.value))} />
                <span className="view-slider__val">{pitch}°</span>
              </div>
              <div className="view-slider">
                <label htmlFor="fvBearing">Bearing</label>
                <input className="range" id="fvBearing" type="range" min="0" max="360" value={bearing}
                  onChange={(e) => setBearing(Number(e.target.value))} />
                <span className="view-slider__val">{bearing}° </span>
              </div>
            </div>
          )}
          <p className="map-flyout__hint">3D adds terrain relief and lifts the track to its flight altitude above the terrain (AGL). Buildings adds extruded 3D buildings (from zoom 14); both can be toggled independently.</p>
        </div>
      )}
    </>
  )
}
