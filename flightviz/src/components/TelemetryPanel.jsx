import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// Theme-independent feature/coverage hexes (GroundLink tokens) — recharts needs
// literal colours, and these read on both the light UI and the dark map.
export const C = {
  azure: '#46a6ff', teal: '#34e6c2', amber: '#ffd479', rose: '#ff6b8a',
  green: '#86e6a0', dim: '#8a93a6',
}
const GRID = 'rgba(128,140,160,0.18)'
export const SYNC = 'flt'

export function fmtT(t) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ChartTip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="fv-tip">
      <div className="fv-tip__t">T+{Number(label).toFixed(1)} s</div>
      {payload.map((p) => (
        <div className="fv-tip__row" key={p.dataKey}>
          <span className="nm" style={{ color: p.color }}>{p.name}</span>
          <span className="v">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{unit ? ' ' + unit : ''}</span>
        </div>
      ))}
    </div>
  )
}

export function Chart({ title, unit, data, lines, modes = [], maxT, onHover, height = 116 }) {
  if (!data || !data.length) return null
  return (
    <div className="fv-chart">
      <div className="fv-chart__label">
        <span>{title}{unit ? ` · ${unit}` : ''}</span>
        <span className="fv-chart__legend">
          {lines.map((l) => (
            <span key={l.key}><i style={{ color: l.color }}>━</i>{l.name}</span>
          ))}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={SYNC} syncMethod="value"
          margin={{ top: 4, right: 12, bottom: 0, left: -14 }}
          onMouseMove={(s) => { if (s && s.activeLabel != null) onHover(Number(s.activeLabel)) }}
          onMouseLeave={() => onHover(null)}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, maxT]}
            tickFormatter={fmtT} stroke={GRID} tick={{ fontSize: 9 }}
            allowDecimals={false} minTickGap={40} />
          <YAxis stroke={GRID} tick={{ fontSize: 9 }} width={44} domain={['auto', 'auto']} />
          <Tooltip content={<ChartTip unit={unit} />} isAnimationActive={false}
            cursor={{ stroke: C.teal, strokeWidth: 1, strokeOpacity: 0.6 }} />
          {modes.map((m, i) => (
            <ReferenceLine key={i} x={m.t} stroke={C.amber} strokeOpacity={0.55} strokeDasharray="3 3"
              label={{ value: m.mode_name, position: 'top', fill: C.amber, fontSize: 8, fontFamily: 'var(--ui)' }} />
          ))}
          {lines.map((l) => (
            <Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color}
              dot={false} strokeWidth={1.4} isAnimationActive={false} connectNulls type="monotone" />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function TelemetryPanel({ flight, onHover }) {
  const t = flight.telemetry
  const maxT = flight.duration_s
  const modes = flight.modes || []

  const charts = useMemo(() => ([
    {
      title: 'Attitude', unit: 'deg', data: t.attitude,
      lines: [
        { key: 'roll', name: 'Roll', color: C.teal },
        { key: 'pitch', name: 'Pitch', color: C.azure },
        { key: 'yaw', name: 'Yaw', color: C.amber },
      ],
    },
    { title: 'Altitude', unit: 'm AMSL', data: t.altitude, lines: [{ key: 'alt', name: 'Alt', color: C.teal }] },
    { title: 'Ground speed', unit: 'm/s', data: t.speed, lines: [{ key: 'spd', name: 'Spd', color: C.azure }] },
    {
      title: 'Battery', unit: 'V / A', data: t.battery,
      lines: [
        { key: 'volt', name: 'Volt', color: C.teal },
        { key: 'curr', name: 'Curr', color: C.amber },
      ],
    },
    {
      title: 'Vibration', unit: 'm/s²', data: t.vibe,
      lines: [
        { key: 'x', name: 'X', color: C.teal },
        { key: 'y', name: 'Y', color: C.azure },
        { key: 'z', name: 'Z', color: C.rose },
      ],
    },
  ].filter((c) => c.data && c.data.length)), [t])

  if (!charts.length) return <div className="fv-empty">No telemetry series in this flight.</div>

  return (
    <div>
      {charts.map((c) => (
        <Chart key={c.title} {...c} modes={modes} maxT={maxT} onHover={onHover} />
      ))}
    </div>
  )
}
