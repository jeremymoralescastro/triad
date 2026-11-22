import { useRef, useState } from 'react'
import { usePlayer } from '@/lib/store'
import { Logo } from './Logo'

/**
 * A plain monochrome cloud-and-waveform mark for the SoundCloud entry (drawn with currentColor, like the Triad logo).
 * To use SoundCloud's own logo instead, replace the contents of this component with your SVG.
 */
export function ScMark() {
  return (
    <svg width="40" height="22" viewBox="0 0 40 22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="SoundCloud" className="overflow-visible">
      <path d="M12 20.5h18.5a5.2 5.2 0 0 0 .6-10.4A8.2 8.2 0 0 0 15.3 8.2 6.2 6.2 0 0 0 12 20.5Z" />
      <path d="M2 11.5v5M5.5 9v10M9 12v5" />
    </svg>
  )
}

/**
 * The mark of the service that's playing. Hover it and the OTHER service drops down right under it (fading in/out);
 * click it and the two marks trade places before the app switches.
 */
export function BackendMenu() {
  const backend = usePlayer((s) => s.backend)
  const other = backend === 'sc' ? 'ytm' : 'sc'
  const [open, setOpen] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout>>()
  const show = () => { clearTimeout(t.current); setOpen(true) }
  const hide = () => { clearTimeout(t.current); if (!swapping) t.current = setTimeout(() => setOpen(false), 140) }
  const mark = (b: 'ytm' | 'sc') => (b === 'sc' ? <ScMark /> : <Logo />)
  const go = () => {
    if (swapping) return
    setSwapping(true)
    setTimeout(() => { void window.ytm.setBackend(other) }, 420)      // let the swap play, then switch
  }
  return (
    <div className="no-drag relative mr-1 flex h-11 w-[44px] items-center justify-center" onMouseEnter={show} onMouseLeave={hide}>
      <div key={backend} className="bk-in" data-swap={swapping || undefined}>
        <div className="bk-top">{mark(backend)}</div>
      </div>
      <div className="bk-drop" data-open={open || undefined} data-swap={swapping || undefined} aria-hidden={!open}>
        <button aria-label={other === 'sc' ? 'Switch to SoundCloud' : 'Switch to YouTube Music'} title={other === 'sc' ? 'SoundCloud' : 'YouTube Music'}
          onClick={go} tabIndex={open ? 0 : -1} className="bk-item grid h-11 w-full place-items-center text-white/90 hover:text-white">
          {mark(other)}
        </button>
      </div>
    </div>
  )
}
