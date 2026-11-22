import { Thumb } from './Thumb'
import { Play } from 'lucide-react'
import type { Item } from '@shared/types'

export function playItem(it: Item) {
  if (it.videoId) window.ytm.command({ type: 'playTrack', videoId: it.videoId, playlistId: it.playlistId })
  else if (it.playlistId) window.ytm.command({ type: 'playPlaylist', playlistId: it.playlistId })
}

export function TrackRow({ item, onOpen }: { item: Item; onOpen?: (it: Item) => void }) {
  const playable = !!(item.videoId || item.playlistId)
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raise"
      onDoubleClick={() => playItem(item)}>
      <button onClick={() => (playable ? playItem(item) : onOpen?.(item))}
        className="relative size-11 shrink-0 overflow-hidden rounded-md bg-raise" aria-label={`Play ${item.title}`}>
        <Thumb src={item.thumbnail} />
        <span className="absolute inset-0 hidden place-items-center bg-black/55 group-hover:grid"><Play size={16} fill="white" /></span>
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => (item.browseId && !item.videoId ? onOpen?.(item) : playItem(item))}>
        <div className="truncate text-[15px]">{item.title}</div>
        <div className="truncate text-[13px] text-mute">{item.subtitle}</div>
      </button>
    </div>
  )
}
