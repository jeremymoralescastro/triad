import { ipcRenderer, webFrame } from 'electron'
import { CH } from '@shared/types'

/**
 * Music video: the player lives in a hidden window, so while the video pane is open we copy its frames
 * (downscaled JPEGs, ~20 per second) to the UI. Switching to the video version uses YouTube Music's own Song / Video toggle.
 */
const KEY = 'ytmd:video'
const video = () => document.querySelector<HTMLVideoElement>('video')
let on = (() => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } })()
export const getVideoMode = () => on

const toggle = () => document.querySelector<HTMLElement>('ytmusic-av-toggle')
const videoButton = () =>
  document.querySelector<HTMLElement>('ytmusic-av-toggle .video-button, ytmusic-av-toggle #video-button, ytmusic-av-toggle [aria-label*="ideo"]')
const songButton = () =>
  document.querySelector<HTMLElement>('ytmusic-av-toggle .song-button, ytmusic-av-toggle #song-button, ytmusic-av-toggle [aria-label*="ong"]')

/** Does YouTube Music offer a video version of what's playing? (its Song / Video switch exists and isn't disabled) */
export function videoAvailable(): boolean {
  const t = toggle()
  if (!t || t.hasAttribute('toggle-disabled') || t.hasAttribute('hidden')) return false
  return getComputedStyle(t).display !== 'none' && !!videoButton()
}

const quality = (q: string) => webFrame.executeJavaScript(`(() => { const p = document.querySelector('#movie_player'); p?.setPlaybackQualityRange?.('${q}','${q}'); p?.setPlaybackQuality?.('${q}') })()`).catch(() => {})

let timer: ReturnType<typeof setInterval> | undefined
let busy = false
let lastT = -1
const canvas = document.createElement('canvas')
function pump() {
  const v = video()
  if (!v || busy || v.readyState < 2 || !v.videoWidth) return
  if (v.paused && Math.abs(v.currentTime - lastT) < 0.05) return          // nothing new to show
  lastT = v.currentTime
  const w = 640, h = Math.max(2, Math.round((w * v.videoHeight) / v.videoWidth))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const ctx = canvas.getContext('2d'); if (!ctx) return
  try { ctx.drawImage(v, 0, 0, w, h) } catch { return }
  busy = true
  canvas.toBlob(async (b) => {
    try { if (b) ipcRenderer.send(CH.engineVideoFrame, new Uint8Array(await b.arrayBuffer())) } catch { /* ignore */ }
    busy = false
  }, 'image/jpeg', 0.66)
}
const start = () => { if (!timer) timer = setInterval(pump, 48) }
const stop = () => { if (timer) clearInterval(timer); timer = undefined; busy = false; lastT = -1 }

export function setVideo(next: boolean) {
  if (next && !videoAvailable()) { on = false; try { sessionStorage.setItem(KEY, '0') } catch { /* ignore */ } return }   // no video for this song: the UI shows "not found"
  on = next
  try { sessionStorage.setItem(KEY, next ? '1' : '0') } catch { /* ignore */ }
  if (next) { videoButton()?.click(); void quality('large'); start() }
  else { stop(); songButton()?.click(); void quality('tiny') }
}

let lastId = ''
/** Every tick: keep streaming after a page load, and re-select the video version when the song changes. */
export function videoTick(id: string | null) {
  if (!on) { if (timer) stop(); return }
  start()
  if (id && id !== lastId) {
    lastId = id
    setTimeout(() => {
      if (!on) return
      if (!videoAvailable()) return setVideo(false)          // the new song has no video: stop streaming (the UI says so)
      videoButton()?.click(); void quality('large')
    }, 1500)
  }
}
