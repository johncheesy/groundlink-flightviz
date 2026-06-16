import { useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { C, fmtT, ChartTip, SYNC } from './TelemetryPanel.jsx'

const GRID = 'rgba(128,140,160,0.18)'

// BATT_ARM_VOLT from the airframe params — below this the pack is into reserve.
// Voltage trace turns amber (var(--bad)/rose) under the threshold.
const LOW_VOLT = 22.4

function VoltChart({ data, maxT, modes, onHover }) {
  if (!data.length) return null
  return (
    <div className="fv-chart">
      <div className="fv-chart__label">
        <span>Voltage · V</span>
        <span className="fv-chart__legend">
          <span><i style={{ color: C.teal }}>━</i>Volt</span>
          <span><i style={{ color: C.rose }}>┄</i>{LOW_VOLT} V min</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} syncId={SYNC} syncMethod="value"
          margin={{ top: 4, right: 12, bottom: 0, left: -14 }}
          onMouseMove={(s) => { if (s && s.activeLabel != null) onHover(Number(s.activeLabel)) }}
          onMouseLeave={() => onHover(null)}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, maxT]} tickFormatter={fmtT}
            stroke={GRID} tick={{ fontSize: 9 }} allowDecimals={false} minTickGap={40} />
          <YAxis stroke={GRID} tick={{ fontSize: 9 }} width={44} domain={['auto', 'auto']} unit="" />
          <Tooltip content={<ChartTip unit="V" />} isAnimationActive={false}
            cursor={{ stroke: C.teal, strokeWidth: 1, strokeOpacity: 0.6 }} />
          <ReferenceLine y={LOW_VOLT} stroke={C.rose} strokeDasharray="4 4" strokeOpacity={0.8} />
          {modes.map((m, i) => (
            <ReferenceLine key={i} x={m.t} stroke={C.amber} strokeOpacity={0.4} strokeDasharray="3 3" />
          ))}
          {/* split the trace so the under-threshold portion reads amber/rose */}
          <Line dataKey="volt" name="Volt" stroke={C.teal} dot={false} strokeWidth={1.5}
            isAnimationActive={false} connectNulls type="monotone" />
          <Line dataKey="voltLow" name="Volt (low)" stroke={C.rose} dot={false} strokeWidth={1.8}
            isAnimationActive={false} connectNulls type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function CurrChart({ data, maxT, onHover }) {
  if (!data.length) return null
  return (
    <div className="fv-chart">
      <div className="fv-chart__label">
        <span>Current draw · A</span>
        <span className="fv-chart__legend"><span><i style={{ color: C.amber }}>━</i>Curr</span></span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} syncId={SYNC} syncMethod="value"
          margin={{ top: 4, right: 12, bottom: 0, left: -14 }}
          onMouseMove={(s) => { if (s && s.activeLabel != null) onHover(Number(s.activeLabel)) }}
          onMouseLeave={() => onHover(null)}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, maxT]} tickFormatter={fmtT}
            stroke={GRID} tick={{ fontSize: 9 }} allowDecimals={false} minTickGap={40} />
          <YAxis stroke={GRID} tick={{ fontSize: 9 }} width={44} domain={['auto', 'auto']} />
          <Tooltip content={<ChartTip unit="A" />} isAnimationActive={false}
            cursor={{ stroke: C.amber, strokeWidth: 1, strokeOpacity: 0.6 }} />
          <Line dataKey="curr" name="Curr" stroke={C.amber} dot={false} strokeWidth={1.4}
            isAnimationActive={false} connectNulls type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function MahChart({ data, maxT, onHover }) {
  if (!data.length) return null
  return (
    <div className="fv-chart">
      <div className="fv-chart__label">
        <span>Cumulative used · mAh</span>
        <span className="fv-chart__legend"><span><i style={{ color: C.azure }}>━</i>mAh</span></span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={data} syncId={SYNC} syncMethod="value"
          margin={{ top: 4, right: 12, bottom: 0, left: -14 }}
          onMouseMove={(s) => { if (s && s.activeLabel != null) onHover(Number(s.activeLabel)) }}
          onMouseLeave={() => onHover(null)}>
          <defs>
            <linearGradient id="fvMahFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.azure} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.azure} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, maxT]} tickFormatter={fmtT}
            stroke={GRID} tick={{ fontSize: 9 }} allowDecimals={false} minTickGap={40} />
          <YAxis stroke={GRID} tick={{ fontSize: 9 }} width={44} domain={['auto', 'auto']} />
          <Tooltip content={<ChartTip unit="mAh" />} isAnimationActive={false}
            cursor={{ stroke: C.azure, strokeWidth: 1, strokeOpacity: 0.6 }} />
          <Area dataKey="mah_used" name="mAh" stroke={C.azure} fill="url(#fvMahFill)"
            strokeWidth={1.4} isAnimationActive={false} connectNulls type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function SummaryCell({ k, v, u, accent }) {
  return (
    <div className="fv-batt-cell">
      <div className="fv-batt-cell__k">{k}</div>
      <div className={'fv-batt-cell__v' + (accent ? ' is-accent' : '')}>
        {v}{u && <span className="fv-batt-cell__u">{u}</span>}
      </div>
    </div>
  )
}

export default function BatteryPanel({ flight, onHover }) {
  const bat = flight.battery || []
  const bs = flight.battery_summary || {}
  const maxT = flight.duration_s
  const modes = flight.modes || []

  // Split voltage into normal + below-threshold series so the low segment can
  // render rose. Overlap one sample so the two lines join visually.
  const data = useMemo(() => bat.map((p, i, arr) => {
    const low = p.volt != null && p.volt < LOW_VOLT
    const prevLow = i > 0 && arr[i - 1].volt != null && arr[i - 1].volt < LOW_VOLT
    const nextLow = i < arr.length - 1 && arr[i + 1].volt != null && arr[i + 1].volt < LOW_VOLT
    return {
      t: p.t,
      volt: p.volt,
      voltLow: (low || prevLow || nextLow) ? p.volt : null,
      curr: p.curr,
      mah_used: p.mah_used,
    }
  }), [bat])

  if (!bat.length) {
    return <div className="fv-empty">No battery telemetry (BAT messages) in this flight.</div>
  }

  const dv = (bs.start_volt != null && bs.end_volt != null)
    ? (bs.end_volt - bs.start_volt).toFixed(2) : null
  const hasTemp = bs.max_temp != null && bs.max_temp > 0

  return (
    <div>
      <div className="fv-batt-summary">
        <SummaryCell k="Start" v={bs.start_volt != null ? bs.start_volt.toFixed(2) : '—'} u="V" accent />
        <SummaryCell k="End" v={bs.end_volt != null ? bs.end_volt.toFixed(2) : '—'} u="V" accent />
        <SummaryCell k="Δ" v={dv != null ? dv : '—'} u="V" />
        <SummaryCell k="Used" v={bs.total_mah_used != null ? Math.round(bs.total_mah_used) : '—'} u="mAh" />
        <SummaryCell k="Peak" v={bs.max_curr != null ? bs.max_curr.toFixed(1) : '—'} u="A" />
        {hasTemp && <SummaryCell k="Max °" v={bs.max_temp.toFixed(1)} u="°C" />}
      </div>
      <VoltChart data={data} maxT={maxT} modes={modes} onHover={onHover} />
      <CurrChart data={data} maxT={maxT} onHover={onHover} />
      <MahChart data={data} maxT={maxT} onHover={onHover} />
    </div>
  )
}
