import { useState } from 'react'
import { usePlayer } from '@/lib/store'

/** Slider position is perceptual (volume = position²): fine control at the quiet end, no audible steps. */
export function VolumeSlider() {
  const volume = usePlayer((s) => s.volume)          // 0..100
  const [drag, setDrag] = useState<number | null>(null)
  const pos = drag ?? Math.sqrt(Math.max(0, Math.min(100, volume)) / 100)

  return (
    <input type="range" className="slider w-28" aria-label="Volume" min={0} max={1} step={0.001} value={pos}
      style={{ ['--p' as string]: `${pos * 100}%` }}
      onChange={(e) => { const p = +e.target.value; setDrag(p); window.ytm.command({ type: 'volume', value: p * p * 100 }) }}
      onPointerUp={() => setDrag(null)} onKeyUp={() => setDrag(null)} onBlur={() => setDrag(null)} />
  )
}
