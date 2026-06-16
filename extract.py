#!/usr/bin/env python3
"""
Groundlink FlightViz — DataFlash (.bin) log extractor.

Usage:
    python3 extract.py <drone_id> <log1.bin> [log2.bin ...]

Example:
    python3 extract.py drone1 log_1.bin log_2.bin log_3.bin log_4.bin log_5.bin
    python3 extract.py drone2 d2_log_1.bin d2_log_2.bin d2_log_3.bin

Each .bin becomes one "flight". Output is written to data/<drone_id>.json as a
list of flights. The viewer (flightviz/) consumes that JSON directly — no backend.

Spec target fields: GPS(Lat/Lng/Alt/Status/Spd/GWk/GMS), ATT(Roll/Pitch/Yaw),
MODE(num + Copter name), BAT(Volt/Curr/CurrTot), VIBE(VibeX/Y/Z), RCIN/RSSI.
GPS -> MGRS (precision 5), GPS week/ms -> UTC (LEAP=18), filter GPS Status>=3,
decimate each series to <=2000 points.

ROBUSTNESS NOTE: real logs vary. If a log has no GPS message (these particular
logs were recorded with GPS logging stripped), the extractor falls back to the
EKF position estimate (POS, then AHR2) for the track. In that case there is no
GPS week/ms in the log, so absolute UTC cannot be recovered — UTC is reported as
null and the timeline is boot-relative seconds (t). Ground speed is then derived
from successive positions. fix_quality records which source was used.
"""

import sys
import os
import json
import math
import datetime

try:
    from pymavlink import mavutil
except ImportError:
    sys.exit("pymavlink is required: pip install pymavlink")

try:
    import mgrs
    _MGRS = mgrs.MGRS()
except ImportError:
    _MGRS = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LEAP = 18                       # GPS-UTC leap seconds
MGRS_PRECISION = 5             # 1 m precision
MAX_POINTS = 2000             # decimation cap per series
GPS_EPOCH = datetime.datetime(1980, 1, 6, tzinfo=datetime.timezone.utc)

# RC protocol (from the "RC Protocol: <name>" MSG line) -> link frequency in GHz.
# Most modern RC links are 2.4 GHz; the long-range 900 MHz ELRS variant is 0.9.
RC_FREQ_GHZ = {
    "GHST": 2.4, "CRSF": 2.4, "ELRS": 2.4, "FRSKY": 2.4,
    "DSM": 2.4, "DSMX": 2.4, "FPORT": 2.4, "SBUS": 2.4, "IBUS": 2.4,
    "900ELRS": 0.9,
}

# ArduPilot Copter flight-mode number -> name
COPTER_MODES = {
    0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO", 4: "GUIDED",
    5: "LOITER", 6: "RTL", 7: "CIRCLE", 9: "LAND", 11: "DRIFT",
    13: "SPORT", 14: "FLIP", 15: "AUTOTUNE", 16: "POSHOLD", 17: "BRAKE",
    18: "THROW", 19: "AVOID_ADSB", 20: "GUIDED_NOGPS", 21: "SMART_RTL",
    22: "FLOWHOLD", 23: "FOLLOW", 24: "ZIGZAG", 25: "SYSTEMID",
    26: "AUTOROTATE", 27: "AUTO_RTL",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def to_degrees(v):
    """DataFlash lat/lng may be raw 1e7 ints or already-scaled degrees."""
    if v is None:
        return None
    return v / 1e7 if abs(v) > 1000 else v


def to_mgrs(lat, lon):
    if _MGRS is None or lat is None or lon is None:
        return None
    try:
        return _MGRS.toMGRS(lat, lon, MGRSPrecision=MGRS_PRECISION)
    except Exception:
        return None


def gps_to_utc(gwk, gms):
    """GPS week + ms-of-week -> ISO-8601 UTC string (accounts for leap seconds)."""
    if gwk is None or gms is None:
        return None
    try:
        t = GPS_EPOCH + datetime.timedelta(weeks=gwk, milliseconds=gms) \
            - datetime.timedelta(seconds=LEAP)
        return t.isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def decimate(series):
    """Reduce a list to <=MAX_POINTS, preserving first/last via even stride."""
    n = len(series)
    if n <= MAX_POINTS:
        return series
    stride = math.ceil(n / MAX_POINTS)
    out = series[::stride]
    if out and out[-1] is not series[-1]:
        out.append(series[-1])
    return out


def gv(d, *keys):
    """First present, non-None value among keys."""
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


# ---------------------------------------------------------------------------
# Per-file extraction
# ---------------------------------------------------------------------------
def extract_flight(path, flight_id):
    mlog = mavutil.mavlink_connection(path)

    raw = {t: [] for t in ("GPS", "POS", "AHR2", "ATT", "MODE",
                            "BAT", "VIBE", "RCIN", "RSSI", "MSG")}
    t0 = None  # first TimeUS (boot-relative origin)

    while True:
        try:
            msg = mlog.recv_match(blocking=False)
        except Exception:
            continue
        if msg is None:
            break
        mtype = msg.get_type()
        if mtype not in raw:
            continue
        d = msg.to_dict()
        tu = d.get("TimeUS")
        if tu is None:
            continue
        if t0 is None:
            t0 = tu
        d["_t"] = (tu - t0) / 1e6  # seconds since first message
        raw[mtype].append(d)

    if t0 is None:
        return None  # no usable messages

    # ----- choose track source: GPS (filtered) > POS > AHR2 ------------------
    track = []
    have_gps = False
    fix_quality = "NO POSITION DATA"

    gps_pts = [g for g in raw["GPS"]
               if gv(g, "Status") is None or gv(g, "Status") >= 3]
    if gps_pts:
        have_gps = True
        max_status = max((gv(g, "Status") or 0) for g in raw["GPS"])
        fix_quality = {0: "NO FIX", 1: "NO FIX", 2: "2D FIX", 3: "3D FIX",
                       4: "DGPS", 5: "RTK FLOAT", 6: "RTK FIXED"}.get(max_status, f"FIX {max_status}")
        for g in gps_pts:
            lat = to_degrees(gv(g, "Lat"))
            lon = to_degrees(gv(g, "Lng", "Lon"))
            if lat is None or lon is None:
                continue
            alt = gv(g, "Alt")
            track.append({
                "t": round(g["_t"], 3),
                "lat": lat, "lon": lon,
                "alt": round(alt, 2) if alt is not None else None,
                "mgrs": to_mgrs(lat, lon),
                "utc": gps_to_utc(gv(g, "GWk", "GWk"), gv(g, "GMS")),
                "spd": gv(g, "Spd"),
            })
    else:
        src = raw["POS"] if raw["POS"] else raw["AHR2"]
        if src:
            fix_quality = ("EKF/POS (no GPS msg in log)" if raw["POS"]
                           else "AHR2 (no GPS/POS in log)")
            for p in src:
                lat = to_degrees(gv(p, "Lat"))
                lon = to_degrees(gv(p, "Lng", "Lon"))
                if lat is None or lon is None:
                    continue
                alt = gv(p, "Alt")
                track.append({
                    "t": round(p["_t"], 3),
                    "lat": lat, "lon": lon,
                    "alt": round(alt, 2) if alt is not None else None,
                    "mgrs": to_mgrs(lat, lon),
                    "utc": None,
                    "spd": None,
                })

    # ----- derive ground speed if not provided ------------------------------
    for i in range(1, len(track)):
        if track[i]["spd"] is None:
            a, b = track[i - 1], track[i]
            dt = b["t"] - a["t"]
            if dt > 0:
                track[i]["spd"] = round(haversine_m(a["lat"], a["lon"],
                                                    b["lat"], b["lon"]) / dt, 2)
            else:
                track[i]["spd"] = 0.0
    if track and track[0]["spd"] is None:
        track[0]["spd"] = 0.0

    # ----- total distance ---------------------------------------------------
    total_dist = 0.0
    for i in range(1, len(track)):
        total_dist += haversine_m(track[i - 1]["lat"], track[i - 1]["lon"],
                                  track[i]["lat"], track[i]["lon"])

    # ----- telemetry series -------------------------------------------------
    def series(rows, fields):
        out = []
        for r in rows:
            pt = {"t": round(r["_t"], 3)}
            ok = False
            for out_key, in_keys in fields.items():
                v = gv(r, *in_keys)
                if v is not None:
                    pt[out_key] = round(v, 4) if isinstance(v, float) else v
                    ok = True
            if ok:
                out.append(pt)
        return decimate(out)

    telemetry = {
        "attitude": series(raw["ATT"], {"roll": ["Roll"], "pitch": ["Pitch"], "yaw": ["Yaw"]}),
        "altitude": decimate([{"t": p["t"], "alt": p["alt"]} for p in track if p["alt"] is not None]),
        "speed":    decimate([{"t": p["t"], "spd": p["spd"]} for p in track if p["spd"] is not None]),
        "battery":  series(raw["BAT"], {"volt": ["Volt"], "curr": ["Curr"], "currtot": ["CurrTot"]}),
        "vibe":     series(raw["VIBE"], {"x": ["VibeX"], "y": ["VibeY"], "z": ["VibeZ"]}),
    }
    # ----- RF link: RSSI + RCIN channels + protocol/frequency ---------------
    # RSSI -> [{t, rssi, lq}]. ArduPilot's RXRSSI is a 0..1 receiver-strength
    # fraction for CRSF-family links; pass it through unscaled and keep RXLQ.
    rssi = series(raw["RSSI"], {"rssi": ["RXRSSI", "RSSI"], "lq": ["RXLQ"]})

    # RCIN -> [{t, c1..c8}]. Channels are PWM microseconds (1000..2000 typical).
    rcin = series(raw["RCIN"], {f"c{i}": [f"C{i}"] for i in range(1, 9)})

    # RC protocol from the boot-time MSG line "RC Protocol: GHST".
    rc_protocol = None
    for mrow in raw["MSG"]:
        txt = mrow.get("Message")
        if isinstance(txt, str) and "RC Protocol:" in txt:
            rc_protocol = txt.split("RC Protocol:", 1)[1].strip()
            break
    rc_freq_ghz = RC_FREQ_GHZ.get(rc_protocol.upper(), None) if rc_protocol else None

    # ----- modes ------------------------------------------------------------
    modes = []
    for mrow in raw["MODE"]:
        num = gv(mrow, "ModeNum", "Mode")
        name = None
        if isinstance(gv(mrow, "Mode"), str):
            name = gv(mrow, "Mode")
        if name is None and num is not None:
            name = COPTER_MODES.get(int(num), f"MODE_{int(num)}")
        modes.append({"t": round(mrow["_t"], 3), "mode_num": num, "mode_name": name})
    modes_flown = []
    for m in modes:
        if m["mode_name"] and m["mode_name"] not in modes_flown:
            modes_flown.append(m["mode_name"])

    # ----- duration / summary ----------------------------------------------
    all_t = [r["_t"] for rows in raw.values() for r in rows]
    duration_s = round(max(all_t) - min(all_t), 2) if all_t else 0.0

    max_alt = max((p["alt"] for p in track if p["alt"] is not None), default=None)
    max_speed = max((p["spd"] for p in track if p["spd"] is not None), default=None)
    start_utc = next((p["utc"] for p in track if p["utc"]), None)

    rssi_vals = [p["rssi"] for p in rssi if p.get("rssi") is not None]

    summary = {
        "max_alt": round(max_alt, 2) if max_alt is not None else None,
        "max_speed": round(max_speed, 2) if max_speed is not None else None,
        "total_dist_m": round(total_dist, 1),
        "modes_flown": modes_flown,
        "fix_quality": fix_quality,
        "start_utc": start_utc,
        "track_points": len(track),
        "has_gps": have_gps,
        "rssi_min": round(min(rssi_vals), 3) if rssi_vals else None,
        "rssi_avg": round(sum(rssi_vals) / len(rssi_vals), 3) if rssi_vals else None,
        "rssi_max": round(max(rssi_vals), 3) if rssi_vals else None,
    }

    return {
        "id": flight_id,
        "filename": os.path.basename(path),
        "duration_s": duration_s,
        "track": track,
        "telemetry": telemetry,
        "modes": modes,
        "summary": summary,
        "rcin": rcin,
        "rssi": rssi,
        "rc_protocol": rc_protocol,
        "rc_freq_ghz": rc_freq_ghz,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(argv):
    if len(argv) < 3:
        sys.exit("usage: python3 extract.py <drone_id> <log1.bin> [log2.bin ...]")

    drone_id = argv[1]
    files = argv[2:]

    flights = []
    for i, path in enumerate(files, start=1):
        if not os.path.exists(path):
            print(f"  ! skip (not found): {path}", file=sys.stderr)
            continue
        print(f"  parsing {path} ...", file=sys.stderr)
        try:
            flight = extract_flight(path, flight_id=i)
        except Exception as e:
            print(f"  ! error parsing {path}: {e}", file=sys.stderr)
            continue
        if flight is None:
            print(f"  ! no usable data in {path}", file=sys.stderr)
            continue
        s = flight["summary"]
        print(f"    -> flight {flight['id']}: {flight['duration_s']}s, "
              f"{s['track_points']} pts, max_alt={s['max_alt']}, "
              f"fix={s['fix_quality']}, modes={s['modes_flown']}", file=sys.stderr)
        flights.append(flight)

    os.makedirs("data", exist_ok=True)
    out_path = os.path.join("data", f"{drone_id}.json")
    with open(out_path, "w") as f:
        json.dump(flights, f, separators=(",", ":"))
    print(f"wrote {out_path} ({len(flights)} flights, "
          f"{os.path.getsize(out_path)} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv)
