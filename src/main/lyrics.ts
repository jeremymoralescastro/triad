import { net } from 'electron'
import { parse } from 'node-html-parser'
import type { LrcLine, LyricsResult } from '@shared/types'

/**
 * Genius lyrics. Genius's official API only returns song metadata, not lyrics, so we do what their
 * website does: search (public endpoint) → open the song page → read the lyrics blocks.
 * Runs in the main process (Chromium network stack), results cached per song for the session.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
const cache = new Map<string, LyricsResult | null>()

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

/** "Song (feat. X) - Remastered 2011" → "Song" */
const cleanTitle = (t: string) =>
  t.replace(/\s*[([][^)\]]*(feat|ft\.|official|video|audio|lyric|remaster|version|explicit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(remaster.*|\d{4}.*|single version.*|radio edit.*)$/i, '')
    .trim()

const firstArtist = (a: string) => a.split(/,|&| x | feat\.?| ft\.?/i)[0].trim()

const decode = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

interface Hit { title: string; url: string; primary_artist?: { name: string } }

async function search(q: string): Promise<Hit[]> {
  const res = await net.fetch(`https://genius.com/api/search/song?per_page=5&q=${encodeURIComponent(q)}`,
    { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (!res.ok) throw new Error(`Genius search → HTTP ${res.status}`)
  const j = (await res.json()) as any
  return ((j?.response?.sections?.[0]?.hits ?? []) as any[]).map((h) => h.result).filter(Boolean)
}

function pick(hits: Hit[], title: string, artist: string): Hit | null {
  const t = norm(title), a = norm(artist)
  let best: Hit | null = null, top = 0
  for (const h of hits) {
    const ht = norm(h.title), ha = norm(h.primary_artist?.name ?? '')
    let s = 0
    if (ht === t) s += 3; else if (ht && t && (ht.includes(t) || t.includes(ht))) s += 1
    if (ha && a && ha === a) s += 2; else if (ha && a && (ha.includes(a) || a.includes(ha))) s += 1
    if (s > top) { top = s; best = h }
  }
  return top >= 3 ? best : null   // strong title match, or partial title + artist
}

async function scrape(url: string): Promise<string | null> {
  const res = await net.fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' } })
  if (!res.ok) throw new Error(`Genius page → HTTP ${res.status}`)
  const blocks = parse(await res.text()).querySelectorAll('[data-lyrics-container="true"]')
  if (!blocks.length) return null
  const text = blocks.map((b) => {
    b.querySelectorAll('[data-exclude-from-selection="true"]').forEach((n) => n.remove())
    return decode(b.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
  }).join('\n')
  return text.replace(/\n{3,}/g, '\n\n').trim() || null
}

/** LRCLIB: free community database of time-synced lyrics ("[01:23.45] line"). */
function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const m = raw.match(/^((?:\[\d+:\d+(?:[.:]\d+)?\])+)\s*(.*)$/)
    if (!m) continue
    for (const tag of m[1].matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) {
      const frac = tag[3] ? Number('0.' + tag[3]) : 0
      out.push({ t: Number(tag[1]) * 60 + Number(tag[2]) + frac, text: m[2].trim() })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

async function lrclib(title: string, artist: string, duration: number): Promise<LrcLine[] | null> {
  const res = await net.fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`,
    { headers: { 'user-agent': 'Triad (personal music player)', accept: 'application/json' } })
  if (!res.ok) throw new Error(`LRCLIB → HTTP ${res.status}`)
  const hits = ((await res.json()) as any[]).filter((h) => h?.syncedLyrics)
  const t = norm(title), a = norm(artist)
  let best: any = null, top = -1
  for (const h of hits) {
    let sc = 0
    if (norm(h.trackName) === t) sc += 3; else if (norm(h.trackName).includes(t) || t.includes(norm(h.trackName))) sc += 1
    if (norm(h.artistName).includes(a) || a.includes(norm(h.artistName))) sc += 2
    if (duration > 0 && typeof h.duration === 'number') {
      const d = Math.abs(h.duration - duration)
      sc += d < 2 ? 3 : d < 5 ? 1 : d > 15 ? -3 : 0      // same recording → timestamps line up
    }
    if (sc > top) { top = sc; best = h }
  }
  if (!best || top < 3) return null
  const lines = parseLrc(best.syncedLyrics as string)
  return lines.length >= 4 ? lines : null
}

export async function getLyrics(q: { title: string; artist: string; duration?: number }): Promise<LyricsResult | null> {
  const title = cleanTitle(q.title), artist = firstArtist(q.artist)
  if (!title) return null
  const key = `${norm(artist)}|${norm(title)}`
  if (cache.has(key)) return cache.get(key)!

  // Genius (nice text, section headers) and LRCLIB (timestamps) in parallel; either may fail on its own
  const [gen, lrc] = await Promise.allSettled([
    (async () => {
      const hit = pick(await search(`${artist} ${title}`.trim()), title, artist)
      const text = hit ? await scrape(hit.url) : null
      return text && hit ? { text, url: hit.url } : null
    })(),
    lrclib(title, artist, q.duration ?? 0)
  ])
  const g = gen.status === 'fulfilled' ? gen.value : null
  const synced = lrc.status === 'fulfilled' ? lrc.value : null
  if (gen.status === 'rejected') console.log('[lyrics] genius:', String(gen.reason))
  if (lrc.status === 'rejected') console.log('[lyrics] lrclib:', String(lrc.reason))

  let result: LyricsResult | null = null
  if (g) result = { text: g.text, source: 'Genius', url: g.url, synced: synced ?? undefined }
  else if (synced) result = { text: synced.map((l) => l.text).join('\n'), source: 'LRCLIB', synced }
  cache.set(key, result)
  return result
}
