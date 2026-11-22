import { ipcRenderer, webFrame } from 'electron'
import { CH, type Command, type QueueItem } from '@shared/types'
import { applyEq, applyFx } from './eq'

const video = () => document.querySelector<HTMLVideoElement>('video')
const click = (sel: string) => document.querySelector<HTMLElement>(sel)?.click()

/* ---- autoplay handshake: set before we navigate, honoured by the state loop on the next page ---- */
const AUTOPLAY_KEY = 'ytmd:autoplay'
export const wantsAutoplay = () => Date.now() - Number(sessionStorage.getItem(AUTOPLAY_KEY) || 0) < 20_000
export const clearAutoplay = () => sessionStorage.removeItem(AUTOPLAY_KEY)

export const log = (m: string) => ipcRenderer.send(CH.engineLog, m)

export const RESUME_KEY = 'ytmd:resume'
const PENDING_KEY = 'ytmd:pending'
type Pending = { videoId: string; hadList: boolean; retried: boolean; at: number }

/** Full page load: slow (YouTube Music is a heavy page) but bulletproof. Also the fallback for the fast path. */
function fullLoad(path: string, videoId?: string) {
  sessionStorage.setItem(AUTOPLAY_KEY, String(Date.now()))
  if (videoId) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ videoId, hadList: path.includes('list='), retried: false, at: Date.now() } satisfies Pending))
  log(`navigate ${path}`)
  location.assign(`https://music.youtube.com${path}`)
}

/**
 * Fast track start: hand the next video to the player that's already running (no page reload, so no
 * multi-second wait). We then check the player really switched and the title/artwork followed; if anything
 * looks off we fall back to the full page load, so the worst case is the old behaviour.
 */
const inMain = <T,>(code: string) => webFrame.executeJavaScript(code) as Promise<T>
async function fastLoad(path: string, videoId: string): Promise<boolean> {
  if (location.pathname !== '/watch') return false
  const started = await inMain<boolean>(`(() => { const p = document.querySelector('#movie_player'); if (!p || !p.loadVideoById) return false; p.loadVideoById(${JSON.stringify(videoId)}); return true })()`).catch(() => false)
  if (!started) return false
  try { history.replaceState(null, '', path) } catch { /* the check below decides */ }
  const t0 = Date.now()
  while (Date.now() - t0 < 3500) {
    await new Promise((r) => setTimeout(r, 120))
    const d = await inMain<{ id: string; title: string } | null>(`(() => { const p = document.querySelector('#movie_player'); const d = p && p.getVideoData && p.getVideoData(); return d ? { id: d.video_id, title: d.title } : null })()`).catch(() => null)
    const v = video()
    if (d && d.id === videoId && v && !v.paused && v.currentTime > 0 && navigator.mediaSession.metadata?.title === d.title) {
      log(`fast switch → ${videoId} in ${Date.now() - t0}ms`)
      return true
    }
  }
  log('fast switch did not confirm; falling back to a full load')
  return false
}

function goWatch(path: string, videoId?: string) {
  if (!videoId) return fullLoad(path)
  sessionStorage.setItem(AUTOPLAY_KEY, String(Date.now()))
  void fastLoad(path, videoId).then((ok) => { if (ok) clearAutoplay(); else fullLoad(path, videoId) }, () => fullLoad(path, videoId))
}

/** Called every tick on the new page: confirm playback began, else retry once with a plain /watch?v= link. */
export function checkPending(v: HTMLVideoElement | null) {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return
  const p = JSON.parse(raw) as Pending
  const cur = new URL(location.href).searchParams.get('v')
  if (v && !v.paused && v.currentTime > 0 && cur === p.videoId) { sessionStorage.removeItem(PENDING_KEY); log(`playing ${cur}`); return }
  if (Date.now() - p.at < 7000) return
  sessionStorage.removeItem(PENDING_KEY)
  if (p.hadList && !p.retried) {
    log('not playing after 7s; retrying without list=')
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, hadList: false, retried: true, at: Date.now() } satisfies Pending))
    sessionStorage.setItem(AUTOPLAY_KEY, String(Date.now()))
    location.assign(`https://music.youtube.com/watch?v=${encodeURIComponent(p.videoId)}`)
  } else {
    log(`gave up: video=${!!v} paused=${v?.paused} readyState=${v?.readyState} url=${location.href}`)
  }
}

/* ------------------------------------------------------------------ repeat / shuffle ----
 * YouTube Music's own buttons proved unreliable from a hidden window, so Triad owns both modes.
 * Every track start is a full page load, so the modes live in sessionStorage.
 *   repeat: NONE → ALL → ONE → NONE.  ONE = <video>.loop;  ALL = when the queue ends, start it again.
 *   shuffle: next/auto-advance pick a random not-yet-played track from the current playlist.
 */
type Repeat = 'NONE' | 'ALL' | 'ONE'
const MODES_KEY = 'ytmd:modes'
const loadModes = (): { repeat: Repeat; shuffle: boolean } => {
  try { return { repeat: 'NONE', shuffle: false, ...JSON.parse(sessionStorage.getItem(MODES_KEY) || '{}') } } catch { return { repeat: 'NONE', shuffle: false } }
}
let modes = loadModes()
const saveModes = () => sessionStorage.setItem(MODES_KEY, JSON.stringify(modes))
export const getRepeat = () => modes.repeat
export const getShuffle = () => modes.shuffle

let queueFetcher: ((listId: string) => Promise<string[]>) | null = null
export const setQueueFetcher = (f: (listId: string) => Promise<string[]>) => { queueFetcher = f }

const curVideoId = () => new URL(location.href).searchParams.get('v')
const curList = () => new URL(location.href).searchParams.get('list')
const readJson = <T,>(k: string, d: T): T => { try { return JSON.parse(sessionStorage.getItem(k) || '') as T } catch { return d } }

async function shuffleNext(listOverride?: string): Promise<void> {
  const list = listOverride ?? curList(), cur = listOverride ? null : curVideoId()
  if (listOverride) sessionStorage.removeItem(`ytmd:played:${list}`)
  const native = () => (listOverride ? goWatch(`/watch?list=${encodeURIComponent(list!)}`) : click('ytmusic-player-bar .next-button'))
  if (!list || !queueFetcher) return native()
  let queue = readJson<string[]>(`ytmd:queue:${list}`, [])
  const at = readJson<number>(`ytmd:queueAt:${list}`, 0)
  if (!queue.length || Date.now() - at > 60_000) {          // the playlist may have changed: refresh it at most once a minute
    try { queue = (await queueFetcher(list)).slice(0, 5000); sessionStorage.setItem(`ytmd:queue:${list}`, JSON.stringify(queue)); sessionStorage.setItem(`ytmd:queueAt:${list}`, String(Date.now())) }
    catch (e) { log(`shuffle: couldn't load queue (${e})`) }
  }
  if (queue.length < 2) return native()
  let played = new Set(readJson<string[]>(`ytmd:played:${list}`, []))
  if (cur) played.add(cur)
  let pool = queue.filter((id) => !played.has(id))
  if (!pool.length) { played = new Set(cur ? [cur] : []); pool = queue.filter((id) => id !== cur) }   // everything heard → start a new round
  const pick = pool[Math.floor(Math.random() * pool.length)]
  played.add(pick)
  sessionStorage.setItem(`ytmd:played:${list}`, JSON.stringify([...played]))
  log(`shuffle → ${pick} (${pool.length} left in round)`)
  goWatch(`/watch?v=${encodeURIComponent(pick)}&list=${encodeURIComponent(list)}`, pick)
}

/* ---- your queue ("Play next" / "Add to queue"): takes priority over shuffle and YouTube's own order ---- */
const readQueue = (): QueueItem[] => readJson<QueueItem[]>('ytmd:uq', [])
const writeQueue = (q: QueueItem[]) => sessionStorage.setItem('ytmd:uq', JSON.stringify(q))
export const getUserQueue = () => readQueue()
function playFromQueue(): boolean {
  const q = readQueue()
  const it = q.shift()
  if (!it) return false
  writeQueue(q)
  log(`queue → ${it.title} (${q.length} left)`)
  goWatch(`/watch?v=${encodeURIComponent(it.videoId)}`, it.videoId)
  return true
}

let endedAt = 0
let endFiredFor = ''
/** Called every state tick: keeps loop/shuffle/repeat-all behaving. */
export function modeTick(v: HTMLVideoElement | null) {
  if (!v) return
  const wantLoop = modes.repeat === 'ONE'
  if (v.loop !== wantLoop) v.loop = wantLoop

  // shuffle: jump to a random track just before this one ends (YouTube would otherwise play the next in order)
  const id = curVideoId() ?? ''
  const hasQueue = readQueue().length > 0
  if ((modes.shuffle || hasQueue) && !wantLoop && id && endFiredFor !== id && v.duration > 5 && v.duration - v.currentTime < 0.8 && v.currentTime > 2) {
    endFiredFor = id
    if (!playFromQueue()) shuffleNext()
    return
  }
  // repeat all: the queue really ended (video finished and nothing took over) → start it again
  if (v.ended && modes.repeat === 'ALL') {
    endedAt ||= Date.now()
    if (Date.now() - endedAt > 2500) {
      endedAt = 0
      const list = curList()
      log('repeat all: queue finished, restarting')
      if (list) goWatch(`/watch?list=${encodeURIComponent(list)}`)
      else { v.currentTime = 0; v.play().catch(() => {}) }
    }
  } else endedAt = 0
}

/** On the page opened by a 'resume' command: keep the player paused, put it at the saved position, then let go. */
export function applyResume(v: HTMLVideoElement | null) {
  const raw = sessionStorage.getItem(RESUME_KEY)
  if (!raw) return
  const r = JSON.parse(raw) as { videoId: string; seconds: number; at: number; seeked: boolean }
  const finish = (why: string) => { sessionStorage.removeItem(RESUME_KEY); if (v) v.muted = false; log(`resume ${why}`) }
  if (Date.now() - r.at > 20_000) return finish('timed out')
  if (!v || curVideoId() !== r.videoId) return
  v.muted = true                                   // no blip of sound while we get into position
  if (!v.paused) v.pause()
  if (v.readyState >= 1 && (!r.seeked || Math.abs(v.currentTime - r.seconds) > 3) && Date.now() - r.at < 12_000) {
    v.currentTime = r.seconds
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...r, seeked: true }))
  }
  if (r.seeked && v.paused && Math.abs(v.currentTime - r.seconds) <= 3 && Date.now() - r.at > 2500) finish(`ready at ${v.currentTime.toFixed(0)}s`)
}

const SPEED_KEY = 'ytmd:speed'
let desiredSpeed = (() => { try { const n = parseFloat(sessionStorage.getItem(SPEED_KEY) ?? ''); return Number.isFinite(n) && n > 0 ? n : 1 } catch { return 1 } })()
export const getSpeed = () => desiredSpeed
/** Speed changes pitch too (like a record), and YouTube resets the rate on new songs, so keep re-applying it. */
export function enforceSpeed(v: HTMLVideoElement) {
  if (v.preservesPitch !== false) v.preservesPitch = false
  if (Math.abs(v.playbackRate - desiredSpeed) > 0.001) v.playbackRate = desiredSpeed
}
const VOL_KEY = 'ytmd:vol'   // survives the page load that every new song causes
let desiredVolume: number | null = (() => { try { const n = parseFloat(sessionStorage.getItem(VOL_KEY) ?? ''); return Number.isFinite(n) ? n : null } catch { return null } })()   // 0..1, exact
// brand-new session (nothing remembered yet): start from the volume saved in Triad's settings, before anything plays loud
if (desiredVolume === null) {
  ipcRenderer.invoke(CH.settingsGet).then((st: { volume?: number }) => {
    if (desiredVolume !== null || !st || !(st.volume! > 0)) return
    desiredVolume = Math.min(1, st.volume! / 100)
    try { sessionStorage.setItem(VOL_KEY, String(desiredVolume)) } catch { /* ignore */ }
    const v = video(); if (v) v.volume = desiredVolume
    log(`volume restored to ${st.volume}%`)
  }).catch(() => {})
}
/** YouTube resets the player's volume on every new song; keep it where the user put it (this window is hidden, so only our commands change it). */
export function enforceVolume(v: HTMLVideoElement) {
  if (desiredVolume === null || seekMuted) return
  if (Math.abs(v.volume - desiredVolume) > 0.004) v.volume = desiredVolume
}
let syncTimer: ReturnType<typeof setTimeout> | undefined
export const getDesiredVolume = () => desiredVolume

/**
 * Seeking without audible glitches: go silent, jump, wait until the new spot has real data
 * (the player has to buffer it), then fade the sound back in. A later seek cancels an earlier one.
 */
let seekToken = 0
let seekMuted = false
let restoreVolume = 1
export const isSeekMuted = () => seekMuted
/** The volume the user actually has (what the UI should show while a skip briefly silences the player). */
export const getShownVolume = (v: HTMLVideoElement | null) => (seekMuted ? (desiredVolume ?? restoreVolume) : (v?.volume ?? 1))
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function seekSmooth(v: HTMLVideoElement, seconds: number) {
  const token = ++seekToken
  if (!seekMuted) restoreVolume = desiredVolume ?? v.volume    // what to fade back up to (never jump to 100%)
  seekMuted = true
  v.volume = 0
  v.currentTime = Math.max(0, seconds)
  const vids = document.querySelectorAll('video').length
  log(`seek → ${seconds.toFixed(1)}s (video elements: ${vids}, duration ${isFinite(v.duration) ? v.duration.toFixed(1) : '?'}s)`)
  setTimeout(() => {
    const cur = document.querySelector<HTMLVideoElement>('video')
    log(`seek check +1.5s: currentTime=${cur?.currentTime.toFixed(1)} readyState=${cur?.readyState} ended=${cur?.ended} paused=${cur?.paused} url=${location.search}`)
  }, 1500)
  const start = Date.now()
  while (token === seekToken && (v.seeking || v.readyState < 3) && Date.now() - start < 8000) await nap(40)
  await nap(120)                                   // let the decoder settle on the new spot
  if (token !== seekToken) return                  // superseded by a newer seek, which owns the fade-in
  const target = desiredVolume ?? restoreVolume
  for (let i = 1; i <= 8; i++) { v.volume = target * (i / 8); await nap(18); if (token !== seekToken) return }
  v.volume = target
  seekMuted = false
}

export async function runCommand(cmd: Command) {
  const v = video()
  switch (cmd.type) {
    case 'togglePlay': clearAutoplay(); sessionStorage.removeItem(PENDING_KEY); return void (v && (v.paused ? v.play() : v.pause()))
    case 'play': return void v?.play()
    case 'pause': clearAutoplay(); sessionStorage.removeItem(PENDING_KEY); return void v?.pause()
    case 'next':
      if (playFromQueue()) return
      return modes.shuffle ? void (await shuffleNext()) : click('ytmusic-player-bar .next-button')
    case 'previous': return click('ytmusic-player-bar .previous-button')
    case 'seek':
      if (v) void seekSmooth(v, cmd.seconds)
      return
    case 'volume': {
      const g = Math.max(0, Math.min(1, cmd.value / 100))
      desiredVolume = g
      try { sessionStorage.setItem(VOL_KEY, String(g)) } catch { /* ignore */ }
      if (v && !seekMuted) v.volume = g          // fractional = smooth (during a seek it's applied by the fade-in)
      clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        webFrame.executeJavaScript(`document.querySelector('#movie_player')?.setVolume?.(${Math.round(g * 100)})`).catch(() => {})
      }, 300)
      return
    }
    case 'shuffle': modes = { ...modes, shuffle: !modes.shuffle }; saveModes(); return log(`shuffle ${modes.shuffle ? 'on' : 'off'}`)
    case 'repeat':
      modes = { ...modes, repeat: modes.repeat === 'NONE' ? 'ALL' : modes.repeat === 'ALL' ? 'ONE' : 'NONE' }
      saveModes(); if (v) v.loop = modes.repeat === 'ONE'
      return log(`repeat ${modes.repeat}`)
    case 'like': return click('ytmusic-like-button-renderer #button-shape-like button')
    case 'dislike': return click('ytmusic-like-button-renderer #button-shape-dislike button')
    case 'playTrack': {
      const q = new URLSearchParams({ v: cmd.videoId })
      if (cmd.playlistId) q.set('list', cmd.playlistId)
      return goWatch(`/watch?${q}`, cmd.videoId)
    }
    case 'queueAdd': {
      const q = readQueue().filter((x) => x.videoId !== cmd.item.videoId)
      if (cmd.next) q.unshift(cmd.item); else q.push(cmd.item)
      return writeQueue(q)
    }
    case 'queueRemove': { const q = readQueue(); q.splice(cmd.index, 1); return writeQueue(q) }
    case 'queueClear': return writeQueue([])
    case 'queueMove': {
      const q = readQueue(); const [it] = q.splice(cmd.from, 1)
      if (it) q.splice(Math.max(0, Math.min(cmd.to, q.length)), 0, it)
      return writeQueue(q)
    }
    case 'playPlaylistShuffled':
      modes = { ...modes, shuffle: true }; saveModes()
      return void (await shuffleNext(cmd.playlistId))
    case 'eq': return applyEq(cmd.gains)
    case 'speed': {
      desiredSpeed = Math.max(0.25, Math.min(4, cmd.value))
      try { sessionStorage.setItem(SPEED_KEY, String(desiredSpeed)) } catch { /* ignore */ }
      const v = video(); if (v) enforceSpeed(v)
      return
    }
    case 'fx': return applyFx({ reverb: Math.max(0, Math.min(1, cmd.reverb)), flanger: Math.max(0, Math.min(1, cmd.flanger)) })
    case 'resume': {
      // reopen the last song, but paused at the saved position (no autoplay handshake)
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ videoId: cmd.videoId, seconds: cmd.seconds, at: Date.now(), seeked: false }))
      const q = new URLSearchParams({ v: cmd.videoId })
      if (cmd.playlistId) q.set('list', cmd.playlistId)
      log(`resume ${cmd.videoId} at ${cmd.seconds.toFixed(0)}s (paused)`)
      return void location.assign(`https://music.youtube.com/watch?${q}`)
    }
    case 'playPlaylist': return goWatch(`/watch?list=${encodeURIComponent(cmd.playlistId)}`)
  }
}
