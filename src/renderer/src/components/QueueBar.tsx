import { cleanTitle } from '@/lib/title'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, ListMusic, Shuffle, X } from 'lucide-react'
import type { QueueItem } from '@shared/types'
import { usePlayer } from '@/lib/store'
import { useRpc } from '@/lib/useRpc'
import { Thumb } from './Thumb'

/** What plays next: your own queue first, then YouTube Music's order for the playlist/radio you're in. */
export function useUpcoming() {
  const videoId = usePlayer((s) => s.videoId)
  const playlistId = usePlayer((s) => s.playlistId)
  const userQueue = usePlayer((s) => s.userQueue)
  const shuffle = usePlayer((s) => s.shuffle)
  const { data } = useRpc('queue', { videoId: videoId ?? '', playlistId: playlistId ?? undefined }, !!videoId)
  const natural: QueueItem[] = data ?? []
  const next: QueueItem | null = userQueue[0] ?? (shuffle ? null : natural[0] ?? null)
  return { userQueue, natural, next, shuffle }
}

/** The next song, peeking out dimmed from behind the now-playing artwork. Click it to see / edit the whole queue. */
export function NextPeek() {
  const { next, shuffle } = useUpcoming()
  const [open, setOpen] = useState(false)
  if (!next && !shuffle) return null
  return (<>
    <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title={next ? `Next up: ${cleanTitle(next.title, next.artist)}` : 'Next up: shuffling'}
      className="peek-in group relative z-0 -mr-10 ml-1 size-11 shrink-0 overflow-hidden rounded-full bg-hover opacity-80 ring-1 ring-white/10 transition-[opacity,transform] hover:scale-105 hover:opacity-100"
      key={next?.videoId ?? 'shuffle'}>
      {next && <span className="absolute inset-0 transition-[filter] [filter:saturate(1.45)_brightness(.6)] group-hover:[filter:saturate(1.45)_brightness(.85)]"><Thumb src={next.thumbnail} round /></span>}
      {!next && <Shuffle size={16} className="absolute inset-0 m-auto text-white/70" />}
    </button>
    {open && <QueuePanel onClose={() => setOpen(false)} />}
  </>)
}

function QueuePanel({ onClose }: { onClose: () => void }) {
  const { userQueue, natural, shuffle } = useUpcoming()
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const play = (it: QueueItem, fromYtm: boolean) => {
    if (!fromYtm) window.ytm.command({ type: 'queueRemove', index: userQueue.findIndex((x) => x.videoId === it.videoId) })
    window.ytm.command({ type: 'playTrack', videoId: it.videoId, playlistId: fromYtm ? usePlayer.getState().playlistId ?? undefined : undefined })
    onClose()
  }
  // drag to reorder "Playing next" (plain function, not a component, so a re-render never cancels a drag in progress)
  const dragFrom = useRef<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const drop = (to: number) => {
    const from = dragFrom.current; dragFrom.current = null; setOver(null)
    if (from === null || from === to) return
    window.ytm.command({ type: 'queueMove', from, to })
  }
  const row = (it: QueueItem, mine: boolean, i: number) => (
    <div key={it.videoId} draggable={mine}
      onDragStart={mine ? (e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.videoId) } : undefined}
      onDragOver={mine ? (e) => { if (dragFrom.current !== null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== i) setOver(i) } } : undefined}
      onDrop={mine ? (e) => { e.preventDefault(); drop(i) } : undefined}
      onDragEnd={() => { dragFrom.current = null; setOver(null) }}
      className={`group relative flex items-center gap-1 rounded-xl px-1 py-1.5 hover:bg-white/10 ${mine && over === i && dragFrom.current !== null && dragFrom.current !== i
        ? (dragFrom.current < i ? 'shadow-[0_2px_0_0_var(--color-accent)]' : 'shadow-[0_-2px_0_0_var(--color-accent)]') : ''}`}>
      {mine
        ? <span aria-hidden title="Drag to reorder" className="grid size-6 shrink-0 cursor-grab place-items-center text-white/30 group-hover:text-white/70 active:cursor-grabbing"><GripVertical size={16} /></span>
        : <span className="size-1.5 shrink-0" />}
      <button onClick={() => play(it, !mine)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="size-10 shrink-0 overflow-hidden rounded-md bg-hover"><Thumb src={it.thumbnail} /></span>
        <span className="min-w-0"><span className="block truncate text-[14px] font-medium">{cleanTitle(it.title, it.artist)}</span><span className="block truncate text-[12.5px] text-mute">{it.artist}</span></span>
      </button>
      {mine && <button aria-label="Remove from queue" onClick={() => window.ytm.command({ type: 'queueRemove', index: i })}
        className="grid size-7 shrink-0 place-items-center rounded-full text-mute opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"><X size={15} /></button>}
    </div>
  )
  return createPortal(
    <div className="fixed inset-0 z-[250]" onMouseDown={onClose}>
      <div role="dialog" aria-label="Queue" onMouseDown={(e) => e.stopPropagation()}
        className="menu-pop absolute bottom-[108px] right-4 flex max-h-[62vh] w-[360px] flex-col rounded-[24px] p-3">
        <div className="mb-1 flex items-center justify-between px-2 pt-1">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold"><ListMusic size={16} className="text-accent" />Queue</h3>
          {userQueue.length > 0 && <button onClick={() => window.ytm.command({ type: 'queueClear' })} className="text-[12.5px] text-mute hover:text-white">Clear</button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {userQueue.length > 0 && (<>
            <p className="px-2 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wider text-white/45">Playing next</p>
            {userQueue.map((it, i) => row(it, true, i))}
          </>)}
          <p className="px-2 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wider text-white/45">{shuffle ? 'Shuffle is on — next song is random' : 'Then from this playlist / radio'}</p>
          {!shuffle && natural.slice(0, 20).map((it, i) => row(it, false, i))}
          {!shuffle && !natural.length && <p className="px-2 py-2 text-[13px] text-mute">Nothing queued up.</p>}
        </div>
      </div>
    </div>, document.body)
}
