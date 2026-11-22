import { ipcRenderer, webFrame } from 'electron'
import { CH, type Command, type Item, type LikeStatus, type PlayerState, type QueueItem, type RpcMethod, type Shelf } from '@shared/types'
import { applyEq, applyFx, ensureGraph, eqKeepAlive, getFx, restoreEq, setMasterVolume } from './engine/eq'

/**
 * SoundCloud engine. Runs inside a hidden soundcloud.com page (its own login/session). The page is only used for
 * its origin, cookies and the public client id: all browsing goes through SoundCloud's own web API (api-v2) and
 * the sound plays from our own <audio> element, so SoundCloud's player (and its ads) never runs.
 */
if (/(^|\.)soundcloud\.com$/.test(location.hostname) && window.top === window) {
  const API = 'https://api-v2.soundcloud.com'
  const log = (m: string) => ipcRenderer.send(CH.engineLog, `[sc] ${m}`)

  // ---------- auth: client id + (when signed in) the user and OAuth token ----------
  let cid = ''
  let me: { id: number; name: string } | null = null
  let token = ''
  const readCookieToken = () => { const m = document.cookie.match(/(?:^|;\s*)oauth_token=([^;]+)/); return m ? decodeURIComponent(m[1]) : '' }
  const ready = (async () => {
    // this script runs before the page does: wait until the page's own data (client id, who's signed in) exists
    for (let i = 0; i < 100; i++) {
      const has = await webFrame.executeJavaScript(`!!(window.__sc_hydration && window.__sc_hydration.length)`).catch(() => false)
      if (has) break
      if (i === 40) { log('no page data in light mode: loading the full SoundCloud page instead'); ipcRenderer.send(CH.scFull) }   // safety net
      await new Promise((r) => setTimeout(r, 100))
    }
    try {
      const raw = await webFrame.executeJavaScript(`(() => { const h = window.__sc_hydration || []; const f = (n) => (h.find((x) => x.hydratable === n) || {}).data;
        return JSON.stringify({ cid: (f('apiClient') || {}).id || '', user: f('user') || null }) })()`)
      const j = JSON.parse(raw as string)
      cid = j.cid || ''
      if (j.user?.id) me = { id: j.user.id, name: j.user.full_name || j.user.username || '' }
    } catch (e) { log('hydration read failed ' + e) }
    token = readCookieToken()
    if (!cid) cid = await scrapeClientId()
    log(`ready: client_id ${cid ? 'ok' : 'MISSING'}, ${me ? 'signed in' : 'signed out'}${token ? ', token' : ''}`)
  })()
  // signing in inside the page doesn't reload it: notice the new session (the token cookie) and pick up who you are
  setInterval(async () => {
    if (me) return
    const t = readCookieToken(); if (!t) return
    token = t
    try { const u = await api('/me'); if (u?.id) { me = { id: u.id, name: u.full_name || u.username || '' }; log('signed in as ' + me.name) } } catch { /* not yet */ }
  }, 500)
  async function scrapeClientId() {
    try {
      const srcs = [...document.querySelectorAll<HTMLScriptElement>('script[src*="sndcdn.com/assets"]')].map((s) => s.src).reverse()
      for (const s of srcs) { const t = await (await fetch(s)).text(); const m = t.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/); if (m) return m[1] }
    } catch { /* ignore */ }
    return ''
  }

  /** GETs are remembered for 45 s (and identical ones in flight are shared); anything that changes data forgets them all */
  const getCache = new Map<string, { at: number; p: Promise<any> }>()
  function api(path: string, o: { method?: string; params?: Record<string, string | number>; body?: unknown; noAuth?: boolean } = {}, retry = true): Promise<any> {
    if ((o.method ?? 'GET') !== 'GET') { getCache.clear(); return apiRaw(path, o, retry) }
    if (path.includes('/media/') || !retry) return apiRaw(path, o, retry)          // stream links are one-off
    const key = path + JSON.stringify(o.params ?? {}) + (o.noAuth ? 'n' : '')
    const hit = getCache.get(key)
    if (hit && Date.now() - hit.at < 45_000) return hit.p
    const p = apiRaw(path, o, retry)
    getCache.set(key, { at: Date.now(), p }); p.catch(() => getCache.delete(key))
    return p
  }
  async function apiRaw(path: string, o: { method?: string; params?: Record<string, string | number>; body?: unknown; noAuth?: boolean } = {}, retry = true): Promise<any> {
    await ready
    if (!cid) cid = await scrapeClientId()
    if (!cid) {                                      // the page came up without its client id (e.g. right after a captcha): reload it once
      const last = Number(sessionStorage.getItem('triad:sc-reload') || 0)
      if (Date.now() - last > 30_000) { sessionStorage.setItem('triad:sc-reload', String(Date.now())); location.href = 'https://soundcloud.com/' }
      throw new Error('SoundCloud is still loading — try again in a moment')
    }
    const u = new URL(path.startsWith('http') ? path : API + path)
    u.searchParams.set('client_id', cid)
    for (const [k, v] of Object.entries(o.params ?? {})) u.searchParams.set(k, String(v))
    const headers: Record<string, string> = {}
    if (token && !o.noAuth) headers.Authorization = `OAuth ${token}`
    if (o.body) headers['Content-Type'] = 'application/json'
    const init: RequestInit = { method: o.method ?? 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined }
    // like SoundCloud's own pages, send the site's cookies along (that includes the bot-check clearance a solved captcha leaves behind)
    const r = await fetch(u, { ...init, credentials: 'include' }).catch(() => fetch(u, init))
    if ((r.status === 401 || r.status === 403) && retry && !token) { cid = (await scrapeClientId()) || cid; return apiRaw(path, o, false) }
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      const ch = body.match(/https:\/\/geo\.captcha-delivery\.com[^"\\]+/)?.[0]
      if (ch) throw new Error('SoundCloud’s bot check blocked that request. Open SoundCloud in your browser once, solve any check it shows, then try again here.')
      throw new Error(`SoundCloud ${r.status} on ${u.pathname.slice(0, 60)} ${body.slice(0, 120)}`)
    }
    if (r.status === 204) return null
    return r.json().catch(() => null)
  }
  /** who you are is learned a moment after launch: wait for it (up to 5 s) instead of failing */
  const needLogin = async () => { for (let t = 0; !me && t < 5000; t += 100) await new Promise((r) => setTimeout(r, 100)); if (!me) throw new Error('Sign in to SoundCloud first') }

  // ---------- track helpers ----------
  interface Track { id: number; title?: string; duration?: number; artwork_url?: string | null; permalink_url?: string; user?: { id: number; username: string; avatar_url?: string }
    media?: { transcodings?: { url: string; format: { protocol: string; mime_type: string } }[] }; track_authorization?: string; policy?: string }
  const cache = new Map<number, Track>()
  const art = (t: { artwork_url?: string | null; avatar_url?: string | null; user?: { avatar_url?: string } }) =>
    ((t.artwork_url || t.avatar_url || t.user?.avatar_url || '') as string).replace('-large.', '-t500x500.') || undefined
  const mmss = (ms?: number) => { const s = Math.floor((ms ?? 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
  const full = (t?: Track): boolean => !!t && !!t.title
  const remember = (t: Track) => { if (full(t)) cache.set(t.id, t); return t }
  const trackItem = (t: Track, setVideoId = false): Item => ({
    kind: 'song', title: t.title ?? '', subtitle: t.user?.username ?? '', thumbnail: art(t), videoId: String(t.id), artist: t.user?.username ?? '',
    artists: t.user ? [{ name: t.user.username, browseId: `sc-u:${t.user.id}` }] : undefined, duration: mmss(t.duration), ...(setVideoId ? { setVideoId: String(t.id) } : {})
  })
  const queueItem = (t: Track): QueueItem => ({ videoId: String(t.id), title: t.title ?? '', artist: t.user?.username ?? '', thumbnail: art(t) })
  /** fill in tracks that came back as bare {id} stubs */
  async function hydrate(list: Track[]): Promise<Track[]> {
    const need = list.filter((t) => !full(cache.get(t.id)) && !full(t)).map((t) => t.id)
    list.forEach((t) => full(t) && remember(t))
    const chunks: number[][] = []
    for (let i = 0; i < need.length; i += 50) chunks.push(need.slice(i, i + 50))
    let next = 0
    await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, async () => {       // 6 requests at a time
      while (next < chunks.length) {
        const c = chunks[next++]
        const got: Track[] = await api('/tracks', { params: { ids: c.join(',') } }).catch(() => [])
        got.forEach(remember)
      }
    }))
    return list.map((t) => cache.get(t.id) ?? t).filter((t) => full(t))
  }
  async function getTrack(id: number | string): Promise<Track> {
    const n = Number(id), c = cache.get(n); if (c) return c
    return remember(await api(`/tracks/${n}`))
  }
  /** anything SoundCloud returns that's a track / playlist / user, as a card */
  function cardItem(x: any): Item | null {
    if (!x) return null
    const k: string = x.kind ?? x.type ?? ''
    if (k === 'track' || (x.media && x.title)) return trackItem(remember(x))
    if (k === 'user') return { kind: 'artist', title: x.username, subtitle: `${(x.followers_count ?? 0).toLocaleString()} followers`, thumbnail: art(x), browseId: `sc-u:${x.id}` }
    if (k.includes('playlist') || x.track_count !== undefined || x.tracks) {
      const sys = typeof x.urn === 'string' && x.urn.includes('system-playlists')
      const id = sys ? `sc-sys:${x.urn}` : `sc-pl:${x.id}`
      const first = (x.tracks ?? []).find((t: Track) => art(t))
      return { kind: x.is_album ? 'album' : 'playlist', title: x.title, subtitle: x.user?.username ?? x.short_description ?? (x.track_count ? `${x.track_count} songs` : 'Playlist'),
        thumbnail: art(x) ?? (first && art(first)), browseId: id, playlistId: id, owned: !sys && !!me && x.user?.id === me.id }
    }
    return null
  }
  const items = (arr: any[]) => arr.map((x) => cardItem(x.track ?? x.playlist ?? x)).filter((i): i is Item => !!i)
  const shelf = (title: string, its: Item[]): Shelf | null => (its.length ? { title, items: its } : null)
  const only = (a: (Shelf | null)[]) => a.filter((s): s is Shelf => !!s)

  // ---------- lists (a playlist / likes / a user's tracks) ----------
  const norm = (id: string) => id.replace(/^VL(?=sc-)/, '')
  // SoundCloud's bot protection refuses playlist writes from apps, so playlists you make in Triad are kept on this computer
  type Local = { id: string; title: string; ids: number[] }
  const LS = 'triad:sc-playlists'
  const lsGet = (): Local[] => { try { return JSON.parse(localStorage.getItem(LS) || '[]') } catch { return [] } }
  const lsSet = (a: Local[]) => { try { localStorage.setItem(LS, JSON.stringify(a)) } catch { /* ignore */ } }
  const isLocal = (id: string) => norm(id).startsWith('sc-pl:local-')
  const localOf = (id: string) => lsGet().find((x) => x.id === norm(id).slice(6))
  const editLocal = (id: string, f: (p: Local) => void) => { const all = lsGet(), p = all.find((x) => x.id === norm(id).slice(6)); if (p) { f(p); lsSet(all) } }
  async function pages(path: string, params: Record<string, string | number>, max = 4): Promise<any[]> {
    const out: any[] = []; let next: string | undefined
    for (let i = 0; i < max; i++) {
      const r: any = next ? await api(next, { params: {} }) : await api(path, { params: { ...params, linked_partitioning: 1 } })
      out.push(...(r?.collection ?? [])); next = r?.next_href; if (!next) break
    }
    return out
  }
  /** a list just opened is remembered for a minute, so reopening it (or playing it) is instant; any edit forgets it */
  const listCache = new Map<string, { at: number; tracks: Track[] }>()
  async function listTracks(listId: string): Promise<Track[]> {
    const id = norm(listId), hit = listCache.get(id)
    if (hit && Date.now() - hit.at < 60_000) return hit.tracks
    const tracks = await listTracksRaw(id)
    listCache.set(id, { at: Date.now(), tracks })
    return tracks
  }
  async function listTracksRaw(listId: string): Promise<Track[]> {
    const id = norm(listId)
    if (id === 'LM') { await needLogin(); return hydrate((await pages(`/users/${me!.id}/track_likes`, { limit: 200 }, 12)).map((x) => x.track ?? x).filter(Boolean)) }
    if (isLocal(id)) return hydrate((localOf(id)?.ids ?? []).map((i) => ({ id: i }) as Track))
    if (id.startsWith('sc-pl:')) { const p = await api(`/playlists/${id.slice(6)}`); return hydrate(p?.tracks ?? []) }
    if (id.startsWith('sc-sys:')) { const p = await api(`/system-playlists/${encodeURIComponent(id.slice(7))}`); return hydrate(p?.tracks ?? []) }
    if (id.startsWith('sc-u:')) return hydrate(await pages(`/users/${id.slice(5)}/tracks`, { limit: 50 }, 2))
    if (id.startsWith('sc-t:')) { const t = await getTrack(id.slice(5)); return [t, ...(await related(t.id))] }
    return []
  }
  async function related(id: number): Promise<Track[]> {
    try { const r = await api(`/tracks/${id}/related`, { params: { limit: 25 } }); return hydrate(r?.collection ?? []) } catch { return [] }
  }
  async function playlistIds(pid: string): Promise<number[]> {
    if (isLocal(pid)) return [...(localOf(pid)?.ids ?? [])]
    const p = await api(`/playlists/${norm(pid).slice(6)}`)
    return (p?.tracks ?? []).map((t: Track) => t.id)
  }
  const putTracks = (pid: string, ids: number[]) => (listCache.delete(norm(pid)), isLocal(pid)) ? Promise.resolve(editLocal(pid, (p) => { p.ids = ids })) : api(`/playlists/${norm(pid).slice(6)}`, { method: 'PUT', body: { playlist: { tracks: ids } } })

  // ---------- the player ----------
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'
  audio.setAttribute('data-triad', 'sc')
  ;(audio as any).preservesPitch = false
  audio.volume = 1                  // the element stays at 100% for good; Triad's volume bar only sets the level inside Triad's own audio chain
  let level = 0.35
  const setLevel = (v: number) => { level = Math.max(0, Math.min(1, v)); setMasterVolume(level); if (level < 1) ensureGraph(); audio.volume = 1; audio.dispatchEvent(new Event('volumechange')) }
  document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(audio); setLevel(level) })
  let cur: Track | null = null
  let ctx: Track[] = []           // the list being played (a playlist, likes, a song + its radio …)
  let ctxId: string | null = null
  let idx = -1
  let userQ: QueueItem[] = []
  const hist: Track[] = []
  let repeat: PlayerState['repeat'] = 'NONE'
  let shuffle = false
  let speed = 1
  let seq = 0
  let blobUrl = ''
  let radioFor = 0
  let baseLen = 0                  // how many entries of ctx are the playlist itself (the rest is radio)
  let played = new Set<number>()   // shuffle: what's been heard this round
  const liked = new Set<number>()
  let likesP: Promise<void> | null = null

  function loadLikes(): Promise<void> {
    if (!me) return Promise.resolve()
    return likesP ??= (async () => {
      try { const r = await api('/me/track_likes/ids', { params: { limit: 5000 } }); for (const x of (Array.isArray(r) ? r : r?.collection ?? [])) liked.add(Number(x?.id ?? x)) } catch (e) { log('likes: ' + e); likesP = null }
    })()
  }

  /**
   * Everything needed to start a track, found ahead of time: the direct mp3 link, or (for HLS) the segment list with the first
   * segment already downloading. Looked up for the NEXT song while the current one plays, so switching is nearly instant.
   */
  type Info = { key: string; progressive?: string; hls?: { mime: string; segs: string[]; first: Promise<ArrayBuffer> } }
  const getSeg = (u: string) => fetch(u).then((r) => { if (!r.ok) throw new Error(`segment ${r.status}`); return r.arrayBuffer() })
  const infoCache = new Map<number, { at: number; p: Promise<Info> }>()
  function getInfo(t: Track, skip: string[], fresh = false): Promise<Info> {
    const hit = infoCache.get(t.id)
    if (!skip.length && hit && Date.now() - hit.at < 150_000) return hit.p
    const p = findInfo(t, skip, fresh)
    if (!skip.length) { infoCache.set(t.id, { at: Date.now(), p }); p.catch(() => infoCache.delete(t.id)) }
    if (infoCache.size > 12) infoCache.delete(infoCache.keys().next().value as number)
    return p
  }
  async function findInfo(t: Track, skip: string[], fresh: boolean): Promise<Info> {
    const tr = [...(t.media?.transcodings ?? [])]
    const rank = (x: (typeof tr)[number]) => (x.format.protocol === 'progressive' ? 0 : x.format.protocol === 'hls' ? (/mpeg/.test(x.format.mime_type) ? 1 : 2) : 9)   // encrypted variants last: they can't be played here
    tr.sort((x, y) => rank(x) - rank(y))
    const errs: string[] = []
    if (tr.length && !tr.some((x) => x.format.protocol === 'progressive' || x.format.protocol === 'hls')) throw new Error('DRM')    // only copy-protected streams
    for (const pick of tr) {
      if (pick.format.protocol !== 'progressive' && pick.format.protocol !== 'hls') continue      // encrypted variants can't be played here
      const key = `${pick.format.protocol}|${pick.format.mime_type}`
      if (skip.includes(key)) continue
      for (const noAuth of [false, true]) {
        try {
          const params: Record<string, string> = {}
          if (t.track_authorization) params.track_authorization = t.track_authorization
          const j = await api(pick.url, { params, noAuth })
          if (!j?.url) throw new Error('no stream url')
          if (pick.format.protocol === 'progressive') return { key, progressive: j.url as string }
          const mr = await fetch(j.url); if (!mr.ok) throw new Error(`playlist ${mr.status}`)
          const base = new URL(j.url)
          const lines = (await mr.text()).split('\n').map((l) => l.trim())
          const init = lines.find((l) => l.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1]
          const segs = [...(init ? [init] : []), ...lines.filter((l) => l && !l.startsWith('#'))].map((l) => new URL(l, base).toString())
          const first = getSeg(segs[0]); first.catch(() => {})
          return { key, hls: { mime: pick.format.mime_type, segs, first } }
        } catch (e) { errs.push(`${pick.format.protocol}/${pick.format.mime_type}${noAuth ? ' (no auth)' : ''}: ${e}`) }
      }
    }
    if (!fresh) {                                   // stale data? ask for the track again (fresh stream links) and retry once
      const again = remember(await api(`/tracks/${t.id}`))
      if (again?.media) return findInfo(again, skip, true)
    }
    throw new Error(errs.length ? errs.join(' | ') : `no transcodings (policy ${t.policy ?? '?'})`)
  }
  /** turn the info into something the <audio> element can play */
  async function attach(t: Track, info: Info): Promise<{ url: string; key: string }> {
    if (info.progressive) return { url: info.progressive, key: info.key }
    const { mime, segs, first } = info.hls!
    if (!/mpeg/.test(mime) && 'MediaSource' in window && MediaSource.isTypeSupported(mime)) {      // AAC/Opus segments: stream them through Media Source
      const ms = new MediaSource(), url = URL.createObjectURL(ms)
      ms.addEventListener('sourceopen', async () => {
        try {
          const sb = ms.addSourceBuffer(mime)
          if (t.duration) ms.duration = t.duration / 1000
          const ahead: (Promise<ArrayBuffer> | null)[] = segs.map((u, i) => (i === 0 ? first : i < 5 ? getSeg(u) : null))
          for (let i = 0; i < segs.length; i++) {
            const buf = await ahead[i]!
            if (i + 5 < segs.length && ahead[i + 5] === null) ahead[i + 5] = getSeg(segs[i + 5])
            await new Promise<void>((res, rej) => { sb.addEventListener('updateend', () => res(), { once: true }); sb.addEventListener('error', () => rej(new Error('append failed')), { once: true }); sb.appendBuffer(buf) })
          }
          if (ms.readyState === 'open') ms.endOfStream()
        } catch (e) { log('media source: ' + e) }
      }, { once: true })
      return { url, key: info.key }
    }
    const parts: ArrayBuffer[] = new Array(segs.length)
    parts[0] = await first
    for (let i = 1; i < segs.length; i += 8) await Promise.all(segs.slice(i, i + 8).map(async (sg, k) => { parts[i + k] = await getSeg(sg) }))
    return { url: URL.createObjectURL(new Blob(parts, { type: mime.split(';')[0] || 'audio/mpeg' })), key: info.key }
  }
  const resolveStream = async (t: Track, skip: string[]) => attach(t, await getInfo(t, skip))
  /** look up the next song's stream while this one plays */
  async function warmNext() {
    try {
      const q = userQ[0]
      const nt = q ? await getTrack(q.videoId) : shuffle ? null : ctx[idx + 1] ? (await hydrate([ctx[idx + 1]]))[0] : null
      if (nt && nt.id !== cur?.id) void getInfo(nt, []).catch(() => {})
    } catch { /* it's only a head start */ }
  }

  const tried = new Map<number, string[]>()
  let curKey = ''
  let notice = ''
  async function load(t: Track, o: { at?: number; paused?: boolean } = {}) {
    const mine = ++seq
    cur = t
    try {
      const { url, key } = await resolveStream(t, tried.get(t.id) ?? [])
      curKey = key
      log(`playing "${t.title}" via ${key}`)
      if (mine !== seq) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return }
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      blobUrl = url.startsWith('blob:') ? url : ''
      audio.src = url
      audio.playbackRate = speed
      audio.volume = 1
      if (o.at) audio.addEventListener('loadedmetadata', () => { audio.currentTime = o.at! }, { once: true })
      if (!o.paused) await audio.play().catch((e) => { if (e?.name !== 'AbortError') log('play() rejected: ' + e) })
      setMeta(t)
      void loadLikes()
      if (ctx.length - idx < 3) void extendWithRadio(t)
      void warmNext()
    } catch (e) {
      log(`couldn't play "${t.title}": ${e}`)
      if (String(e).includes('DRM')) notice = `${Date.now()}|“${t.title}” is copy-protected on SoundCloud (Go+) and can’t be played here — skipped`
      if (mine === seq) setTimeout(() => { if (mine === seq) void next(true) }, 600)   // skip what can't be played
    }
  }
  /** when the list is about to run out, carry on with SoundCloud's "related" tracks */
  async function extendWithRadio(t: Track) {
    if (radioFor === t.id) return
    if (ctxId && (shuffle || repeat === 'ALL')) return          // shuffling / looping a playlist: never wander off into radio
    radioFor = t.id
    const more = (await related(t.id)).filter((x) => !ctx.some((c) => c.id === x.id))
    if (more.length && cur?.id === t.id) ctx = [...ctx, ...more]
  }
  function setMeta(t: Track) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title ?? '', artist: t.user?.username ?? '', artwork: art(t) ? [{ src: art(t)!, sizes: '500x500' }] : [] })
    } catch { /* ignore */ }
  }

  async function playFromCtx(i: number) {
    if (i < 0 || i >= ctx.length) return
    const [t] = await hydrate([ctx[i]])
    if (!t) { idx = i; return next(true) }
    if (cur) hist.push(cur)
    idx = i; played.add(t.id)
    await load(t)
  }
  async function next(auto = false): Promise<void> {
    if (auto && repeat === 'ONE' && cur) { audio.currentTime = 0; void audio.play(); return }
    const q = userQ.shift()
    if (q) { const t = await getTrack(q.videoId).catch(() => null); if (t) { if (cur) hist.push(cur); await load(t); return } }
    if (!ctx.length) return
    let n = idx + 1
    if (shuffle && ctx.length > 1) {
      const pool = (ctxId ? ctx.slice(0, baseLen || ctx.length) : ctx).map((t, i) => ({ t, i })).filter((x) => x.i !== idx && !played.has(x.t.id))
      if (!pool.length) {                                        // everything heard: a new round (or stop, if not looping)
        if (repeat !== 'ALL' && auto) return void audio.pause()
        played = new Set(cur ? [cur.id] : [])
        pool.push(...(ctxId ? ctx.slice(0, baseLen || ctx.length) : ctx).map((t, i) => ({ t, i })).filter((x) => x.i !== idx))
      }
      n = pool[Math.floor(Math.random() * pool.length)].i
    } else if (n >= ctx.length) {
      if (repeat === 'ALL') n = 0
      else { if (cur) await extendWithRadio(cur); if (idx + 1 >= ctx.length) return void audio.pause(); n = idx + 1 }
    }
    await playFromCtx(n)
  }
  async function previous() {
    if (audio.currentTime > 3 || !hist.length) { audio.currentTime = 0; return }
    const t = hist.pop()!
    const i = ctx.findIndex((c) => c.id === t.id); if (i >= 0) idx = i
    await load(t)
  }
  audio.addEventListener('ended', () => { void next(true) })
  audio.addEventListener('error', () => {
    if (!cur || !audio.src) return
    log(`audio error ${audio.error?.code} on "${cur.title}" (${curKey})`)
    const t = cur, at = audio.currentTime
    tried.set(t.id, [...(tried.get(t.id) ?? []), curKey])
    const left = (t.media?.transcodings ?? []).some((x) => (x.format.protocol === 'progressive' || x.format.protocol === 'hls') && !(tried.get(t.id) ?? []).includes(`${x.format.protocol}|${x.format.mime_type}`))
    if (left) return void load(t, { at })                       // that format won't play here: try the next one
    if (audio.crossOrigin) { audio.crossOrigin = null; tried.delete(t.id); return void load(t, { at }) }   // last resort: without CORS (the equalizer can't touch it then)
    setTimeout(() => void next(true), 800)
  })
  audio.addEventListener('ratechange', () => { if (audio.playbackRate !== speed) audio.playbackRate = speed })

  async function startList(listId: string, firstId?: string, o: { shuffled?: boolean } = {}) {
    const list = await listTracks(listId)
    if (!list.length) return
    ctx = list; ctxId = norm(listId); radioFor = 0; baseLen = list.length; played = new Set()
    if (o.shuffled) shuffle = true
    let i = firstId ? list.findIndex((t) => String(t.id) === firstId) : -1
    if (i < 0) i = o.shuffled ? Math.floor(Math.random() * list.length) : 0
    await playFromCtx(i)
  }

  async function runCommand(cmd: Command) {
    switch (cmd.type) {
      case 'togglePlay': return void (audio.paused ? audio.play().catch(() => {}) : audio.pause())
      case 'play': return void audio.play().catch(() => {})
      case 'pause': return void audio.pause()
      case 'next': return next()
      case 'previous': return previous()
      case 'seek': audio.currentTime = Math.max(0, cmd.seconds); return
      case 'volume': return setLevel(cmd.value / 100)
      case 'like': {
        if (!cur || !me) return
        const id = cur.id
        await loadLikes()                                          // know what's already liked before flipping it
        listCache.delete('LM')
        const was = liked.has(id)
        was ? liked.delete(id) : liked.add(id)                     // shows immediately
        try { await api(`/users/${me.id}/track_likes/${id}`, { method: was ? 'DELETE' : 'PUT' }) }
        catch (e) {
          was ? liked.add(id) : liked.delete(id)
          log(`${was ? 'unlike' : 'like'} failed: ${e}`)
          notice = `${Date.now()}|Couldn’t ${was ? 'unlike' : 'like'} that: ${String((e as Error)?.message ?? e).slice(0, 140)}`
        }
        return
      }
      case 'dislike': return
      case 'shuffle': shuffle = !shuffle; return
      case 'repeat': repeat = repeat === 'NONE' ? 'ALL' : repeat === 'ALL' ? 'ONE' : 'NONE'; return
      case 'playTrack': {
        const t = await getTrack(cmd.videoId)               // usually already known from the list you clicked in: no waiting
        if (cur) hist.push(cur)
        ctx = [t]; ctxId = cmd.playlistId ? norm(cmd.playlistId) : null; idx = 0; radioFor = 0; baseLen = 1; played = new Set([t.id])
        const playing = load(t)
        if (cmd.playlistId) {                              // the rest of the list fills in while the song is already starting
          const listId = norm(cmd.playlistId)
          listTracks(listId).then((list) => {
            const i = list.findIndex((x) => x.id === t.id)
            if (cur?.id === t.id && ctxId === listId && i >= 0) { ctx = list; idx = i; baseLen = list.length; void warmNext() }
          }).catch((e) => log('list: ' + e))
        }
        return playing
      }
      case 'playPlaylist': return startList(cmd.playlistId)
      case 'playPlaylistShuffled': return startList(cmd.playlistId, undefined, { shuffled: true })
      case 'queueAdd': cmd.next ? userQ.unshift(cmd.item) : userQ.push(cmd.item); return
      case 'queueRemove': userQ.splice(cmd.index, 1); return
      case 'queueClear': userQ = []; return
      case 'queueMove': { const [it] = userQ.splice(cmd.from, 1); if (it) userQ.splice(Math.max(0, Math.min(cmd.to, userQ.length)), 0, it); return }
      case 'resume': {
        const t = await getTrack(cmd.videoId).catch(() => null); if (!t) return
        ctx = [t]; ctxId = null; idx = 0
        if (cmd.playlistId) listTracks(cmd.playlistId).then((l) => { const i = l.findIndex((x) => x.id === t.id); if (i >= 0) { ctx = l; ctxId = norm(cmd.playlistId!); idx = i } }).catch(() => {})
        return load(t, { at: cmd.seconds, paused: true })
      }
      case 'eq': return applyEq(cmd.gains)
      case 'speed': speed = Math.max(0.25, Math.min(4, cmd.value)); audio.playbackRate = speed; return
      case 'fx': return applyFx({ reverb: Math.max(0, Math.min(1, cmd.reverb)), flanger: Math.max(0, Math.min(1, cmd.flanger)) })
    }
  }

  // ---------- state out ----------
  const snapshot = (): Partial<PlayerState> => {
    eqKeepAlive()
    const likeStatus: LikeStatus = cur && liked.has(cur.id) ? 'LIKE' : 'INDIFFERENT'
    return {
      videoId: cur ? String(cur.id) : null, playlistId: ctxId, title: cur?.title ?? '', artist: cur?.user?.username ?? '', album: '', albumId: '',
      artwork: cur ? art(cur) ?? null : null, paused: audio.paused, currentTime: audio.currentTime || 0,
      duration: isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (cur?.duration ?? 0) / 1000,
      volume: Math.round(level * 1000) / 10, likeStatus, repeat, shuffle, speed, fx: getFx(), userQueue: [...userQ],
      adActive: false, notice, loggedIn: !!me
    }
  }
  let last = ''
  const tick = () => {
    const s = snapshot()
    const key = JSON.stringify({ ...s, currentTime: Math.floor((s.currentTime ?? 0) * 2) })
    if (key === last) return
    last = key; ipcRenderer.send(CH.engineState, s)
  }
  window.addEventListener('DOMContentLoaded', () => { restoreEq(); setInterval(tick, 250) })
  for (const e of ['play', 'pause', 'seeking', 'seeked', 'volumechange', 'durationchange', 'loadedmetadata', 'timeupdate', 'ended']) audio.addEventListener(e, tick)

  try {
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => void audio.play()); ms.setActionHandler('pause', () => audio.pause())
    ms.setActionHandler('nexttrack', () => void next()); ms.setActionHandler('previoustrack', () => void previous())
    ms.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined) audio.currentTime = d.seekTime })
  } catch { /* ignore */ }

  // ---------- RPC (what the UI asks for) ----------
  const rpc = async (method: RpcMethod, a: any): Promise<unknown> => {
    await ready                                    // who you are / the client id must be known before anything is asked
    switch (method) {
      case 'search': {
        const q = String(a.query), p = { q, limit: 20 }
        const [tr, pl, al, us] = await Promise.all([
          api('/search/tracks', { params: p }), api('/search/playlists_without_albums', { params: p }),
          api('/search/albums', { params: p }), api('/search/users', { params: { q, limit: 10 } })].map((x) => x.catch(() => null)))
        return only([shelf('Songs', items(tr?.collection ?? [])), shelf('Playlists', items(pl?.collection ?? [])), shelf('Albums', items(al?.collection ?? [])), shelf('Artists', items(us?.collection ?? []))])
      }
      case 'suggest': {
        const r = await api('/search/queries', { params: { q: a.query, limit: 8 } }).catch(() => null)
        return (r?.collection ?? []).map((x: any) => x.output ?? x.query).filter(Boolean)
      }
      case 'home': {
        const [charts, mix] = await Promise.all([
          api('/charts', { params: { kind: 'top', genre: 'soundcloud:genres:all-music', limit: 20 } }).catch(() => null),
          api('/mixed-selections', { params: { limit: 12 } }).catch(() => null)])
        const out: Shelf[] = only([shelf('Trending now', items(charts?.collection ?? []))])
        for (const s of mix?.collection ?? []) { const sh = shelf(s.title ?? 'For you', items(s.items?.collection ?? [])); if (sh) out.push(sh) }
        return out
      }
      case 'library': {
        const mine: Item[] = lsGet().map((p) => ({ kind: 'playlist', title: p.title, subtitle: `${p.ids.length} songs · made with Triad`, browseId: `sc-pl:${p.id}`, playlistId: `sc-pl:${p.id}` }))
        for (let t = 0; !me && t < 3000; t += 100) await new Promise((r) => setTimeout(r, 100))
        if (!me) return only([shelf('Your playlists', mine)])
        const lib = await api('/me/library/all', { params: { limit: 60 } }).catch(() => null)
        const pls = (lib?.collection ?? []).filter((x: any) => x.playlist || x.system_playlist).map((x: any) => cardItem(x.playlist ?? x.system_playlist)).filter((i: Item | null): i is Item => !!i)
        return only([shelf('Your playlists', mine), shelf('Your library', pls)])
      }
      case 'playlist': {
        const id = norm(a.browseId)
        return only([shelf('Songs', (await listTracks(id)).map((t) => trackItem(t, true)))])
      }
      case 'queue': {
        const id = Number(a.videoId)
        const i = ctx.findIndex((t) => t.id === id)
        if (i >= 0) { await extendWithRadio(ctx[i]).catch(() => {}); return (await hydrate(ctx.slice(i + 1, i + 26))).map(queueItem) }
        return (await related(id)).map(queueItem)
      }
      case 'account': return me ? { name: me.name } : null
      case 'lyrics': return null                      // SoundCloud has none; the app falls back to Genius / LRCLIB
      case 'musicVideo': return null                  // no music videos on SoundCloud
      case 'artist': {
        let uid = String(a.browseId ?? '').replace(/^sc-u:/, '')
        if (!uid && a.name) { const r = await api('/search/users', { params: { q: a.name, limit: 1 } }); uid = String(r?.collection?.[0]?.id ?? '') }
        if (!uid) return null
        const [u, tr, pl, al] = await Promise.all([
          api(`/users/${uid}`), api(`/users/${uid}/tracks`, { params: { limit: 30 } }).catch(() => null),
          api(`/users/${uid}/playlists_without_albums`, { params: { limit: 20 } }).catch(() => null), api(`/users/${uid}/albums`, { params: { limit: 20 } }).catch(() => null)])
        return {
          browseId: `sc-u:${uid}`, name: u.username, thumbnail: art(u)?.replace('-t500x500', '-t500x500'), subscribers: `${(u.followers_count ?? 0).toLocaleString()} followers`, description: u.description ?? undefined,
          shelves: only([shelf('Tracks', items(tr?.collection ?? [])), shelf('Albums', items(al?.collection ?? [])), shelf('Playlists', items(pl?.collection ?? []))])
        }
      }
      case 'createPlaylist': {
        await needLogin()
        const title = String(a.name).trim().slice(0, 100)
        const r = await api('/playlists', { method: 'POST', params: { app_locale: 'en' }, body: { playlist: { title, sharing: 'private', _resource_type: 'playlist', tracks: [] } } })
        if (!r?.id) throw new Error('SoundCloud did not create the playlist.')
        return { playlistId: `sc-pl:${r.id}`, title: r.title ?? title, count: 0 }
      }
      case 'addToPlaylist': {
        if (!isLocal(a.playlistId)) await needLogin()
        const add = (a.videoIds?.length ? a.videoIds : [a.videoId]).map(Number).filter((n: number) => Number.isFinite(n))
        if (norm(a.playlistId) === 'LM') { for (const t of add) await runLike(String(t), true); return { ok: true } }
        const ids = await playlistIds(a.playlistId)
        const merged = [...ids, ...add.filter((t: number, i: number) => !ids.includes(t) && add.indexOf(t) === i)]
        if (merged.length !== ids.length) await putTracks(a.playlistId, merged)      // one write for the whole batch
        return { ok: true }
      }
      case 'removeFromPlaylist': {
        if (!isLocal(a.playlistId)) await needLogin()
        if (norm(a.playlistId) === 'LM') { await runLike(a.videoId, false); return { ok: true } }
        await putTracks(a.playlistId, (await playlistIds(a.playlistId)).filter((x) => String(x) !== String(a.videoId))); return { ok: true }
      }
      case 'moveInPlaylist': {
        if (!isLocal(a.playlistId)) await needLogin()
        const ids = await playlistIds(a.playlistId), from = ids.findIndex((x) => String(x) === String(a.setVideoId))
        if (from < 0) return { ok: true }
        const [m] = ids.splice(from, 1)
        const to = a.beforeSetVideoId ? ids.findIndex((x) => String(x) === String(a.beforeSetVideoId)) : -1
        ids.splice(to < 0 ? ids.length : to, 0, m)
        await putTracks(a.playlistId, ids); return { ok: true }
      }
      case 'renamePlaylist': if (isLocal(a.playlistId)) { editLocal(a.playlistId, (p) => { p.title = String(a.name) }); return { ok: true } }; await needLogin(); await api(`/playlists/${norm(a.playlistId).slice(6)}`, { method: 'PUT', body: { playlist: { title: a.name } } }); return { ok: true }
      case 'deletePlaylist': if (isLocal(a.playlistId)) { lsSet(lsGet().filter((x) => x.id !== norm(a.playlistId).slice(6))); return { ok: true } }; await needLogin(); await api(`/playlists/${norm(a.playlistId).slice(6)}`, { method: 'DELETE' }); return { ok: true }
    }
  }
  async function runLike(videoId: string, on: boolean) {
    const id = Number(videoId)
    listCache.delete('LM')
    await api(`/users/${me!.id}/track_likes/${id}`, { method: on ? 'PUT' : 'DELETE' })
    on ? liked.add(id) : liked.delete(id)
  }

  ready.then(() => ipcRenderer.send(CH.engineReady))      // tells the main process this page is up and can take requests
  ipcRenderer.on(CH.engineCommand, (_e, cmd: Command) => { runCommand(cmd).catch((err) => log(`command ${cmd.type} failed: ${err}`)) })
  ipcRenderer.on(CH.engineRpc, async (_e, req: { id: number; method: RpcMethod; args: any }) => {
    const t0 = Date.now()
    try { const data = await rpc(req.method, req.args ?? {}); if (Date.now() - t0 > 1500) log(`rpc ${req.method} took ${Date.now() - t0} ms`); ipcRenderer.send(CH.engineRpcResult, { id: req.id, ok: true, data }) }
    catch (err) { ipcRenderer.send(CH.engineRpcResult, { id: req.id, ok: false, error: String((err as Error).message ?? err) }) }
  })
}
