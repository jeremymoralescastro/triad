import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Backend, PlayerState } from '@shared/types'

/** The last song + position, so Triad can reopen on it (paused) next time. Saved in the user's data folder. */
export interface Snap { videoId: string; playlistId: string | null; title: string; artist: string; artwork: string | null; currentTime: number; duration: number }
const file = (b: Backend = 'ytm') => join(app.getPath('userData'), b === 'sc' ? 'last-session-sc.json' : 'last-session.json')

export function loadSession(b: Backend = 'ytm'): Snap | null {
  try { return existsSync(file(b)) ? (JSON.parse(readFileSync(file(b), 'utf8')) as Snap) : null } catch { return null }
}

let lastSave = 0
let lastPaused = true
let holdUntil = 0
/** While the app is restoring the previous song (paused at 0:00 for a moment) don't overwrite the saved position. */
export const holdSessionSaves = (ms = 15_000) => { holdUntil = Date.now() + ms }

export function saveSession(s: PlayerState) {
  if (!s.videoId || !s.title || s.adActive) return
  const now = Date.now()
  if (now < holdUntil && s.paused) return
  const pausedChanged = s.paused !== lastPaused
  lastPaused = s.paused
  if (!pausedChanged && now - lastSave < 4000) return
  lastSave = now
  const nearEnd = s.duration > 0 && s.duration - s.currentTime < 10
  const snap: Snap = { videoId: s.videoId, playlistId: s.playlistId, title: s.title, artist: s.artist, artwork: s.artwork, currentTime: nearEnd ? 0 : s.currentTime, duration: s.duration }
  try { writeFileSync(file(s.backend), JSON.stringify(snap)) } catch { /* ignore */ }
}
