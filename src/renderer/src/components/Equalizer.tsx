import { useEffect, useId, useRef, useState, type KeyboardEvent as RKeyEvent, type PointerEvent as RPointerEvent } from 'react'
import { EQ_FREQS } from '@shared/types'

const W = 400, H = 200, PAD = 28, TOP = 34, BOT = 150, MIN = -12, MAX = 12
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
const xOf = (i: number) => PAD + (i * (W - 2 * PAD)) / (EQ_FREQS.length - 1)
const yOf = (g: number) => TOP + ((MAX - g) / (MAX - MIN)) * (BOT - TOP)
const gOf = (y: number) => clamp(MAX - ((y - TOP) / (BOT - TOP)) * (MAX - MIN), MIN, MAX)
const label = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`)

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [7, 6, 3, 0, -1, 0, 1, 1],
  Vocal: [-2, -1, 1, 4, 5, 3, 0, -2],
  Treble: [-1, -1, 0, 0, 2, 4, 6, 7],
  Chill: [3, 2, 1, 0, -1, 0, 2, 3],
  Loud: [6, 4, 0, -1, -1, 0, 3, 5]
}

/** Smooth (Catmull-Rom) path through the band points. */
function curve(pts: { x: number; y: number }[]) {
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`
  }
  return d
}

/**
 * Water-style equalizer: the curve is the surface of a pool. Drag a band (or click anywhere) and the surface
 * follows with a little spring wobble; ripples spread from where you touch it.
 */
export function Equalizer({ gains, onChange, disabled = false }: { gains: number[]; onChange: (g: number[], final: boolean) => void; disabled?: boolean }) {
  const id = useId().replace(/:/g, '')
  const svg = useRef<SVGSVGElement>(null)
  const shownRef = useRef<number[]>(gains.slice())          // what's drawn (springs toward `gains`)
  const vel = useRef<number[]>(gains.map(() => 0))
  const [, tick] = useState(0)
  const target = useRef(gains); target.current = gains
  const raf = useRef(0)
  const [active, setActive] = useState<number | null>(null)

  // spring animation toward the target values (state lives in refs so frames never get dropped)
  useEffect(() => {
    cancelAnimationFrame(raf.current)
    const step = () => {
      let moving = false
      const cur = shownRef.current
      for (let i = 0; i < cur.length; i++) {
        const t = target.current[i] ?? 0
        vel.current[i] = ((vel.current[i] ?? 0) + (t - cur[i]) * 0.11) * 0.74
        cur[i] += vel.current[i]
        if (Math.abs(t - cur[i]) > 0.01 || Math.abs(vel.current[i]) > 0.01) moving = true
        else { cur[i] = t; vel.current[i] = 0 }
      }
      tick((n) => n + 1)
      raf.current = moving ? requestAnimationFrame(step) : 0
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [gains])
  const shown = shownRef.current

  const pts = shown.map((g, i) => ({ x: xOf(i), y: yOf(g) }))
  const line = `M 0 ${pts[0].y} L ${pts[0].x} ${pts[0].y}` + curve(pts).slice(curve(pts).indexOf('C') - 1) + ` L ${W} ${pts[pts.length - 1].y}`
  const fill = `${line} L ${W} ${H} L 0 ${H} Z`

  const at = (e: RPointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }
  const setBand = (i: number, g: number, final: boolean) => {
    const next = gains.slice(); next[i] = Math.round(clamp(g, MIN, MAX) * 2) / 2
    onChange(next, final)
  }
  const down = (e: RPointerEvent) => {
    const { x, y } = at(e)
    let best = 0
    for (let i = 1; i < EQ_FREQS.length; i++) if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i
    svg.current!.setPointerCapture(e.pointerId)
    setActive(best); setBand(best, gOf(y), false)
  }
  const move = (e: RPointerEvent) => { if (active !== null) setBand(active, gOf(at(e).y), false) }
  const up = () => { if (active !== null) onChange(gains, true); setActive(null) }

  const key = (i: number, e: RKeyEvent) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
    if (d) { e.preventDefault(); setBand(i, gains[i] + d, true) }
  }

  return (
    <div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className={`w-full touch-none select-none rounded-2xl bg-black/25 transition-[opacity,filter] duration-300 ${disabled ? 'opacity-45 saturate-0' : ''}`} role="group" aria-label="Equalizer"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <defs>
          <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6fb0ff" stopOpacity=".78" /><stop offset=".55" stopColor="#4c8dff" stopOpacity=".34" /><stop offset="1" stopColor="#1f4b8f" stopOpacity=".08" />
          </linearGradient>
          <filter id={`${id}b`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" /></filter>
          <filter id={`${id}g`} x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="2.5" /></filter>
          <clipPath id={`${id}c`}><path d={fill} /></clipPath>
        </defs>

        {/* 0 dB guide */}
        <line x1={PAD - 10} x2={W - PAD + 10} y1={yOf(0)} y2={yOf(0)} stroke="white" strokeOpacity=".14" strokeDasharray="3 5" />

        {/* the pool */}
        <path d={fill} fill={`url(#${id}w)`} />
        <g clipPath={`url(#${id}c)`}>
          <ellipse className="eq-drift-a" cx="90" cy="120" rx="70" ry="22" fill="#cfe4ff" opacity=".22" filter={`url(#${id}b)`} />
          <ellipse className="eq-drift-b" cx="250" cy="105" rx="90" ry="18" fill="#8fc0ff" opacity=".24" filter={`url(#${id}b)`} />
          <ellipse className="eq-drift-c" cx="340" cy="135" rx="60" ry="24" fill="#ffffff" opacity=".14" filter={`url(#${id}b)`} />
        </g>
        {/* surface: a soft glow, a gently bobbing second surface, and the crisp line */}
        <path d={line} fill="none" stroke="#7fb6ff" strokeWidth="6" strokeOpacity=".55" filter={`url(#${id}g)`} />
        <path className="eq-bob" d={line} fill="none" stroke="#cfe4ff" strokeWidth="1.2" strokeOpacity=".4" />
        <path d={line} fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeOpacity=".92" />

        {/* band handles + labels */}
        {pts.map((p, i) => (<g key={i}>
          <rect x={p.x - 14} y={TOP - 8} width="28" height={BOT - TOP + 16} fill="transparent"
            tabIndex={0} role="slider" aria-label={`${EQ_FREQS[i]} Hz`} aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={gains[i]} onKeyDown={(e) => key(i, e)} className="cursor-grab outline-none" />
          <text x={p.x} y={H - 14} textAnchor="middle" fontSize="10" fill="white" fillOpacity={active === i ? 0.95 : 0.5}>{label(EQ_FREQS[i])}</text>
        </g>))}
        {active !== null && (
          <text x={xOf(active)} y={clamp(pts[active].y - 16, 14, H)} textAnchor="middle" fontSize="11" fontWeight="600" fill="white">
            {gains[active] > 0 ? '+' : ''}{gains[active].toFixed(1)} dB
          </text>)}
      </svg>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(EQ_PRESETS).map(([name, g]) => {
          const on = g.every((v, i) => v === gains[i])
          return (
            <button key={name} onClick={() => onChange(g, true)} aria-pressed={on}
              className={`h-7 rounded-full px-3 text-[12.5px] font-medium transition-colors ${on ? 'blue-glass' : 'bg-white/10 text-white/75 hover:bg-white/15 hover:text-white'}`}>{name}</button>)
        })}
      </div>
    </div>
  )
}
