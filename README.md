# GROUNDLINK FlightViz

A local, **offline** drone-log analysis viewer for ArduPilot DataFlash (`.bin`)
logs. A Python script (`extract.py`) decodes the logs to JSON; a static React app
(`flightviz/`) renders the track on a map alongside synchronised telemetry and a
flight summary. No backend.

**Live demo:** https://johncheesy.github.io/groundlink-flightviz/

```
.
├── extract.py            # .bin  ->  data/<drone>.json   (pymavlink + mgrs)
├── data/                 # generated JSON
├── *.bin                 # source DataFlash logs (Drone 1: log_*.bin, Drone 2: d2_log_*.bin)
└── flightviz/            # Vite + React + Leaflet + Recharts viewer
    ├── src/
    └── public/data/      # JSON served by the app
```

## Quick start

```bash
# 1. extract logs (use python3 — the interpreter with pymavlink/mgrs installed)
python3 extract.py drone1 log_1.bin log_2.bin log_3.bin log_4.bin log_5.bin
python3 extract.py drone2 d2_log_1.bin d2_log_2.bin d2_log_3.bin
cp data/drone1.json data/drone2.json flightviz/public/data/

# 2. run the viewer
cd flightviz && npm install && npm run dev
```

## Loading new flights without rebuilding

The app has a **▲ LOAD DATA** button (and a window-wide drag-and-drop zone):

- Drop a `data/<drone>.json` file produced by `extract.py` — it loads instantly as
  a new platform tab, no rebuild required.
- Drop a `.bin` file — the app shows the exact `extract.py` command to run first
  (pymavlink is Python-only, so `.bin` decoding can't happen in the browser).

See [`flightviz/README.md`](flightviz/README.md) for full details, including the
note on these particular logs (recorded without GPS messages → EKF/POS fallback,
boot-relative `T+` timeline instead of UTC/DTG).

## Deployment

Pushes to `main` build the app and publish `flightviz/dist` to GitHub Pages via
`.github/workflows/deploy.yml`.
