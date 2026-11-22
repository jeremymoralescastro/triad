import type { Item } from '@shared/types'

/**
 * "Smart search": a playlist from a description with NO AI. Words in the description become a few searches; the best songs from those
 * searches, plus the tracks of the top matching playlists, are mixed together (no artist more than twice).
 */
const STOP = new Set(('a an the and or of for with without to in on at by from into that this those these some any my me i we you your our it its is are be been am was were ' +
  'songs song music tracks track playlist playlists mix make give want need like vibe vibes type kind stuff something good great best really very just more most ' +
  'play listen listening feel feeling feels sound sounds about around over under up down out off').split(' '))

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean)
const title = (s: string) => { const t = s.trim().replace(/\s+/g, ' ').slice(0, 50); return t.charAt(0).toUpperCase() + t.slice(1) }

export function smartQueries(desc: string): string[] {
  const all = words(desc)
  const keys = [...new Set(all.filter((w) => !STOP.has(w) && w.length > 1))].slice(0, 6)
  const q = [all.slice(0, 8).join(' '), keys.slice(0, 3).join(' '), keys.slice(1, 4).join(' '), keys.slice(0, 2).join(' ') + ' songs', keys[0] ? `best ${keys[0]} songs` : '']
  return [...new Set(q.map((x) => x.trim()).filter((x) => x.length > 1))].slice(0, 5)
}

const artistOf = (it: Item) => (it.artist || it.subtitle || '').split(/[•,&]/)[0].trim().toLowerCase()

export async function smartSongs(desc: string, count: number): Promise<{ ids: string[]; name: string }> {
  const rpc = window.ytm.rpc
  const queries = smartQueries(desc)
  const searches = await Promise.all(queries.map((query) => rpc('search', { query }).catch(() => [])))
  const direct: Item[][] = searches.map((shelves) => shelves.flatMap((s) => s.items).filter((it) => it.kind === 'song' && it.videoId))
  // the best matching playlists contribute their tracks too
  const lists = searches.flatMap((shelves) => shelves.flatMap((s) => s.items).filter((it) => it.kind === 'playlist' && (it.browseId || it.playlistId)).slice(0, 1)).slice(0, 3)
  const fromLists: Item[][] = await Promise.all(lists.map(async (p) => {
    try {
      const shelves = await rpc('playlist', { browseId: (p.browseId ?? 'VL' + p.playlistId) as string })
      return shelves.flatMap((s) => s.items).filter((it) => it.kind === 'song' && it.videoId).slice(0, 40)
    } catch { return [] }
  }))

  const sources = [...direct, ...fromLists].filter((l) => l.length)
  const ids: string[] = [], seen = new Set<string>(), perArtist = new Map<string, number>()
  const take = (cap: number) => {
    for (let round = 0; ids.length < count; round++) {
      let any = false
      for (const src of sources) {
        const it = src[round]; if (!it) continue
        any = true
        if (ids.length >= count) break
        const a = artistOf(it)
        if (seen.has(it.videoId!) || (perArtist.get(a) ?? 0) >= cap) continue
        seen.add(it.videoId!); ids.push(it.videoId!); perArtist.set(a, (perArtist.get(a) ?? 0) + 1)
      }
      if (!any) break
    }
  }
  take(2)
  if (ids.length < count) take(5)          // not enough variety: allow more from the same artist
  return { ids, name: title(desc) }
}
