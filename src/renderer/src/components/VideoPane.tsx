import { useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

/** Slides up over the lyrics: the music video, drawn from frames the player sends over. Drag the handle down (or tap it) to put it away. */
export type VideoStatus = 'looking' | 'loading' | 'playing' | 'none' | 'failed'
const NOTE: Record<Exclude<VideoStatus, 'playing'>, string> = {
  looking: 'Looking for a music video…', loading: 'Loading the video…',
  none: 'No music video found for this song', failed: 'Couldn’t load the video'
}

export function VideoPane({ open, status, onFrame, onClose }: { open: boolean; status: VideoStatus; onFrame: () => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    if (!open) return
    let busy = false
    const off = window.ytm.onVideoFrame(async (jpeg) => {
      if (busy) return                                   // drop frames instead of queueing them
      busy = true
      try {
        const bmp = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
        const c = canvas.current, ctx = c?.getContext('2d')
        onFrame()
        if (c && ctx) { if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height } ctx.drawImage(bmp, 0, 0) }
        bmp.close()
      } catch { /* a bad frame is fine */ }
      busy = false
    })
    return off
  }, [open, onFrame])

  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, dy: 0 } }
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !wrap.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    wrap.current.style.transition = 'none'; wrap.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const up = () => {
    const d = drag.current; drag.current = null
    if (!wrap.current) return
    wrap.current.style.transition = ''; wrap.current.style.transform = ''
    if (!d || d.dy < 4 || d.dy > 70) onClose()          // a tap or a real pull-down both close it
  }

  return (
    <div ref={wrap} aria-hidden={!open} style={{ transform: open ? undefined : 'translateY(105%)' }}
      className={`absolute inset-x-0 bottom-0 z-20 rounded-t-[26px] border-t border-white/15 bg-black/80 shadow-[0_-12px_40px_rgba(0,0,0,.55)] transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${open ? '' : 'pointer-events-none'}`}>
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Drag down to close"
        className="grid h-8 cursor-grab touch-none place-items-center text-white/60 hover:text-white active:cursor-grabbing"><ChevronDown size={20} /></div>
      <div className="relative">
        <canvas ref={canvas} width={640} height={360} className="block h-auto max-h-[60vh] w-full bg-black object-contain" />
        {open && status !== 'playing' && (
          <div className="absolute inset-0 grid place-items-center bg-black/80 px-6 text-center text-[13.5px] text-white/80">{NOTE[status]}</div>)}
      </div>
    </div>
  )
}
