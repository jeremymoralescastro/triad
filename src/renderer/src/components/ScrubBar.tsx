import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { fmt, usePlayer } from '@/lib/store'

/**
 * Client-side seeking. When you click the bar (or a lyric line) the UI takes over: its own clock starts at the
 * spot you clicked and keeps counting, whatever the hidden player reports meanwhile. It hands control back to the
 * player as soon as the player agrees (within 1.5s), the song changes, or after HOLD_MS if it never does.
 */
const HOLD_MS = 30_000
const useSeek = create<{ t: number | null; at: number; vid: string | null }>(() => ({ t: null, at: 0, vid: null }))

export function seekTo(seconds: number) {
  const t = Math.max(0, seconds)
  useSeek.setState({ t, at: Date.now(), vid: usePlayer.getState().videoId })
  window.ytm.command({ type: 'seek', seconds: t })
}

/** The engine reports ~2×/sec; between reports (and during a held seek) the clock advances locally. */
export function useLiveTime() {
  const engineTime = usePlayer((s) => s.currentTime)
  const paused = usePlayer((s) => s.paused)
  const duration = usePlayer((s) => s.duration)
  const adActive = usePlayer((s) => s.adActive)
  const videoId = usePlayer((s) => s.videoId)
  const seek = useSeek()
  const [t, setT] = useState(engineTime)
  const engineRef = useRef(engineTime)
  engineRef.current = engineTime

  useLayoutEffect(() => {            // layout effect: the new position is in place before the next paint (no flash of the old one)
    const held = seek.t !== null && seek.vid === videoId && Date.now() - seek.at < HOLD_MS
    const origin = held ? seek.t! : engineTime
    const t0 = held ? seek.at : Date.now()
    const running = !paused && !adActive
    const at = () => Math.min(duration || Infinity, origin + (running ? (Date.now() - t0) / 1000 : 0))
    setT(at())
    if (!running) return
    let raf = requestAnimationFrame(function loop() {
      const v = at()
      setT(v)
      if (held && Math.abs(engineRef.current - v) < 1.5) useSeek.setState({ t: null })   // the player caught up → follow it again
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [engineTime, paused, adActive, duration, videoId, seek.t, seek.at, seek.vid])

  return t
}

export function ScrubBar() {
  const live = useLiveTime()
  const duration = usePlayer((s) => s.duration)
  const [drag, setDrag] = useState<number | null>(null)
  const value = drag ?? live
  const commit = () => { if (drag !== null) { seekTo(drag); setDrag(null) } }

  return (
    <div className="flex w-full items-center gap-2.5 text-[11px] tabular-nums text-mute">
      <span className="w-9 text-right">{fmt(value)}</span>
      <input type="range" className="slider" aria-label="Seek" min={0} max={duration || 1} step={0.1} value={Math.min(value, duration || 1)}
        style={{ ['--p' as string]: `${duration ? (value / duration) * 100 : 0}%` }}
        onChange={(e) => setDrag(+e.target.value)} onPointerUp={commit} onKeyUp={commit} />
      <span className="w-9">{fmt(duration)}</span>
    </div>
  )
}
