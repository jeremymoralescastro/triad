import { create } from 'zustand'
import { emptyState, type Command, type PlayerState } from '@shared/types'

export const usePlayer = create<PlayerState>(() => emptyState)

/**
 * Instant feedback: when you click, the screen changes right away (the new song, play/pause, seek, volume, like …) and the real
 * player catches up. Each guess is "held" until the player confirms it (or a few seconds pass), so a state update that was already
 * on its way never flickers the old value back.
 */
type Hold = { value: unknown; until: number; clearWhen: (s: PlayerState) => boolean }
const holds = new Map<keyof PlayerState, Hold>()
const hold = <K extends keyof PlayerState>(k: K, value: PlayerState[K], ms: number, clearWhen?: (s: PlayerState) => boolean) => {
  holds.set(k, { value, until: Date.now() + ms, clearWhen: clearWhen ?? ((s) => s[k] === value) })
  usePlayer.setState({ [k]: value } as Partial<PlayerState>)
}
const reconcile = (s: PlayerState): PlayerState => {
  let out = s
  for (const [k, h] of holds) {
    if (Date.now() > h.until || h.clearWhen(s)) holds.delete(k)
    else out = { ...out, [k]: h.value }
  }
  return out
}

type Meta = { videoId: string; title: string; artist: string; artwork: string | null; duration: number }
const secs = (d?: string) => { const p = (d ?? '').split(':').map(Number); return p.length >= 2 && p.every((n) => isFinite(n)) ? p.reduce((a, n) => a * 60 + n, 0) : 0 }
const history: Meta[] = []                               // songs played before this one (for Previous)
let lastId: string | null = null
let lastMeta: Meta | null = null

/** show a song as playing right now */
function showTrack(m: Meta, confirmedBy: (s: PlayerState) => boolean, ms: number) {
  const until = ms
  hold('videoId', m.videoId, until, confirmedBy)
  hold('title', m.title, until, confirmedBy); hold('artist', m.artist, until, confirmedBy); hold('artwork', m.artwork, until, confirmedBy)
  hold('duration', m.duration, until, confirmedBy); hold('currentTime', 0, until, confirmedBy); hold('paused', false, until, confirmedBy)
  hold('likeStatus', 'INDIFFERENT', until, confirmedBy)
}

function optimistic(cmd: Command) {
  const s = usePlayer.getState()
  switch (cmd.type) {
    case 'togglePlay': return hold('paused', !s.paused, 2500)
    case 'play': return hold('paused', false, 2500)
    case 'pause': return hold('paused', true, 2500)
    case 'seek': return hold('currentTime', cmd.seconds, 2000, (n) => Math.abs(n.currentTime - cmd.seconds) < 1.5)
    case 'volume': return hold('volume', cmd.value, 1500, (n) => Math.abs(n.volume - cmd.value) < 1.5)
    case 'like': return hold('likeStatus', s.likeStatus === 'LIKE' ? 'INDIFFERENT' : 'LIKE', 3000)
    case 'shuffle': return hold('shuffle', !s.shuffle, 2500)
    case 'repeat': return hold('repeat', s.repeat === 'NONE' ? 'ALL' : s.repeat === 'ALL' ? 'ONE' : 'NONE', 2500)
    case 'speed': return hold('speed', cmd.value, 2500)
    case 'queueAdd': {
      const q = cmd.next ? [cmd.item, ...s.userQueue] : [...s.userQueue, cmd.item]
      return hold('userQueue', q, 3000, (n) => n.userQueue.length === q.length)
    }
    case 'queueRemove': { const q = s.userQueue.filter((_, i) => i !== cmd.index); return hold('userQueue', q, 3000, (n) => n.userQueue.length === q.length) }
    case 'queueClear': return hold('userQueue', [], 3000, (n) => n.userQueue.length === 0)
    case 'playTrack': {
      const m = window.ytm.trackMeta?.(cmd.videoId)
      if (!m) return hold('paused', false, 6000)
      return showTrack({ videoId: cmd.videoId, title: m.title, artist: m.artist, artwork: m.thumbnail ?? null, duration: secs(m.duration) }, (n) => n.videoId === cmd.videoId, 6000)
    }
    case 'next': {
      if (s.repeat === 'ONE') return hold('currentTime', 0, 1500)
      const q = s.userQueue[0] ?? (s.shuffle ? null : window.ytm.upcoming?.()[0])
      if (!q) return hold('paused', false, 3000)
      const old = s.videoId
      return showTrack({ videoId: q.videoId, title: q.title, artist: q.artist, artwork: q.thumbnail ?? null, duration: 0 }, (n) => n.videoId !== old, 3000)
    }
    case 'previous': {
      if (s.currentTime > 3 || !history.length) return hold('currentTime', 0, 1500, (n) => n.currentTime < 1.5)
      const m = history[history.length - 1], old = s.videoId
      return showTrack(m, (n) => n.videoId !== old, 3000)
    }
  }
}
window.ytm.onCommand?.(optimistic)

const take = (s: PlayerState) => {
  // keep a trail of what was playing (the real thing, not guesses) so Previous can show the right song at once
  if (s.videoId && s.videoId !== lastId) {
    if (history.length && history[history.length - 1].videoId === s.videoId) history.pop()      // went back a song
    else if (lastMeta && lastId) { history.push(lastMeta); if (history.length > 40) history.shift() }
    lastId = s.videoId
  }
  if (s.videoId && s.title) lastMeta = { videoId: s.videoId, title: s.title, artist: s.artist, artwork: s.artwork, duration: s.duration }
  usePlayer.setState(reconcile(s))
}
// hydrate once, then stream
window.ytm.getState().then(take)
window.ytm.onState(take)

export const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60), r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}
