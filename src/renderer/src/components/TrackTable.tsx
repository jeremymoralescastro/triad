import { cleanTitle } from '@/lib/title'
import { Clock, Pause, Play, Volume2 } from 'lucide-react'
import type { Item } from '@shared/types'
import { usePlayer } from '@/lib/store'
import { openSongMenu, playItem } from '@/lib/view'
import { Thumb } from './Thumb'
import { ArtistLinks } from './ArtistLinks'

const COLS = 'grid grid-cols-[40px_minmax(0,6fr)_minmax(0,4fr)_64px] items-center gap-4 px-4'

export function TrackTable({ items, playlist }: { items: Item[]; playlist?: { id: string; canMove: boolean; reload: () => void } }) {
  const current = usePlayer((s) => s.videoId)
  const paused = usePlayer((s) => s.paused)
  return (
    <div role="table" aria-label="Tracks">
      <div role="row" className={`${COLS} border-b border-line pb-2 text-[13px] text-mute`}>
        <span className="text-center">#</span><span>Title</span><span>Album</span>
        <Clock size={15} className="ml-auto mr-2" aria-label="Duration" />
      </div>
      <div className="mt-2">
        {items.map((it, i) => {
          const isCur = !!it.videoId && it.videoId === current
          return (
            <div key={i} role="row" onContextMenu={(e) => it.videoId && openSongMenu({ videoId: it.videoId, title: it.title, artist: it.artist ?? it.subtitle, artists: it.artists, thumbnail: it.thumbnail, album: it.album, albumId: it.albumId, playlist: playlist && (it.setVideoId || playlist.id === 'LM') ? { id: playlist.id, setVideoId: it.setVideoId, prevSetVideoId: playlist.canMove ? items[i - 1]?.setVideoId : undefined, nextSetVideoId: playlist.canMove ? items[i + 1]?.setVideoId : undefined, reload: playlist.reload } : undefined }, e)} onClick={() => (isCur ? window.ytm.command({ type: 'togglePlay' }) : playItem(it))}
              className={`group ${COLS} h-14 cursor-pointer rounded-md hover:bg-hover ${isCur ? 'bg-hover' : ''}`}>
              <button aria-label={isCur && !paused ? `Pause ${it.title}` : `Play ${it.title}`} className="grid place-items-center text-[15px] text-mute">
                <span className={`group-hover:hidden ${isCur ? 'text-accent' : ''}`}>{isCur ? <Volume2 size={16} /> : i + 1}</span>
                {isCur && !paused
                  ? <Pause size={16} fill="currentColor" className="hidden text-white group-hover:block" />
                  : <Play size={16} fill="currentColor" className="hidden text-white group-hover:block" />}
              </button>
              <div className="flex min-w-0 items-center gap-3">
                <span className="size-10 shrink-0 overflow-hidden rounded bg-hover">
                  <Thumb src={it.thumbnail} />
                </span>
                <div className="min-w-0">
                  <div className={`truncate text-[15px] ${isCur ? 'font-semibold text-accent' : ''}`}>{cleanTitle(it.title, it.artist ?? it.subtitle)}</div>
                  <div className="truncate text-[13px] text-mute"><ArtistLinks item={it} /></div>
                </div>
              </div>
              <span className="truncate text-[14px] text-mute">{it.album ?? ''}</span>
              <span className="pr-2 text-right text-[14px] tabular-nums text-mute">{it.duration ?? ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
