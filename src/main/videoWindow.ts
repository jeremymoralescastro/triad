import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { CH, type PlayerState } from '@shared/types'
import { YTM_PARTITION } from './windows'

/** Show ONLY the <video>, stretched over the whole page: everything else on the page is made invisible. */
const ONLY_VIDEO_CSS = `
  html, body { background: #000 !important; overflow: hidden !important; }
  body * { visibility: hidden !important; }
  video { visibility: visible !important; position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important;
          width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
          object-fit: contain !important; z-index: 2147483647 !important; background: #000 !important; margin: 0 !important; }
`

/**
 * Music video, shown in the UI: a SECOND YouTube Music page loads the video (muted, the real player keeps making the
 * sound). It renders OFF-SCREEN (Electron's offscreen mode), so it runs at full speed even though nobody can see it, and
 * every painted frame is sent to the UI as a JPEG. We feed it the main player's position so the two stay in step.
 */
let win: BrowserWindow | null = null
let lastSync = 0
export function openVideo(videoId: string, at: number, _ui?: BrowserWindow) {
  closeVideo()
  const w = new BrowserWindow({
    show: false, width: 960, height: 540, title: 'Triad video',
    webPreferences: {
      partition: YTM_PARTITION,
      preload: join(__dirname, '../preload/video.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
      offscreen: true
    }
  })
  win = w
  w.webContents.setAudioMuted(true)
  w.webContents.setFrameRate(10)
  w.webContents.on('paint', () => { /* frames come from the page itself (see preload/video.ts); painting just keeps it alive */ })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const css = () => { if (!w.isDestroyed()) w.webContents.insertCSS(ONLY_VIDEO_CSS).catch(() => {}) }
  w.webContents.on('dom-ready', css)
  w.webContents.on('did-navigate-in-page', css)
  w.on('closed', () => { if (win === w) win = null })
  w.loadURL(`https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(at))}s`).catch(() => {})
}

export function closeVideo() {
  const w = win; win = null
  if (w && !w.isDestroyed()) w.destroy()
}

/** called with every player state update: tells the video page where the song is */
export function syncVideo(s: PlayerState) {
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  if (now - lastSync < 250) return
  lastSync = now
  win.webContents.send(CH.videoSync, { t: s.currentTime, paused: s.paused, speed: s.speed })
}
