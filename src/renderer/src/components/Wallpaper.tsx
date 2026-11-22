import { useEffect, useRef, useState } from 'react'
import { usePlayer } from '@/lib/store'
import { useSettings } from '@/lib/settings'

type Layer = { id: number; img: HTMLImageElement; on: boolean }

/** The artwork is blurred ONCE into a tiny canvas that the browser scales up smoothly. A live CSS blur over a
 *  full-screen image is what made fullscreen stutter and flash black (it re-blurs millions of pixels). */
function Wash({ img, on }: { img: HTMLImageElement; on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.filter = 'blur(5px) saturate(1.5)'
    try { ctx.drawImage(img, -12, -12, c.width + 24, c.height + 24) } catch { /* ignore */ }
  }, [img])
  return <canvas ref={ref} width={96} height={96} className="wp-layer absolute -inset-1/4 size-[150%]" data-on={on ? 1 : 0} />
}

/** Pale blue light behind the glass, plus the current artwork blurred into a wash that cross-fades between songs. */
export function Wallpaper() {
  const art = usePlayer((s) => s.artwork)
  const on = useSettings((s) => s.wallpaper)
  const [layers, setLayers] = useState<Layer[]>([])
  const n = useRef(0)

  useEffect(() => {
    if (!art || !on) return
    let live = true
    const img = new Image()
    img.onload = () => {                       // wait until it's decoded so the fade never starts on a blank image
      if (!live) return
      const id = ++n.current
      setLayers((l) => [...l.slice(-2), { id, img, on: false }])          // mounts invisible…
      requestAnimationFrame(() => requestAnimationFrame(() => live && setLayers((l) => l.map((x) => ({ ...x, on: x.id === id }))))) // …then the new one fades IN while every older one fades OUT together
      setTimeout(() => setLayers((l) => l.filter((x) => x.on || x.id > id)), 3200)   // drop faded-out layers
    }
    img.src = art
    return () => { live = false }
  }, [art, on])

  return (
    <div className="wp-root pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-black" aria-hidden>
      {/* soft pools of light: plain gradients, no blur filters */}
      <div className="wp-pools absolute inset-0" style={{ background:
        'radial-gradient(closest-side at 10% 6%, rgba(172,187,255,.34), transparent) 0 0 / 760px 760px no-repeat, ' +
        'radial-gradient(closest-side at 92% 14%, rgba(100,155,194,.30), transparent) 100% 0 / 840px 840px no-repeat, ' +
        'radial-gradient(closest-side at 50% 50%, rgba(152,206,245,.20), transparent) 30% 100% / 940px 760px no-repeat' }} />
      {on && layers.map((l) => <Wash key={l.id} img={l.img} on={l.on} />)}
    </div>
  )
}
