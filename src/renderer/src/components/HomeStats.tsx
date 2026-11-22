import { useEffect, useState } from 'react'
import type { StatsResult } from '@shared/types'
import { openArtist, openSongMenu } from '@/lib/view'
import { usePlayer } from '@/lib/store'
import { Thumb } from './Thumb'
import { PlayFab } from './PlayFab'

/** "Your most played" – built from Triad's local listening history (nothing leaves this computer). */
export function HomeStats() {
  const [st, setSt] = useState<StatsResult | null>(null)
  const videoId = usePlayer((s) => s.videoId)
  useEffect(() => { window.ytm.stats().then(setSt).catch(() => setSt(null)) }, [videoId])   // refresh when the song changes

  if (!st) return null
  if (!st.songs.length)
    return <p className="mb-8 rounded-2xl bg-white/[.04] p-4 text-[14px] text-mute">Listen to some songs in Triad and your most played songs and artists will show up here.</p>

  return (
    <div className="mb-9 flex flex-col gap-9">
      <section aria-label="Your most played songs">
        <h2 className="mb-3 text-[22px] font-bold tracking-tight">Your most played songs</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {st.songs.slice(0, 10).map((s, i) => (
            <button key={s.videoId} onContextMenu={(e) => openSongMenu({ videoId: s.videoId, title: s.title, artist: s.artist }, e)} onClick={() => window.ytm.command({ type: 'playTrack', videoId: s.videoId })}
              className="group relative rounded-lg bg-white/[.04] p-3 text-left transition-colors hover:bg-hover">
              <span className="absolute left-5 top-5 z-10 grid size-6 place-items-center rounded-full bg-black/65 text-[12px] font-bold">{i + 1}</span>
              <div className="relative">
                <div className="aspect-square overflow-hidden rounded-md bg-hover"><Thumb src={s.artwork} /></div>
                <PlayFab item={{ kind: 'song', videoId: s.videoId }} />
              </div>
              <div className="mt-3 truncate text-[14px] font-semibold">{s.title}</div>
              <div className="truncate text-[13px] text-mute">{s.artist} · {s.plays} {s.plays === 1 ? 'play' : 'plays'}</div>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Your most played artists">
        <h2 className="mb-3 text-[22px] font-bold tracking-tight">Your top artists</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {st.artists.slice(0, 8).map((a) => (
            <button key={a.name} onClick={() => openArtist({ name: a.name })}
              className="rounded-lg bg-white/[.04] p-3 text-left transition-colors hover:bg-hover">
              <div className="aspect-square overflow-hidden rounded-full bg-hover"><Thumb src={a.artwork} round /></div>
              <div className="mt-3 truncate text-[14px] font-semibold">{a.name}</div>
              <div className="truncate text-[13px] text-mute">{a.plays} {a.plays === 1 ? 'play' : 'plays'}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
