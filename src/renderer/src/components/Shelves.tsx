import { cleanTitle } from '@/lib/title'
import type { Item, Shelf } from '@shared/types'
import { playItem } from '@/lib/view'
import { TrackTable } from './TrackTable'
import { Thumb } from './Thumb'
import { PlayFab } from './PlayFab'
import { openSongMenu } from '@/lib/view'

/** Songs → the track table; albums/playlists/artists → cards. */
export function Shelves({ shelves, onOpen, playlist }: { shelves: Shelf[]; onOpen: (it: Item) => void; playlist?: { id: string; canMove: boolean; reload: () => void } }) {
  return (
    <div className="flex flex-col gap-9">
      {shelves.map((s, i) => {
        const songs = s.items.every((x) => x.kind === 'song')
        return (
          <section key={i} aria-label={s.title || undefined} className="[content-visibility:auto] [contain-intrinsic-size:auto_420px]">
            {s.title && <h2 className="mb-3 text-[22px] font-bold tracking-tight">{s.title}</h2>}
            {songs ? <TrackTable items={s.items} playlist={playlist} /> : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {s.items.map((it, j) => (
                  <button key={j} onContextMenu={(e) => it.videoId && openSongMenu({ videoId: it.videoId, title: it.title, artist: it.subtitle, artists: it.artists, thumbnail: it.thumbnail }, e)} onClick={() => (it.browseId ? onOpen(it) : playItem(it))}
                    className="group rounded-lg bg-white/[.04] p-3 text-left transition-colors hover:bg-hover">
                    <div className="relative">
                      <div className={`aspect-square overflow-hidden bg-hover ${it.kind === 'artist' ? 'rounded-full' : 'rounded-md'}`}>
                        <Thumb src={it.thumbnail} round={it.kind === 'artist'} />
                      </div>
                      {it.kind !== 'artist' && <PlayFab item={it} />}
                    </div>
                    <div className="mt-3 truncate text-[14px] font-semibold">{it.kind === 'song' ? cleanTitle(it.title, it.subtitle) : it.title}</div>
                    <div className="truncate text-[13px] text-mute">{it.subtitle}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
