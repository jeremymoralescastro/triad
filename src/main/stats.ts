import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PlayerState, StatsResult } from '@shared/types'
import { getSettings } from './settings'

/**
 * Local listening history. A song counts as "played" once you've actually listened to it for
 * 30 seconds (or half of it, for short tracks). Stored in a small JSON file in Triad's data folder
 * (%APPDATA%\\ytm-desk\\listening.json) and never sent anywhere.
 */
interface Db {
  songs: Record<string, { videoId: string; title: string; artist: string; artwork: string | null; plays: number }>
  artists: Record<string, { name: string; plays: number; artwork: string | null }>
}
let db: Db | null = null
const file = () => join(app.getPath('userData'), 'listening.json')

function load(): Db {
  if (db) return db
  try { db = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Db) : { songs: {}, artists: {} } }
  catch { db = { songs: {}, artists: {} } }
  return db
}
const save = () => { try { writeFileSync(file(), JSON.stringify(db)) } catch (e) { console.log('[stats] save failed', String(e)) } }

/** "A, B & C" → "A" (primary artist); keeps "Tyler, The Creator" together. */
const primaryArtist = (a: string) => a.split(/\s*(?:,(?!\s*the\b)|&| x | feat\.?| ft\.?)\s*/i)[0].trim()

let cur = '', acc = 0, lastT = 0, counted = false
/** Feed every merged player state in; counts a play when the listening threshold is crossed. */
export function trackListening(s: PlayerState) {
  if (!getSettings().trackHistory) return
  if (!s.videoId || s.adActive) return
  if (s.videoId !== cur) { cur = s.videoId; acc = 0; lastT = s.currentTime; counted = false; return }
  if (s.paused) { lastT = s.currentTime; return }
  const d = s.currentTime - lastT
  if (d > 0 && d < 2) acc += d                                   // real playback, not a seek
  else if (counted && d < -5) { acc = 0; counted = false }       // looped back to the start (repeat one) → a new play
  lastT = s.currentTime
  if (counted || !s.title) return
  if (acc < Math.min(30, (s.duration || 60) * 0.5)) return
  counted = true

  const d_ = load()
  const song = d_.songs[s.videoId] ??= { videoId: s.videoId, title: s.title, artist: s.artist, artwork: s.artwork, plays: 0 }
  song.plays++; song.title = s.title; song.artist = s.artist; song.artwork = s.artwork ?? song.artwork
  const name = primaryArtist(s.artist)
  if (name) {
    const a = d_.artists[name.toLowerCase()] ??= { name, plays: 0, artwork: null }
    a.plays++; a.artwork = s.artwork ?? a.artwork
  }
  save()
  console.log(`[stats] counted "${s.title}" (${song.plays}x)`)
}

export function getStats(): StatsResult {
  const d = load()
  return {
    songs: Object.values(d.songs).sort((a, b) => b.plays - a.plays).slice(0, 12),
    artists: Object.values(d.artists).sort((a, b) => b.plays - a.plays).slice(0, 12)
  }
}

export function clearStats() { db = { songs: {}, artists: {} }; save() }
