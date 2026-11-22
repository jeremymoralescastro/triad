import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff as HideIcon, Folder, Heart, Pencil, Plus, Sparkles, Trash2, Volume2 } from 'lucide-react'
import { smartSongs } from '@/lib/smartPlaylist'
import { hueShift } from '@/lib/hue'
import { usePlayer } from '@/lib/store'
import { useRpc } from '@/lib/useRpc'
import { openTarget, type View } from '@/lib/view'
import type { Item } from '@shared/types'
import { Thumb } from './Thumb'

type Entry = { key: string; title: string; subtitle: string; thumbnail?: string; liked?: boolean; browseId: string; playlistId?: string; item?: Item }

const LIKED: Entry = { key: 'LM', title: 'Liked Music', subtitle: 'Auto playlist', liked: true, browseId: 'LM', playlistId: 'LM' }
const ORDER_KEY = 'triad:library-order'
const readOrder = (): string[] => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') } catch { return [] } }
const pid = (e: Entry) => (e.playlistId ?? e.browseId).replace(/^VL/, '')
const owned = (e: Entry) => /^(PL|sc-pl:local-)/.test(pid(e)) || !!e.item?.owned      // real playlists can be renamed/deleted; Liked Music and auto-mixes can't

export function LibraryPanel({ view, go }: { view: View; go: (v: View) => void }) {
  const [nonce, setNonce] = useState(0)                      // bump → library reloads from YouTube Music
  const signedIn = usePlayer((s) => s.loggedIn)
  const lib = useRpc('library', undefined, true, nonce + (signedIn ? 1000 : 0))      // reloads by itself the moment sign-in is recognized
  const list = usePlayer((s) => s.playlistId)
  const backend = usePlayer((s) => s.backend)
  const paused = usePlayer((s) => s.paused)

  /* ---- local overlays on top of what YouTube Music returns (its library list lags behind edits) ---- */
  const [extra, setExtra] = useState<Entry[]>([])            // just-created playlists
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  const [order, setOrder] = useState<string[]>(readOrder)
  const [fresh, setFresh] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote((n) => (n === m ? null : n)), 5000) }
  const refreshSoon = () => [1500, 5000, 12000].forEach((ms) => setTimeout(() => setNonce((x) => x + 1), ms))
  useEffect(() => { const h = () => setTimeout(() => setNonce((x) => x + 1), 300); window.addEventListener('triad:likes', h); return () => window.removeEventListener('triad:likes', h) }, [])

  const base = useMemo<Entry[]>(() => {
    const seen = new Set<string>(['LM'])
    const rest = (lib.data ?? []).flatMap((s) => s.items).filter((i) => i.browseId && i.title && i.title !== 'Liked Music' && !seen.has(i.browseId) && seen.add(i.browseId))
      .map((i): Entry => ({ key: i.browseId!, title: i.title, subtitle: i.subtitle, thumbnail: i.thumbnail, browseId: i.browseId!, playlistId: i.playlistId, item: i }))
    const plain = (k: string) => k.replace(/^VL(?=sc-)/, '')
    const mine = extra.filter((e) => !seen.has(e.key) && !seen.has(plain(e.key)))
    return [LIKED, ...mine, ...rest]
      .filter((e) => !hidden.has(e.key))
      .map((e) => (names[e.key] ? { ...e, title: names[e.key] } : e))
  }, [lib.data, extra, hidden, names])

  // user-chosen order (right-click → move). Playlists not in the saved order (new ones) go on top.
  const sorted = useMemo(() => {
    if (!order.length) return base
    const idx = new Map<string, number>(order.map((k, i) => [k, i] as [string, number]))
    return [...base.filter((e) => !idx.has(e.key)), ...base.filter((e) => idx.has(e.key)).sort((a, b) => idx.get(a.key)! - idx.get(b.key)!)]
  }, [base, order])

  /* ---- "Hidden" folder: playlists you tuck away. Local to Triad only: nothing changes on YouTube Music / SoundCloud. ---- */
  const HID_KEY = `triad:hidden-lib:${backend}`
  const [stashed, setStashed] = useState<Set<string>>(() => { try { return new Set<string>(JSON.parse(localStorage.getItem(HID_KEY) || '[]')) } catch { return new Set<string>() } })
  const [folderOpen, setFolderOpen] = useState(false)
  const stash = (key: string, on: boolean) => setStashed((cur) => {
    const n = new Set(cur); on ? n.add(key) : n.delete(key)
    try { localStorage.setItem(HID_KEY, JSON.stringify([...n])) } catch { /* ignore */ }
    return n
  })
  const hiddenList = sorted.filter((e) => stashed.has(e.key))
  const shown = sorted.filter((e) => !stashed.has(e.key))

  const isPlayingEntry = (e: Entry) => !!list && (e.playlistId === list || e.browseId.replace(/^VL/, '') === list)
  const playing = shown.find(isPlayingEntry)
  const ordered = playing ? [playing, ...shown.filter((e) => e !== playing)] : shown   // playing playlist goes to the top

  /* ---- FLIP: rows slide to their new spot; the playing one lifts and is dragged to the top ---- */
  const listRef = useRef<HTMLDivElement>(null)
  const prevTops = useRef(new Map<string, number>())
  const prevPlaying = useRef<string | null>(null)
  const orderKey = ordered.map((e) => e.key).join('|')

  useLayoutEffect(() => {
    const root = listRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'))
    const tops = new Map(nodes.map((n) => [n.dataset.flip!, n.offsetTop]))
    const playingKey = playing?.key ?? null
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!reduce && prevTops.current.size) {
      const newlyPlaying = playingKey !== null && playingKey !== prevPlaying.current
      if (newlyPlaying) root.parentElement?.scrollTo({ top: 0 })
      for (const n of nodes) {
        const k = n.dataset.flip!
        const was = prevTops.current.get(k), now = tops.get(k)!
        if (was === undefined || was === now) continue
        const dy = was - now
        if (newlyPlaying && k === playingKey) {
          n.animate([
            { transform: `translateY(${dy}px) scale(1.04)`, boxShadow: '0 14px 34px rgba(0,0,0,.6)', backgroundColor: hueShift('rgba(76,141,255,.22)') },
            { transform: 'translateY(0) scale(1)', boxShadow: '0 0 0 rgba(0,0,0,0)', backgroundColor: hueShift('rgba(76,141,255,0)') }
          ], { duration: 750, easing: 'cubic-bezier(.2,.8,.2,1)' })
        } else {
          n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' })
        }
      }
    }
    prevTops.current = tops
    prevPlaying.current = playingKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey])

  /* ---- new playlist ---- */
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (naming) { const t = setTimeout(() => nameInput.current?.focus(), 220); return () => clearTimeout(t) } }, [naming])

  /** put a just-made playlist into the list, mark it fresh and open it */
  const finish = (r: { playlistId: string; title: string; count: number }, note: string) => {
    const key = r.playlistId.startsWith('sc-') ? r.playlistId : 'VL' + r.playlistId   // same id the library list will use, so it's never listed twice
    const item: Item = { kind: 'playlist', title: r.title, subtitle: `${r.count} songs`, browseId: key, playlistId: r.playlistId, owned: true }
    setExtra((x) => [{ key, title: r.title, subtitle: `${r.count} songs · ${note}`, browseId: key, playlistId: r.playlistId, item }, ...x])   // show it right away
    setFresh(key); setNaming(false); setName(''); refreshSoon()
    go({ name: 'playlist', browseId: key, title: r.title, subtitle: `${r.count} songs · ${note}`, playlistId: r.playlistId })
  }
  const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')

  const create = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await window.ytm.rpc('createPlaylist', { name: n })
      finish(r, 'made with Triad')
    } catch (e) { setMsg(errText(e)) }
    finally { setBusy(false) }
  }

  /* ---- AI playlist: describe it, Claude picks the songs, we find each one and fill a real playlist ---- */
  const [ai, setAi] = useState(false)
  const [desc, setDesc] = useState('')
  const [count, setCount] = useState(20)
  const [progress, setProgress] = useState<string | null>(null)
  const [provider, setProvider] = useState<{ provider: 'claude' | 'ollama' | 'none'; model?: string }>({ provider: 'none' })
  useEffect(() => { if (naming && ai) window.ytm.aiStatus().then(setProvider).catch(() => {}) }, [naming, ai])

  const findSong = async (s: { title: string; artist: string }): Promise<string | null> => {
    const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    try {
      const shelves = await window.ytm.rpc('search', { query: `${s.title} ${s.artist}` })
      const songs = shelves.flatMap((sh) => sh.items).filter((it) => it.kind === 'song' && it.videoId)
      const first = flat(s.artist).split(' ')[0]
      const hit = songs.find((it) => first && flat(`${it.subtitle} ${it.artist ?? ''}`).includes(first)) ?? songs[0]   // prefer the right artist
      return hit?.videoId ?? null
    } catch { return null }
  }
  const generate = async () => {
    const d = desc.trim()
    if (!d || busy) return
    setBusy(true); setMsg(null)
    let note: string | null = null, usedAi = false
    try {
      let ids: string[] = [], name = ''
      if (provider.provider !== 'none') {
        try {
          setProgress(provider.provider === 'ollama' ? 'Asking your local AI… (the first time can take a minute)' : 'Thinking up songs…')
          const plan = await window.ytm.aiSuggest(d, count)
          const results: (string | null)[] = new Array(plan.songs.length).fill(null)
          let next = 0, done = 0
          const worker = async () => {
            for (;;) {
              const i = next++
              if (i >= plan.songs.length) return
              results[i] = await findSong(plan.songs[i])
              setProgress(`Finding songs… ${++done}/${plan.songs.length}`)
            }
          }
          await Promise.all([worker(), worker(), worker(), worker()])
          ids = [...new Set(results.filter((x): x is string => !!x))]
          name = plan.name; usedAi = ids.length > 0
        } catch (e) { note = errText(e) }
      }
      if (!ids.length) {                                  // no AI set up, or it failed: build it from searches instead
        setProgress('Searching…')
        const r = await smartSongs(d, count)
        ids = r.ids; name = r.name
        if (provider.provider !== 'none' && note) note = `The AI didn’t work (${note}), so Triad used smart search instead.`
        else note = null
      }
      if (!ids.length) throw new Error('Couldn’t find songs for that. Try describing it differently.')
      setProgress('Creating the playlist…')
      const r = await window.ytm.rpc('createPlaylist', { name: name || d.slice(0, 50) })
      await window.ytm.rpc('addToPlaylist', { playlistId: r.playlistId, videoId: ids[0], videoIds: ids })
      finish({ ...r, count: ids.length }, usedAi ? 'made by AI' : 'made with Triad')
      setDesc('')
      if (note) setMsg(note)
    } catch (e) { setMsg(errText(e)) }
    finally { setBusy(false); setProgress(null) }
  }

  /* ---- right-click menu: rename / delete / move ---- */
  const [menu, setMenu] = useState<{ key: string; x: number; y: number; confirm: boolean } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key); window.addEventListener('blur', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); window.removeEventListener('blur', close) }
  }, [menu])

  const move = (key: string, dir: -1 | 1) => {
    const keys = ordered.map((e) => e.key), i = keys.indexOf(key), j = i + dir
    if (i < 0 || j < 0 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    setOrder(keys)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)) } catch { /* ignore */ }
  }
  const doRename = async (e: Entry, value: string) => {
    const n = value.trim()
    setRenaming(null)
    if (!n || n === e.title) return
    setNames((m) => ({ ...m, [e.key]: n }))
    try { await window.ytm.rpc('renamePlaylist', { playlistId: pid(e), name: n }); refreshSoon() }
    catch { setNames((m) => { const c = { ...m }; delete c[e.key]; return c }); flash('Couldn’t rename it — only playlists you made can be renamed.') }
  }
  const doDelete = async (e: Entry) => {
    setMenu(null)
    try {
      await window.ytm.rpc('deletePlaylist', { playlistId: pid(e) })
      setHidden((h) => new Set(h).add(e.key)); refreshSoon()
      if (view.name === 'playlist' && view.browseId === e.browseId) go({ name: 'home' })
    } catch { flash(`Couldn’t delete “${e.title}”.`) }
  }

  const active = (id: string) => view.name === 'playlist' && view.browseId === id
  const open = (e: Entry) =>
    e.liked ? go({ name: 'playlist', browseId: 'LM', title: 'Liked Music', subtitle: 'Auto playlist', playlistId: 'LM' })
      : e.item && openTarget(e.item) && go(openTarget(e.item)!)

  /** Menu lives at the top level (a glass panel clips fixed children) and is kept fully inside the window. */
  const placeMenu = (el: HTMLDivElement | null) => {
    if (!el || !menu) return
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8))}px`
    el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8))}px`
  }
  const menuEntry = menu ? [...ordered, ...hiddenList].find((e) => e.key === menu.key) : null
  const menuIdx = menuEntry ? ordered.indexOf(menuEntry) : -1

  const renderRow = (e: Entry) => {
            const on = isPlayingEntry(e)
    return (
      <div key={e.key} data-flip={e.key} role="button" tabIndex={0} onClick={() => renaming !== e.key && open(e)}
        onKeyDown={(ev) => ev.key === 'Enter' && renaming !== e.key && open(e)}
        onContextMenu={(ev) => { ev.preventDefault(); setMenu({ key: e.key, x: ev.clientX, y: ev.clientY, confirm: false }) }}
        aria-label={on ? `${e.title}, now playing` : undefined}
        className={`relative flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left hover:bg-hover ${active(e.browseId) ? 'bg-hover' : ''} ${fresh === e.key ? 'row-in' : ''}`}>
        <span className="relative size-14 shrink-0">
          <span className="grid size-full place-items-center overflow-hidden rounded-md bg-hover">
            {e.liked ? <span className="grid size-full place-items-center bg-gradient-to-br from-accent to-brand"><Heart size={22} fill="white" /></span>
              : <Thumb src={e.thumbnail} />}
          </span>
          {on && (
            <span className={`absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full ring-2 ring-white/50 ${paused ? 'bg-[#3a3a3a] text-white' : 'blue-glass'}`}>
              <Volume2 size={13} strokeWidth={2.6} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          {renaming === e.key ? (
            <input autoFocus value={renameVal} onChange={(ev) => setRenameVal(ev.target.value)} maxLength={100}
              onClick={(ev) => ev.stopPropagation()} onBlur={() => doRename(e, renameVal)}
              onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') doRename(e, renameVal); if (ev.key === 'Escape') setRenaming(null) }}
              className="h-8 w-full rounded-full bg-hover px-3 text-[14px] font-semibold outline-none ring-2 ring-accent" />
          ) : (
            <span className={`block truncate text-[15px] font-semibold ${on ? 'text-accent' : ''}`}>{e.title}</span>
          )}
          <span className="block truncate text-[13px] text-mute">{e.subtitle}</span>
        </span>
      </div>
    )
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col glass overflow-hidden rounded-[30px]" aria-label="Your library">
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="text-[15px] font-semibold text-mute">Your Library</h2>
        <button onClick={() => { setNaming((n) => !n); setMsg(null) }} aria-expanded={naming}
          className="flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[.06] pl-2 pr-3 text-[12px] font-medium text-white/65 transition-colors hover:border-white/20 hover:bg-white/[.12] hover:text-white">
          <Plus size={14} strokeWidth={2.4} className={`transition-transform duration-300 ${naming ? 'rotate-45' : ''}`} />New playlist
        </button>
      </div>

      {/* slides open/closed */}
      <div className={`grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-out ${naming ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        aria-hidden={!naming}>
        <div className="overflow-hidden">
          <form className="px-4 pb-3 pt-1" onSubmit={(e) => { e.preventDefault(); ai ? generate() : create() }}>
            <div className="mb-2 flex gap-1 rounded-full bg-white/[.06] p-1 text-[12px] font-medium" role="tablist">
              <button type="button" role="tab" aria-selected={!ai} tabIndex={naming ? 0 : -1} disabled={busy} onClick={() => { setAi(false); setMsg(null) }}
                className={`h-7 flex-1 rounded-full transition-colors ${!ai ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}>Name it</button>
              <button type="button" role="tab" aria-selected={ai} tabIndex={naming ? 0 : -1} disabled={busy} onClick={() => { setAi(true); setMsg(null) }}
                className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-full transition-colors ${ai ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'}`}><Sparkles size={12} />Describe it</button>
            </div>
            {!ai ? (<>
              <input ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={busy} tabIndex={naming ? 0 : -1}
                placeholder="Name it, e.g. “late night drive”"
                className="h-10 w-full rounded-full bg-hover px-4 text-[14px] outline-none placeholder:text-mute focus:ring-2 focus:ring-accent" />
              <div className="mt-2 flex items-center gap-2">
                <button type="submit" disabled={!name.trim() || busy} tabIndex={naming ? 0 : -1}
                  className="h-8 rounded-full blue-glass px-4 text-[13px] font-semibold transition-opacity disabled:opacity-40">
                  {busy ? 'Creating…' : 'Create'}
                </button>
                <button type="button" tabIndex={naming ? 0 : -1} onClick={() => setNaming(false)} className="text-[13px] text-mute hover:text-white">Cancel</button>
              </div>
              <p className="mt-2 text-[12px] leading-snug text-mute">Starts empty — add songs from the suggestions on its page.</p>
            </>) : (<>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={3} disabled={busy} tabIndex={naming ? 0 : -1}
                placeholder="Describe it, e.g. “moody late-night drive, synthwave and 80s-style pop”"
                className="w-full resize-none rounded-[20px] bg-hover px-4 py-3 text-[14px] leading-snug outline-none placeholder:text-mute focus:ring-2 focus:ring-accent" />
              <div className="mt-2 flex items-center gap-2">
                <button type="submit" disabled={!desc.trim() || busy} tabIndex={naming ? 0 : -1}
                  className="h-8 rounded-full blue-glass px-4 text-[13px] font-semibold transition-opacity disabled:opacity-40">
                  {busy ? 'Working…' : 'Generate'}
                </button>
                <select value={count} onChange={(e) => setCount(+e.target.value)} disabled={busy} tabIndex={naming ? 0 : -1} aria-label="Number of songs"
                  className="h-8 rounded-full bg-white/10 px-2 text-[13px] outline-none">
                  {[10, 20, 30, 50].map((n) => <option key={n} value={n} className="bg-[#1b1b1f]">{n} songs</option>)}
                </select>
                <button type="button" tabIndex={naming ? 0 : -1} onClick={() => setNaming(false)} className="text-[13px] text-mute hover:text-white">Cancel</button>
              </div>
              {progress && <p className="mt-2 text-[12px] leading-snug text-white/70">{progress}</p>}
              {!progress && <p className="mt-2 text-[12px] leading-snug text-mute">
                {provider.provider === 'claude' ? 'Using your Anthropic key. ' : provider.provider === 'ollama' ? `Using your local AI (${provider.model}). ` : 'No AI set up, so Triad builds it from searches (Settings → AI playlists to add one). '}
                Makes a real playlist on {backend === 'sc' ? 'SoundCloud' : 'YouTube Music'}.</p>}
            </>)}
            {msg && <p className="mt-1 text-[12px] leading-snug text-[#e69a9a]">{msg}</p>}
          </form>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div ref={listRef} className="relative">
          {ordered.map(renderRow)}
        </div>
        {hiddenList.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setFolderOpen((o) => !o)} aria-expanded={folderOpen}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] font-semibold text-mute transition-colors hover:bg-hover hover:text-white">
              <Folder size={16} /> Hidden <span className="font-normal">({hiddenList.length})</span>
              <ChevronRight size={15} className={`ml-auto transition-transform duration-300 ${folderOpen ? 'rotate-90' : ''}`} />
            </button>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${folderOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} aria-hidden={!folderOpen}>
              <div className="overflow-hidden">{folderOpen && hiddenList.map(renderRow)}</div>
            </div>
          </div>
        )}
        {lib.loading && !lib.data && <p className="px-3 py-2 text-[13px] text-mute">Loading…</p>}
      </div>
      {note && <p className="mx-3 mb-3 rounded-xl bg-black/40 px-3 py-2 text-[12px] leading-snug text-white/80">{note}</p>}

      {menu && menuEntry && createPortal(
        <div role="menu" onMouseDown={(ev) => ev.stopPropagation()} ref={placeMenu}
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 300 }}
          className="menu-pop w-52 rounded-2xl p-1.5 text-[14px]">
          {menu.confirm ? (
            <div className="p-2">
              <p className="mb-2 leading-snug text-white/85">Delete “{menuEntry.title}”?</p>
              <div className="flex gap-2">
                <button onClick={() => doDelete(menuEntry)} className="h-8 flex-1 rounded-full bg-[rgba(214,110,110,.25)] font-semibold text-[#f0aaaa] hover:bg-[rgba(214,110,110,.38)]">Delete</button>
                <button onClick={() => setMenu(null)} className="h-8 flex-1 rounded-full bg-white/10 hover:bg-white/15">Cancel</button>
              </div>
            </div>
          ) : (<>
            {stashed.has(menuEntry.key)
              ? <MenuItem icon={<Eye size={15} />} label="Unhide" onClick={() => { stash(menuEntry.key, false); setMenu(null) }} />
              : (<>
            {owned(menuEntry) && <MenuItem icon={<Pencil size={15} />} label="Rename" onClick={() => { setRenameVal(menuEntry.title); setRenaming(menuEntry.key); setMenu(null) }} />}
            <MenuItem icon={<ArrowUp size={15} />} label="Move up" disabled={menuIdx <= 0} onClick={() => { move(menuEntry.key, -1); setMenu(null) }} />
            <MenuItem icon={<ArrowDown size={15} />} label="Move down" disabled={menuIdx >= ordered.length - 1} onClick={() => { move(menuEntry.key, 1); setMenu(null) }} />
            <MenuItem icon={<HideIcon size={15} />} label="Hide" onClick={() => { stash(menuEntry.key, true); setMenu(null) }} />
            {owned(menuEntry) && <MenuItem icon={<Trash2 size={15} />} label="Delete" danger onClick={() => setMenu({ ...menu, confirm: true })} />}
              </>)}
          </>)}
        </div>,
        document.body
      )}
    </aside>
  )
}

function MenuItem({ icon, label, onClick, disabled, danger }: { icon: import('react').ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35 ${danger ? 'text-[#f0aaaa]' : 'text-white/90'}`}>
      {icon}{label}
    </button>
  )
}
