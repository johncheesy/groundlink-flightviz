import { useMemo } from 'react'
import { Chart, C } from './TelemetryPanel.jsx'

// Friendly protocol names for the header line.
const PROTO_NAME = {
  GHST: 'Ghost', CRSF: 'Crossfire', ELRS: 'ExpressLRS', '900ELRS': 'ExpressLRS 900',
  FRSKY: 'FrSky', DSM: 'Spektrum DSM', DSMX: 'Spektrum DSMX', FPORT: 'FPort',
  SBUS: 'S.BUS', IBUS: 'IBUS',
}

const CHANNELS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']
const PWM_MIN = 1000
const PWM_MAX = 2000

function atTime(arr, t) {
  if (!arr.length) return null
  if (t == null) return arr[arr.length - 1] // default to the latest frame
  let best = arr[0], bd = Infinity
  for (const p of arr) {
    const d = Math.abs(p.t - t)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

function ChannelBar({ name, value }) {
  const has = typeof value === 'number'
  const frac = has ? Math.max(0, Math.min(1, (value - PWM_MIN) / (PWM_MAX - PWM_MIN))) : 0
  return (
    <div className="fv-chan">
      <span className="fv-chan__name">{name}</span>
      <span className="fv-chan__track">
        <span className="fv-chan__mid" />
        <span className="fv-chan__fill" style={{ width: `${frac * 100}%` }} />
      </span>
      <span className="fv-chan__val">{has ? `${value} µs` : '—'}</span>
    </div>
  )
}

export default function RFPanel({ flight, hoverT, onHover }) {
  const proto = flight.rc_protocol
  const freq = flight.rc_freq_ghz
  const name = proto ? (PROTO_NAME[proto.toUpperCase()] || proto) : 'Unknown link'

  // RSSI as % for the chart; keep RXLQ (already 0..100) alongside.
  const rssiData = useMemo(() => flight.rssi.map((p) => ({
    t: p.t,
    rssi: p.rssi != null ? Math.round(p.rssi * 1000) / 10 : null,
    lq: p.lq,
  })), [flight])

  const frame = useMemo(() => atTime(flight.rcin, hoverT), [flight, hoverT])
  const hasRF = flight.rssi.length || flight.rcin.length

  if (!hasRF) {
    return <div className="fv-rf-empty">No RC link data (RCIN / RSSI) recorded in this flight.</div>
  }

  const hasLq = rssiData.some((p) => p.lq != null)

  return (
    <div>
      <div className="fv-rfhead">
        <span className="fv-rfhead__proto">{name}</span>
        {freq != null && (
          <>
            <span style={{ color: 'var(--faint)' }}>·</span>
            <span className="fv-rfhead__freq">{freq} GHz</span>
          </>
        )}
        {proto && <span className="badge badge--ref" style={{ marginLeft: 'auto' }}>{proto}</span>}
      </div>

      <div style={{ marginTop: 'var(--sp-3)' }}>
        <Chart
          title="Link signal" unit="%" data={rssiData} maxT={flight.duration_s}
          modes={flight.modes || []} onHover={onHover} height={120}
          lines={[
            { key: 'rssi', name: 'RSSI', color: C.teal },
            ...(hasLq ? [{ key: 'lq', name: 'LQ', color: C.azure }] : []),
          ]}
        />
      </div>

      {flight.rcin.length > 0 && (
        <>
          <div className="fv-chart__label" style={{ marginTop: 'var(--sp-2)' }}>
            <span>RC channels</span>
            <span className="fv-chart__legend">
              <span>{frame ? `@ T+${frame.t.toFixed(1)} s` : ''}{hoverT == null ? ' · hover charts to scrub' : ''}</span>
            </span>
          </div>
          <div className="fv-rf-grid">
            {CHANNELS.map((c, i) => (
              <ChannelBar key={c} name={`C${i + 1}`} value={frame ? frame[c] : undefined} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
