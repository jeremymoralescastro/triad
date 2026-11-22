import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Heart, ListPlus, SkipForward, Link2, Disc3, Pause, Play, Trash2, User } from 'lucide-react'
import { usePlayer } from '@/lib/store'
import { openAlbum, openArtist, type SongRef } from '@/lib/view'

type Choice = { id: string; title: string }
let cache: Choice[] | null = null                       // remembered between openings so the list shows instantly
const orderOf = (): string[] => { try { return JSON.parse(localStorage.getItem('triad:library-order') || '[]') } catch { return [] } }

async function loadPlaylists(): Promise<Choice[]> {
  const shelves = await window.ytm.rpc('library')
  const seen = new Set<string>()
  const items = shelves.flatMap((s) => s.items).filter((i) => i.browseId && i.title && i.title !== 'Liked Music')
    .map((i) => ({ key: i.browseId!, id: (i.playlistId ?? i.browseId!).replace(/^VL/, ''), title: i.title }))
    .filter((i) => /^PL/.test(i.id) && !seen.has(i.id) && seen.add(i.id))      // playlists you can add to (not auto-mixes)
  const order = orderOf(), idx = new Map(order.map((k, n) => [k, n] as [string, number]))
  if (order.length) items.sort((a, b) => (idx.get(a.key) ?? -1) - (idx.get(b.key) ?? -1))   // same order as the sidebar
  return items.map(({ id, title }) => ({ id, title }))
}

/** One app-wide right-click menu for songs + a small toast, driven by window events. */
export function SongMenuHost() {
  const [m, setM] = useState<{ song: SongRef; x: number; y: number } | null>(null)
  const [page, setPage] = useState<'main' | 'playlists'>('main')
  const [choices, setChoices] = useState<Choice[] | null>(cache)
  const [filter, setFilter] = useState('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const current = usePlayer((s) => s.videoId)
  const paused = usePlayer((s) => s.paused)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const toast = useCallback((msg: string) => {
    setToastMsg(msg); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 3000)
  }, [])

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ song: SongRef; x: number; y: number }>).detail
      setM(d); setPage('main'); setFilter('')
      loadPlaylists().then((c) => { cache = c; setChoices(c) }).catch(() => {})     // refresh in the background
    }
    const t = (e: Event) => toast((e as CustomEvent<string>).detail)
    window.addEventListener('triad:song-menu', open); window.addEventListener('triad:toast', t)
    return () => { window.removeEventListener('triad:song-menu', open); window.removeEventListener('triad:toast', t) }
  }, [toast])

  useEffect(() => {
    if (!m) return
    const close = () => setM(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key); window.addEventListener('blur', close); window.addEventListener('wheel', close, { passive: true })
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); window.removeEventListener('blur', close); window.removeEventListener('wheel', close) }
  }, [m])

  const place = (el: HTMLDivElement | null) => {          // keep the whole menu inside the window
    if (!el || !m) return
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(m.x, window.innerWidth - r.width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(m.y, window.innerHeight - r.height - 8))}px`
  }

  const add = async (c: Choice | 'LM') => {
    if (!m) return
    const song = m.song, name = c === 'LM' ? 'Liked Music' : c.title
    setM(null)
    try { await window.ytm.rpc('addToPlaylist', { playlistId: c === 'LM' ? 'LM' : c.id, videoId: song.videoId }); toast(`Added to ${name}`) }
    catch { toast(`Couldn’t add to ${name}`) }
  }

  const queue = (next: boolean) => {
    if (!m) return
    const { song } = m
    window.ytm.command({ type: 'queueAdd', next, item: { videoId: song.videoId, title: song.title, artist: song.artist ?? '', thumbnail: song.thumbnail } })
    toast(next ? 'Playing next' : 'Added to queue'); setM(null)
  }
  /** playlist editing (remove / reorder), then refresh the playlist page */
  const edit = async (run: () => Promise<unknown>, done: string) => {
    const pl = m?.song.playlist
    setM(null)
    try { await run(); toast(done); pl?.reload() } catch { toast('YouTube Music wouldn’t allow that edit') }
  }
  const isCur = !!m && m.song.videoId === current
  const shown = (choices ?? []).filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()))
  const Item = ({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) => (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-white/90 hover:bg-white/10">{icon}<span className="truncate">{label}</span></button>
  )

  return (<>
    {m && createPortal(
      <div role="menu" ref={place} onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
        style={{ position: 'fixed', left: m.x, top: m.y, zIndex: 400 }}
        className="menu-pop w-60 rounded-2xl p-1.5 text-[14px]">
        {page === 'main' ? (<>
          <div className="truncate px-3 pb-1.5 pt-1 text-[12px] text-mute">{m.song.title}{m.song.artist ? ` · ${m.song.artist}` : ''}</div>
          <Item icon={isCur && !paused ? <Pause size={15} /> : <Play size={15} />} label={isCur ? (paused ? 'Resume' : 'Pause') : 'Play'}
            onClick={() => { isCur ? window.ytm.command({ type: 'togglePlay' }) : window.ytm.command({ type: 'playTrack', videoId: m.song.videoId }); setM(null) }} />
          <Item icon={<SkipForward size={15} />} label="Play next" onClick={() => queue(true)} />
          <Item icon={<ListPlus size={15} />} label="Add to queue" onClick={() => queue(false)} />
          <Item icon={<ListPlus size={15} />} label="Add to playlist" onClick={() => setPage('playlists')} />
          {(m.song.artists?.[0] || m.song.artist) && (
            <Item icon={<User size={15} />} label={`Go to ${m.song.artists?.[0]?.name ?? m.song.artist}`}
              onClick={() => { openArtist(m.song.artists?.[0] ?? { name: m.song.artist! }); setM(null) }} />)}
          {m.song.album && (
            <Item icon={<Disc3 size={15} />} label="Go to album"
              onClick={() => { openAlbum({ title: m.song.album!, artist: m.song.artist, browseId: m.song.albumId }); setM(null) }} />)}
          {m.song.playlist && (<>
            <div className="mx-2 my-1 h-px bg-white/10" />
            {m.song.playlist.prevSetVideoId && m.song.playlist.setVideoId && (
              <Item icon={<ArrowUp size={15} />} label="Move up" onClick={() => edit(() => window.ytm.rpc('moveInPlaylist', { playlistId: m.song.playlist!.id, setVideoId: m.song.playlist!.setVideoId!, beforeSetVideoId: m.song.playlist!.prevSetVideoId! }), 'Moved up')} />)}
            {m.song.playlist.nextSetVideoId && m.song.playlist.setVideoId && (
              <Item icon={<ArrowDown size={15} />} label="Move down" onClick={() => edit(() => window.ytm.rpc('moveInPlaylist', { playlistId: m.song.playlist!.id, setVideoId: m.song.playlist!.nextSetVideoId!, beforeSetVideoId: m.song.playlist!.setVideoId! }), 'Moved down')} />)}
            <Item icon={<Trash2 size={15} />} label="Remove from this playlist" onClick={() => edit(() => window.ytm.rpc('removeFromPlaylist', { playlistId: m.song.playlist!.id, videoId: m.song.videoId, setVideoId: m.song.playlist!.setVideoId }), 'Removed')} />
          </>)}
          <Item icon={<Link2 size={15} />} label="Copy song link"
            onClick={() => { navigator.clipboard?.writeText(`https://music.youtube.com/watch?v=${m.song.videoId}`).then(() => toast('Link copied')).catch(() => toast('Couldn’t copy')); setM(null) }} />
        </>) : (<>
          <button onClick={() => setPage('main')} className="mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-mute hover:bg-white/10 hover:text-white"><ArrowLeft size={15} />Add to playlist</button>
          {(choices?.length ?? 0) > 7 && (
            <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a playlist"
              className="mx-1 mb-1.5 h-8 w-[calc(100%-8px)] rounded-full bg-white/10 px-3.5 text-[13px] outline-none placeholder:text-mute focus:ring-2 focus:ring-accent" />)}
          <div className="max-h-[260px] overflow-y-auto">
            {!filter && <Item icon={<Heart size={15} />} label="Liked Music" onClick={() => add('LM')} />}
            {shown.map((c) => <Item key={c.id} icon={<Check size={15} className="opacity-0" />} label={c.title} onClick={() => add(c)} />)}
            {choices === null && <p className="px-3 py-2 text-[13px] text-mute">Loading your playlists…</p>}
            {choices && !shown.length && filter && <p className="px-3 py-2 text-[13px] text-mute">No match.</p>}
          </div>
        </>)}
      </div>, document.body)}
    {toastMsg && createPortal(
      <div role="status" className="menu-pop pointer-events-none fixed bottom-[112px] left-1/2 z-[500] -translate-x-1/2 rounded-full px-5 py-2.5 text-[14px] font-medium">{toastMsg}</div>, document.body)}
  </>)
}
