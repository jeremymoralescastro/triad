import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis } from 'lucide-react'
import { SPEEDS } from '@shared/types'
import { usePlayer } from '@/lib/store'

const cmd = window.ytm.command
const fmt = (n: number) => `${n}x`

/** The ⋯ button in the player bar: playback speed (pitch follows) and a reverb / flanger effect with a mix slider. */
export function PlaybackMenu() {
  const speed = usePlayer((s) => s.speed)
  const fx = usePlayer((s) => s.fx)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ reverb?: number; flanger?: number }>({})   // local while dragging so the thumb never lags
  const reverb = drag.reverb ?? fx?.reverb ?? 0
  const flanger = drag.flanger ?? fx?.flanger ?? 0
  const setFx = (key: 'reverb' | 'flanger', v: number) => {
    setDrag((d) => ({ ...d, [key]: v }))
    cmd({ type: 'fx', reverb: key === 'reverb' ? v : reverb, flanger: key === 'flanger' ? v : flanger })
  }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    setPos({ right: Math.max(8, window.innerWidth - r.right - 8), bottom: window.innerHeight - r.top + 12 })
  }, [open])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])

  const active = (speed ?? 1) !== 1 || reverb > 0 || flanger > 0
  return (<>
    <button ref={btn} aria-label="Playback settings" aria-expanded={open} title="Speed & effects" onClick={() => setOpen((o) => !o)}
      className={`shrink-0 rounded-full p-0.5 transition-colors ${open || active ? 'text-accent' : 'text-mute hover:text-white'}`}><Ellipsis size={20} /></button>
    {open && pos && createPortal(
      <div ref={pop} role="dialog" aria-label="Playback settings" style={{ right: pos.right, bottom: pos.bottom }}
        className="menu-pop fixed z-[400] w-[300px] rounded-2xl p-4 text-[14px]">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-semibold">Playback speed</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {SPEEDS.map((x) => (
            <button key={x} onClick={() => cmd({ type: 'speed', value: x })} aria-pressed={(speed ?? 1) === x}
              className={`h-8 min-w-[52px] rounded-full px-3 text-[13px] font-medium transition-colors ${(speed ?? 1) === x ? 'blue-glass' : 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'}`}>{fmt(x)}</button>
          ))}
        </div>

        <div className="mb-2 font-semibold">Effects</div>
        <div className="space-y-2.5">
          {([['reverb', 'Reverb', reverb], ['flanger', 'Flanger', flanger]] as const).map(([key, label, val]) => (
            <div key={key} className="flex items-center gap-3">
              <span className={`w-14 text-[13px] ${val > 0 ? 'text-white' : 'text-mute'}`}>{label}</span>
              <input type="range" className="slider min-w-0 flex-1" aria-label={`${label} mix`} min={0} max={1} step={0.01} value={val}
                style={{ ['--p' as string]: `${val * 100}%` }}
                onChange={(e) => setFx(key, +e.target.value)}
                onPointerUp={() => setDrag({})} onKeyUp={() => setDrag({})} onBlur={() => setDrag({})} />
              <span className="w-9 text-right text-[12px] tabular-nums text-mute">{val > 0 ? `${Math.round(val * 100)}%` : 'Off'}</span>
            </div>
          ))}
        </div>
      </div>, document.body)}
  </>)
}
