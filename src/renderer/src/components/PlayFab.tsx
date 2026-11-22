import { Pause, Play } from 'lucide-react'
import type { Item } from '@shared/types'
import { usePlayer } from '@/lib/store'

/** Is this card/row what's playing right now? (a song by its id, an album/playlist by its queue id) */
export function useIsCurrent(it: Pick<Item, 'videoId' | 'playlistId' | 'browseId'>) {
  const videoId = usePlayer((s) => s.videoId)
  const list = usePlayer((s) => s.playlistId)
  if (it.videoId) return it.videoId === videoId
  const id = it.playlistId ?? it.browseId?.replace(/^VL/, '')
  return !!id && !!list && id === list
}

/**
 * Dark play/pause button centred on a cover, fading in on hover.
 * Playing item → pause, paused item → play, anything else → start it.
 * Must sit inside an element with className "relative" that is inside a "group" (the cover wrapper).
 */
export function PlayFab({ item, className = '' }: { item: Pick<Item, 'kind' | 'videoId' | 'playlistId' | 'browseId'>; className?: string }) {
  const current = useIsCurrent(item)
  const paused = usePlayer((s) => s.paused)
  if (!item.videoId && !item.playlistId) return null          // artists etc.: nothing to play directly
  const showPause = current && !paused

  const act = () => {
    if (current) window.ytm.command({ type: 'togglePlay' })
    else if (item.videoId) window.ytm.command({ type: 'playTrack', videoId: item.videoId, playlistId: item.playlistId })
    else if (item.playlistId) window.ytm.command({ type: 'playPlaylist', playlistId: item.playlistId })
  }
  return (
    // dark wash over the cover with the button centred; only the button itself takes clicks (the card behind still opens)
    <span className={`pointer-events-none absolute inset-0 grid place-items-center rounded-md transition-colors duration-200 ${
      current ? 'bg-black/35' : 'bg-black/0 group-hover:bg-black/45'} ${className}`}>
      <span role="button" tabIndex={0} aria-label={showPause ? 'Pause' : 'Play'}
        onClick={(e) => { e.stopPropagation(); act() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); act() } }}
        className={`pointer-events-auto grid size-12 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/25 transition-all duration-200 hover:scale-110 hover:bg-black/75 active:scale-95 focus-visible:scale-100 focus-visible:opacity-100 ${
          current ? 'scale-100 opacity-100' : 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100'}`}>
        {showPause ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
      </span>
    </span>
  )
}
