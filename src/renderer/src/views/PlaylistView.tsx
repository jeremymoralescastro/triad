import { useState } from 'react'
import { Check, Heart, Pause, Play, Plus, Search, Shuffle } from 'lucide-react'
import { usePlayer } from '@/lib/store'
import { useIsCurrent } from '@/components/PlayFab'
import { useRpc } from '@/lib/useRpc'
import { Shelves } from '@/components/Shelves'
import { Thumb } from '@/components/Thumb'
import type { Item } from '@shared/types'
import { toast, type View } from '@/lib/view'

type PV = Extract<View, { name: 'playlist' }>

export function PlaylistView({ view, onOpen }: { view: PV; onOpen: (it: Item) => void }) {
  const [nonce, setNonce] = useState(0)
  const isCurrent = useIsCurrent({ playlistId: view.playlistId, browseId: view.browseId })   // is THIS playlist what's playing?
  const paused = usePlayer((s) => s.paused)
  const playing = isCurrent && !paused
  const signedIn = usePlayer((s) => s.loggedIn)
  const { data, error, loading } = useRpc('playlist', { browseId: view.browseId }, true, nonce + (signedIn ? 1000 : 0))
  const firstSong = (data ?? []).flatMap((s) => s.items).find((i) => i.videoId)?.videoId   // albums opened by id have no playlist id: play from the first track
  const editable = /^(VL)?(PL|LM$|sc-pl:)/.test(view.playlistId ?? view.browseId)
  const [filter, setFilter] = useState<string | null>(null)   // null = filter box closed
  const q = (filter ?? '').trim().toLowerCase()
  const shelves = (data ?? [])
    .map((s) => ({ ...s, items: q ? s.items.filter((i) => `${i.title} ${i.artist ?? ''} ${i.subtitle} ${i.album ?? ''}`.toLowerCase().includes(q)) : s.items }))
    .filter((s) => s.items.length)

  return (
    <>
      <div className="-mx-6 -mt-6 flex items-end gap-6 px-6 pb-6 pt-8">
        <div className="grid size-[200px] shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-accent to-brand shadow-[0_8px_40px_rgba(0,0,0,.5)]">
          {view.thumbnail ? <Thumb src={view.thumbnail} />
            : <Heart size={64} fill="white" className="text-white/90" />}
        </div>
        <div className="min-w-0 pb-1">
          <h1 className="line-clamp-2 text-[56px] font-extrabold leading-[1.05] tracking-tight">{view.title}</h1>
          {view.subtitle && <p className="mt-3 truncate text-[14px] text-white/75">{view.subtitle}</p>}
        </div>
      </div>

      <div className="mb-5 flex items-center gap-4">
        {(view.playlistId || firstSong) && (
          <button aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => (isCurrent ? window.ytm.command({ type: 'togglePlay' }) : view.playlistId ? window.ytm.command({ type: 'playPlaylist', playlistId: view.playlistId }) : window.ytm.command({ type: 'playTrack', videoId: firstSong! }))}
            className="grid size-14 place-items-center rounded-full blue-glass transition-transform hover:scale-105 active:scale-95">
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
          </button>
        )}
        {view.playlistId && (
          <button aria-label="Shuffle play" title="Shuffle play" onClick={() => window.ytm.command({ type: 'playPlaylistShuffled', playlistId: view.playlistId! })}
            className="grid size-11 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"><Shuffle size={19} /></button>
        )}
        {filter === null ? (
          <button aria-label="Filter tracks" onClick={() => setFilter('')} className="text-mute hover:text-white"><Search size={22} /></button>
        ) : (
          <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} onBlur={() => !filter && setFilter(null)} placeholder="Filter this list"
            className="h-10 w-64 rounded-full bg-hover px-4 text-[14px] outline-none placeholder:text-mute focus:ring-2 focus:ring-accent" />
        )}
      </div>

      {loading && !data && <p className="text-mute">Loading…</p>}
      {error && <p className="rounded-xl bg-hover p-4 text-[14px]">Couldn’t load this: {error}</p>}
      {data && <Shelves shelves={shelves} onOpen={onOpen} playlist={editable ? { id: view.playlistId ?? view.browseId, canMove: !q, reload: () => setNonce((n) => n + 1) } : undefined} />}
      {data && editable && !/LM$/.test(view.playlistId ?? view.browseId) && (
        <Recommended key={view.browseId} view={view} songs={(data ?? []).flatMap((s) => s.items).filter((i) => i.videoId)} onAdded={() => setNonce((n) => n + 1)} />)}
    </>
  )
}

/** Songs you might want in this playlist, at the bottom: tap + to add one. (Nothing is added for you.) */
function Recommended({ view, songs, onAdded }: { view: PV; songs: Item[]; onAdded: () => void }) {
  const empty = songs.length === 0
  const topic = view.title.replace(/\b(playlist|mix|songs?|music|vibes?|tracks?)\b/gi, ' ').replace(/\s+/g, ' ').trim() || view.title
  const seed = songs[0]?.videoId ?? ''
  const byTitle = useRpc('search', { query: topic }, empty)
  const bySeed = useRpc('queue', { videoId: seed }, !empty)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const have = new Set(songs.map((s) => s.videoId))
  const recs = (empty
    ? (byTitle.data ?? []).flatMap((s) => s.items).filter((i) => i.kind === 'song' && i.videoId).map((i) => ({ videoId: i.videoId!, title: i.title, artist: i.artist ?? i.subtitle, thumbnail: i.thumbnail }))
    : (bySeed.data ?? []).map((q) => ({ videoId: q.videoId, title: q.title, artist: q.artist, thumbnail: q.thumbnail }))
  ).filter((r, i, a) => (!have.has(r.videoId) || added.has(r.videoId)) && a.findIndex((x) => x.videoId === r.videoId) === i).slice(0, 12)
  if (!recs.length) return null

  const add = async (r: { videoId: string }) => {
    if (busy || added.has(r.videoId)) return
    setBusy(r.videoId)
    try {
      await window.ytm.rpc('addToPlaylist', { playlistId: view.playlistId ?? view.browseId, videoId: r.videoId })
      setAdded((a) => new Set(a).add(r.videoId)); onAdded()
    } catch (e) { toast(String((e as Error).message ?? e).replace(/^Error:\s*/, '')) }
    setBusy(null)
  }
  return (
    <section className="mt-10">
      <h2 className="text-[20px] font-bold">Recommended</h2>
      <p className="mb-3 text-[13px] text-mute">{empty ? 'Songs that might fit — tap + to add them.' : 'More like what’s in here — tap + to add.'}</p>
      <div className="flex flex-col">
        {recs.map((r) => (
          <div key={r.videoId} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raise">
            <button onClick={() => window.ytm.command({ type: 'playTrack', videoId: r.videoId })} aria-label={`Play ${r.title}`} className="relative size-11 shrink-0 overflow-hidden rounded-md bg-raise">
              <Thumb src={r.thumbnail} />
              <span className="absolute inset-0 hidden place-items-center bg-black/55 group-hover:grid"><Play size={16} fill="white" /></span>
            </button>
            <div className="min-w-0 flex-1"><div className="truncate text-[15px]">{r.title}</div><div className="truncate text-[13px] text-mute">{r.artist}</div></div>
            <button onClick={() => add(r)} aria-label={added.has(r.videoId) ? 'Added' : `Add ${r.title}`} title={added.has(r.videoId) ? 'Added' : 'Add to this playlist'}
              className={`grid size-9 shrink-0 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20 ${busy === r.videoId ? 'opacity-50' : ''} ${added.has(r.videoId) ? 'text-accent' : 'text-white/85 hover:text-white'}`}>
              {added.has(r.videoId) ? <Check size={18} /> : <Plus size={18} />}
            </button>
          </div>))}
      </div>
    </section>
  )
}
