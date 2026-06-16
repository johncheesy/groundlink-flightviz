# GROUNDLINK FlightViz

A local, **offline** drone-log analysis viewer. ArduPilot DataFlash (`.bin`) logs are
extracted to JSON by a Python script, then explored in a static React app
(map + telemetry + summary). No backend, no network calls except the OSM map tiles.

```
DRONE/
├── extract.py            # .bin  ->  data/<drone>.json
├── data/                 # generated JSON (drone1.json, drone2.json)
└── flightviz/            # Vite + React + Leaflet + Recharts viewer
    └── public/data/      # JSON copied here so the app can fetch it
```

---

## 1. Extract the logs

Run from the `DRONE/` directory (one `.bin` = one flight; output goes to `data/`):

```bash
python3 extract.py drone1 log_1.bin log_2.bin log_3.bin log_4.bin log_5.bin
python3 extract.py drone2 d2_log_1.bin d2_log_2.bin d2_log_3.bin
```

> Use `python3` (the interpreter with `pymavlink`, `mgrs`, `packaging` installed).
> After extracting, copy the JSON into the app:
> `cp data/drone1.json data/drone2.json flightviz/public/data/`

Per `.bin` the extractor pulls **GPS** (Lat/Lng/Alt/Status/Spd/GWk/GMS),
**ATT** (Roll/Pitch/Yaw), **MODE** (number + Copter name map), **BAT**
(Volt/Curr/CurrTot), **VIBE** (VibeX/Y/Z), and **RCIN/RSSI** when present.
GPS → MGRS (precision 5), GPS week+ms → UTC (LEAP = 18), GPS fixes filtered to
`Status >= 3`, and every series is decimated to ≤ 2000 points. Missing message
types are handled gracefully.

### ⚠ Note on *these* logs (no GPS message)

The supplied logs were recorded with GPS logging stripped — there is **no `GPS`
message**, so there is no GPS week/ms (no absolute UTC), no GPS status, and no
GPS-reported speed. The extractor falls back automatically:

| Field        | Source used in these logs                                  |
|--------------|-------------------------------------------------------------|
| Track        | `POS` (EKF position estimate), then `AHR2` for ground tests |
| Altitude     | AMSL metres from the position estimate                      |
| Ground speed | derived from successive positions (haversine ÷ Δt)         |
| UTC / DTG    | **unavailable** → timeline shown as `T+<seconds>` (boot)    |
| Fix quality  | reported as `EKF/POS` / `AHR2` so the source is explicit    |

If you feed it a log that *does* contain `GPS` messages, the full GPS/UTC/MGRS
path is used instead — the fallback only kicks in when GPS is absent.

---

## 2. Run the viewer

```bash
cd flightviz
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`).
Production build: `npm run build` then `npm run preview`.

---

## Using the app

- **Top bar** — select platform (Drone 1 / 2) and a flight (dropdown defaults to
  the main/longest flight; `◆ MAIN` marks it).
- **▲ LOAD DATA / drag-and-drop** — load extra flights at runtime without a
  rebuild. Drop (or pick) a `data/<drone>.json` produced by `extract.py` and it
  appears as a new platform tab (marked `▲`). Dropping a `.bin` instead shows the
  exact `extract.py` command to run first (pymavlink is Python-only, so `.bin`
  files can't be decoded in the browser). Uploaded JSON is validated/normalised
  so a partial or hand-edited file won't crash the viewer.
- **Map** (Leaflet/OSM) — teal track polyline, green **START** / red **END**
  markers, auto-fit to the flight. Hover the track for an MGRS + lat/lon + alt +
  time read-out. `GRID` toggles a metric graticule.
- **Telemetry** (Recharts) — attitude (roll/pitch/yaw), altitude, ground speed,
  battery (volt + current), vibration, and RC link. All charts share one X-axis
  and a synchronised hover cursor; yellow dashed **mode-change** reference lines
  mark every flight-mode transition (hovering a chart also highlights the map).
- **Summary** — duration, max alt/speed, total distance, modes flown, fix
  quality, and start DTG.

Theme: near-black operational dark, single teal accent, monospace for all
coordinates / MGRS / DTG.
