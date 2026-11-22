import { useEffect, useState } from 'react'
import { House } from 'lucide-react'
import type { Item } from '@shared/types'
import { usePlayer } from '@/lib/store'
import { openTarget, toast, type View } from '@/lib/view'
import { BackendMenu } from '@/components/BackendMenu'
import { LibraryPanel } from '@/components/LibraryPanel'
import { LyricsPanel } from '@/components/LyricsPanel'
import { Wallpaper } from '@/components/Wallpaper'
import { PlayerBar } from '@/components/PlayerBar'
import { AccountBadge } from '@/components/AccountBadge'
import { PartyButton } from '@/components/PartyButton'
import { ShelfView } from '@/views/ShelfView'
import { ArtistView } from '@/views/ArtistView'
import { HomeStats } from '@/components/HomeStats'
import { useSettings } from '@/lib/settings'
import { SongMenuHost } from '@/components/SongMenu'
import { SearchBox } from '@/components/SearchBox'
import { PlaylistView } from '@/views/PlaylistView'

const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const loggedIn = usePlayer((s) => s.loggedIn)
  const notice = usePlayer((s) => s.notice)
  useEffect(() => { if (notice) toast(notice.slice(notice.indexOf('|') + 1)) }, [notice])
  const showLyrics = useSettings((s) => s.lyricsPanel)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); window.ytm.command({ type: 'togglePlay' }) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    const h = (e: Event) => { const a = (e as CustomEvent<{ name: string; browseId?: string }>).detail; setView({ name: 'artist', browseId: a.browseId, artistName: a.name }) }
    window.addEventListener('triad:open-artist', h); return () => window.removeEventListener('triad:open-artist', h)
  }, [])

  useEffect(() => {
    const h = async (e: Event) => {
      const a = (e as CustomEvent<{ title: string; artist?: string; browseId?: string }>).detail
      if (a.browseId) return setView({ name: 'playlist', browseId: a.browseId, title: a.title, subtitle: a.artist ? `Album · ${a.artist}` : 'Album' })
      try {                                                    // no id on hand: find the album by name
        const shelves = await window.ytm.rpc('search', { query: `${a.title} ${a.artist ?? ''}`.trim() })
        const items = shelves.flatMap((s) => s.items).filter((i) => i.kind === 'album')
        const hit = items.find((i) => i.title.toLowerCase() === a.title.toLowerCase()) ?? items[0]
        const v = hit && openTarget(hit)
        if (v) setView(v); else toast(`Couldn’t find the album “${a.title}”`)
      } catch { toast(`Couldn’t find the album “${a.title}”`) }
    }
    window.addEventListener('triad:open-album', h); return () => window.removeEventListener('triad:open-album', h)
  }, [])

  const open = (it: Item) => { const v = openTarget(it); if (v) setView(v) }

  return (
    <div className="relative flex h-full flex-col">
      <Wallpaper />
      {/* top bar = window drag region; Windows keeps the right 144px free for its caption buttons, Mac the left 96px for its traffic lights */}
      <header className={`drag relative flex h-14 shrink-0 items-center gap-3 ${/Mac/i.test(navigator.userAgent) ? 'pl-24 pr-4' : 'pl-4 pr-36'}`}>
        <BackendMenu />
        <button aria-label="Home" onClick={() => setView({ name: 'home' })}
          className={`no-drag glass glass-hover grid size-11 place-items-center rounded-full ${view.name === 'home' ? 'text-accent' : 'text-white/85 hover:text-white'}`}><House size={21} /></button>
        <SearchBox query={query} setQuery={setQuery} onSubmit={(q) => { setSubmitted(q); setView({ name: 'search' }) }} />
        <PartyButton />
        <AccountBadge />
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3 px-2">
        <LibraryPanel view={view} go={setView} />
        <main className="glass relative min-w-0 flex-1 overflow-hidden rounded-[30px]">
          {/* header glow lives behind the scroller so it spans the full width (under the scrollbar) and fades out smoothly */}
          {(view.name === 'playlist' || view.name === 'artist') &&
            <div aria-hidden className="hdr-glow pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-brand/55 via-brand/20 to-transparent" />}
          <div className="relative h-full overflow-y-auto p-6">
          {view.name === 'home' && (<>
            <h1 className="mb-5 text-[32px] font-bold tracking-tight">{greeting()}</h1>
            <HomeStats />
            <ShelfView method="home" args={undefined} onOpen={open} />
          </>)}
          {view.name === 'search' && (submitted
            ? <ShelfView method="search" args={{ query: submitted }} onOpen={open} empty={`No results for “${submitted}”.`} />
            : <p className="text-mute">Type something above and press Enter.</p>)}
          {view.name === 'artist' && <ArtistView key={view.browseId ?? view.artistName} browseId={view.browseId} name={view.artistName} onOpen={open} />}
          {view.name === 'playlist' && <PlaylistView key={view.browseId} view={view} onOpen={open} />}
          </div>
        </main>
        {showLyrics && <LyricsPanel />}
      </div>
      <PlayerBar />
      <SongMenuHost />
    </div>
  )
}
