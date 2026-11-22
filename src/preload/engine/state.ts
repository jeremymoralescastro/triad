import { ipcRenderer, webFrame } from 'electron'
import { CH, type LikeStatus, type PlayerState } from '@shared/types'
import { skipAdIfShowing } from './ads'
import { eqKeepAlive, getFx, restoreEq } from './eq'
import { knownLike, applyResume, checkPending, clearAutoplay, getUserQueue, getDesiredVolume, getRepeat, getShuffle, getShownVolume, enforceSpeed, enforceVolume, getSpeed, isSeekMuted, log, modeTick, wantsAutoplay } from './commands'

const video = () => document.querySelector<HTMLVideoElement>('video')
const txt = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? ''

let last = ''
let lastVideoId = ''

/** Things that keep a hidden player healthy. Cheap; runs on every tick. */
function housekeeping(v: HTMLVideoElement | null) {
  // "Are you still there?" prompt would pause playback
  document.querySelector<HTMLElement>('ytmusic-you-there-renderer button')?.click()

  // after we navigate to a track, make sure it actually starts
  if (v && wantsAutoplay()) {
    if (!v.paused) clearAutoplay()
    else if (v.readyState >= 2) v.play().catch((err) => { log(`play() rejected: ${err}`); document.querySelector<HTMLElement>('ytmusic-player-bar #play-pause-button')?.click() })
  }

  checkPending(v)
  applyResume(v)
  eqKeepAlive()

  // nobody can see the video, so don't decode a big one (audio is a separate stream, unaffected)
  const id = new URL(location.href).searchParams.get('v')
  if (id && id !== lastVideoId) {
    lastVideoId = id
    webFrame.executeJavaScript(`(() => { const p = document.querySelector('#movie_player'); p?.setPlaybackQualityRange?.('tiny','tiny'); p?.setPlaybackQuality?.('tiny') })()`).catch(() => {})
  }
}
let wasAd = false

function snapshot(): Partial<PlayerState> {
  const v = video()
  const md = navigator.mediaSession.metadata
  housekeeping(v)
  modeTick(v)
  if (v) { enforceVolume(v); enforceSpeed(v) }
  const adActive = skipAdIfShowing(v)
  const dv = getDesiredVolume()
  if (v && dv !== null && !adActive && !isSeekMuted() && Math.abs(v.volume - dv) > 0.002) v.volume = dv  // YouTube resets it on track change
  if (wasAd && !adActive && v) { v.muted = false; v.playbackRate = 1 }
  wasAd = adActive

  const artwork = md?.artwork?.length ? md.artwork[md.artwork.length - 1].src : null
  const byline = txt('ytmusic-player-bar .byline')
  return {
    videoId: new URL(location.href).searchParams.get('v'),
    playlistId: new URL(location.href).searchParams.get('list'),
    title: md?.title || txt('ytmusic-player-bar .title'),
    artist: md?.artist || byline.split('•')[0]?.trim() || '',
    album: md?.album || '',
    albumId: document.querySelector('ytmusic-player-bar a[href*="MPREb"]')?.getAttribute('href')?.match(/MPREb_[\w-]+/)?.[0] ?? '',
    artwork,
    paused: v ? v.paused : true,
    currentTime: v?.currentTime ?? 0,
    duration: v && isFinite(v.duration) ? v.duration : 0,
    volume: v ? Math.round(getShownVolume(v) * 1000) / 10 : 100,   // the real volume, never the brief silence of a skip
    likeStatus: knownLike(new URL(location.href).searchParams.get('v') ?? '') ?? 'INDIFFERENT',
    repeat: getRepeat(),
    shuffle: getShuffle(),
    speed: getSpeed(),
    fx: getFx(),
    userQueue: getUserQueue(),
    adActive,
    loggedIn: /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=/.test(document.cookie)
  }
}

export function startStateLoop() {
  restoreEq()
  const tick = () => {
    const s = snapshot()
    // ~2 updates/sec while playing; any other field change goes out immediately
    const key = JSON.stringify({ ...s, currentTime: Math.floor((s.currentTime ?? 0) * 2) })
    if (key === last) return
    last = key
    ipcRenderer.send(CH.engineState, s)
  }
  setInterval(tick, 250)
  // react instantly to the player instead of waiting for the next poll (media events don't bubble → capture)
  for (const e of ['play', 'pause', 'seeking', 'seeked', 'volumechange', 'durationchange', 'loadedmetadata', 'timeupdate', 'ended'])
    document.addEventListener(e, tick, true)
}
