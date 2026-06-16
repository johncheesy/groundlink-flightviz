import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const AX = '#1c2529'
const SYNC = 'flt'

function fmtT(t) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function ChartTip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="rc-tooltip">
      <div className="t">T+{Number(label).toFixed(1)}s</div>
      {payload.map((p) => (
        <div className="row" key={p.dataKey}>
          <span className="nm" style={{ color: p.color }}>{p.name}</span>
          <span>{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{unit ? ' ' + unit : ''}</span>
        </div>
      ))}
    </div>
  )
}

function Chart({ title, unit, data, lines, modes, maxT, onHover, legend }) {
  if (!data || !data.length) return null
  return (
    <div className="chart-block">
      <div className="chart-label">
        <span>{title}{unit ? ` · ${unit}` : ''}</span>
        <span className="legend">
          {legend.map((l) => (
            <span key={l.key}><i style={{ color: l.color }}>━</i>{l.name}</span>
          ))}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={118}>
        <LineChart data={data} syncId={SYNC} syncMethod="value"
          margin={{ top: 4, right: 10, bottom: 0, left: -18 }}
          onMouseMove={(s) => { if (s && s.activeLabel != null) onHover(Number(s.activeLabel)) }}
          onMouseLeave={() => onHover(null)}>
          <CartesianGrid stroke={AX} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, maxT]}
            tickFormatter={fmtT} stroke={AX} tick={{ fontSize: 9 }}
            allowDecimals={false} minTickGap={40} />
          <YAxis stroke={AX} tick={{ fontSize: 9 }} width={42}
            domain={['auto', 'auto']} />
          <Tooltip content={<ChartTip unit={unit} />} isAnimationActive={false}
            cursor={{ stroke: '#1fd6c4', strokeWidth: 1, strokeOpacity: 0.5 }} />
          {modes.map((m, i) => (
            <ReferenceLine key={i} x={m.t} stroke="#d6a31f" strokeOpacity={0.5}
              strokeDasharray="3 3"
              label={{ value: m.mode_name, position: 'top', fill: '#d6a31f',
                fontSize: 8, fontFamily: 'monospace' }} />
          ))}
          {lines.map((l) => (
            <Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color}
              dot={false} strokeWidth={1.3} isAnimationActive={false}
              connectNulls type="monotone" />
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
      title: 'ATTITUDE', unit: 'deg', data: t.attitude,
      lines: [
        { key: 'roll', name: 'ROLL', color: '#1fd6c4' },
        { key: 'pitch', name: 'PITCH', color: '#8fb7bb' },
        { key: 'yaw', name: 'YAW', color: '#d6a31f' },
      ],
    },
    {
      title: 'ALTITUDE', unit: 'm AMSL', data: t.altitude,
      lines: [{ key: 'alt', name: 'ALT', color: '#1fd6c4' }],
    },
    {
      title: 'GROUND SPEED', unit: 'm/s', data: t.speed,
      lines: [{ key: 'spd', name: 'SPD', color: '#1fd6c4' }],
    },
    {
      title: 'BATTERY', unit: 'V / A', data: t.battery,
      lines: [
        { key: 'volt', name: 'VOLT', color: '#1fd6c4' },
        { key: 'curr', name: 'CURR', color: '#d6a31f' },
      ],
    },
    {
      title: 'VIBRATION', unit: 'm/s²', data: t.vibe,
      lines: [
        { key: 'x', name: 'X', color: '#1fd6c4' },
        { key: 'y', name: 'Y', color: '#8fb7bb' },
        { key: 'z', name: 'Z', color: '#d65a4a' },
      ],
    },
    t.rssi && {
      title: 'RC LINK', unit: 'rssi / lq', data: t.rssi,
      lines: [
        { key: 'rssi', name: 'RSSI', color: '#1fd6c4' },
        { key: 'lq', name: 'LQ', color: '#8fb7bb' },
      ],
    },
  ].filter(Boolean)), [t])

  return (
    <div className="panel telem-panel">
      <div className="panel-head">
        <span className="panel-title">TELEMETRY · {flight.filename}</span>
        <span className="panel-title" style={{ color: '#d6a31f' }}>┊ MODE CHANGE</span>
      </div>
      <div className="telem-scroll">
        {charts.map((c) => (
          <Chart key={c.title} {...c} modes={modes} maxT={maxT}
            onHover={onHover} legend={c.lines} />
        ))}
      </div>
    </div>
  )
}
