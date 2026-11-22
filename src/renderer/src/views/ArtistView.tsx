import { Play } from 'lucide-react'
import { useRpc } from '@/lib/useRpc'
import { Shelves } from '@/components/Shelves'
import { Thumb } from '@/components/Thumb'
import { playItem } from '@/lib/view'
import type { Item } from '@shared/types'

/** Artist profile built from YouTube Music's own artist page: photo, listeners, bio, songs, albums, videos, related artists. */
export function ArtistView({ browseId, name, onOpen }: { browseId?: string; name: string; onOpen: (it: Item) => void }) {
  const { data, error, loading } = useRpc('artist', { browseId, name })
  const firstSong = data?.shelves.flatMap((s) => s.items).find((i) => i.kind === 'song')

  if (loading && !data) return <p className="text-mute">Loading {name}…</p>
  if (error) return <p className="rounded-xl bg-hover p-4 text-[14px]">Couldn’t load this artist: {error}</p>
  if (!data) return <p className="text-mute">Couldn’t find a profile for “{name}”.</p>

  return (
    <>
      <div className="-mx-6 -mt-6 flex items-end gap-6 px-6 pb-6 pt-8">
        <div className="size-[190px] shrink-0 overflow-hidden rounded-full bg-hover shadow-[0_8px_40px_rgba(0,0,0,.5)]">
          <Thumb src={data.thumbnail} round />
        </div>
        <div className="min-w-0 pb-1">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-white/70">Artist</p>
          <h1 className="line-clamp-2 text-[56px] font-extrabold leading-[1.05] tracking-tight">{data.name}</h1>
          {data.subscribers && <p className="mt-3 text-[14px] text-white/75">{data.subscribers}</p>}
        </div>
      </div>

      <div className="mb-5 flex items-center gap-4">
        {firstSong && (
          <button aria-label="Play top song" onClick={() => playItem(firstSong)}
            className="grid size-14 place-items-center rounded-full blue-glass transition-transform hover:scale-105 active:scale-95">
            <Play size={24} fill="currentColor" className="ml-0.5" />
          </button>
        )}
      </div>

      {data.description && (
        <p className="mb-8 line-clamp-4 max-w-[760px] select-text text-[14px] leading-relaxed text-white/70">{data.description}</p>
      )}
      <Shelves shelves={data.shelves} onOpen={onOpen} />
    </>
  )
}
