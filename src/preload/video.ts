import { ipcRenderer, webFrame } from 'electron'
import { CH } from '@shared/types'

/**
 * Runs in the second (video) page. Never plays sound; follows the main player's position and stretches the
 * video over the whole page (the main process captures the page's paint and forwards it to the UI).
 */
if (location.hostname === 'music.youtube.com' && window.top === window) {
  const video = () => document.querySelector<HTMLVideoElement>('video')
  let target = { t: 0, paused: false, speed: 1 }
  let got = false
  ipcRenderer.on(CH.videoSync, (_e, s: typeof target) => { target = s; got = true })

  /** make the video fill the whole (off-screen) window; parents with transforms would trap a fixed element, so flatten them */
  const fill = (v: HTMLVideoElement) => {
    document.documentElement.style.setProperty('background', '#000', 'important')
    document.body.style.setProperty('background', '#000', 'important')
    document.body.style.setProperty('overflow', 'hidden', 'important')
    for (let el = v.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      for (const [k, val] of [['transform', 'none'], ['filter', 'none'], ['contain', 'none'], ['perspective', 'none'], ['clip-path', 'none']]) el.style.setProperty(k, val, 'important')
    }
    const st = v.style
    for (const [k, val] of [['position', 'fixed'], ['inset', '0'], ['left', '0'], ['top', '0'], ['width', '100vw'], ['height', '100vh'], ['max-width', 'none'], ['max-height', 'none'],
      ['object-fit', 'contain'], ['z-index', '2147483647'], ['background', '#000'], ['margin', '0']]) st.setProperty(k, val, 'important')
  }

  const follow = () => {
    const v = video(); if (!v) return
    v.muted = true; v.volume = 0
    if (!got) return
    if (target.paused) { if (!v.paused) v.pause() } else if (v.paused) v.play().catch(() => {})
    const drift = v.currentTime - target.t
    if (Math.abs(drift) > 0.4) v.currentTime = target.t                                   // far off (or the song was seeked): jump
    else v.playbackRate = Math.max(0.9, Math.min(1.1, target.speed * (1 - drift * 0.15)))  // close: ease back into step
  }

  /** copy the picture straight from the <video> onto a canvas and ship it as a JPEG: exact framing, no cropping guesswork */
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { alpha: false })
  let sending = false
  setInterval(() => {
    const v = video()
    if (!v || !cx || sending || !got || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return
    const w = Math.min(960, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth)
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    sending = true
    try {
      cx.drawImage(v, 0, 0, w, h)
      cv.toBlob(async (b) => {
        try { if (b) ipcRenderer.send(CH.engineVideoFrame, new Uint8Array(await b.arrayBuffer())) } finally { sending = false }
      }, 'image/jpeg', 0.75)
    } catch { sending = false }
  }, 40)

  let q = false
  setInterval(() => {
    const v = video()
    if (v && !q) { q = true; webFrame.executeJavaScript(`(() => { const p = document.querySelector('#movie_player'); p?.setPlaybackQualityRange?.('large','large'); p?.setPlaybackQuality?.('large') })()`).catch(() => {}) }
    if (v) {
      fill(v)
    }
    follow()
    // skip an ad if one shows up
    document.querySelector<HTMLElement>('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')?.click()
  }, 250)
}
