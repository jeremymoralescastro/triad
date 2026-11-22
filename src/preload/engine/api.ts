import { webFrame } from 'electron'
import { log } from './commands'
import type { Item, ItemKind, QueueItem, RpcMap, RpcMethod, Shelf } from '@shared/types'

const ORIGIN = 'https://music.youtube.com'
const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF' // YT Music search filter: Songs only
const VIDEOS_FILTER = 'EgWKAQIQAWoMEA4QChADEAQQCRAF' // ... Videos only
const ARTISTS_FILTER = 'EgWKAQIgAWoMEA4QChADEAQQCRAF' // ... Artists only

/* ------------------------------------------------------------------ innertube client ----
 * We call YT Music's own web API (youtubei) from inside the logged-in page, exactly like the
 * site does: same cookies, same client context, SAPISIDHASH auth. No stream URLs are touched —
 * audio still plays through YouTube's own player in the hidden window.
 */
async function pageConfig(): Promise<{ key: string; context: unknown }> {
  for (let i = 0; i < 40; i++) {            // wait up to ~10s for the page to finish booting
    const cfg = await webFrame.executeJavaScript(`(() => {
      const c = window.ytcfg;
      if (!c || !c.get) return null;
      const key = c.get('INNERTUBE_API_KEY'), context = c.get('INNERTUBE_CONTEXT');
      return key && context ? { key, context } : null;
    })()`)
    if (cfg) return cfg
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('YouTube Music page not ready (no ytcfg). Is the engine window loaded?')
}

async function sapisidHash(): Promise<string | null> {
  const sid = document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/)?.[1]
  if (!sid) return null
  const ts = Math.floor(Date.now() / 1000)
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sid} ${ORIGIN}`))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `SAPISIDHASH ${ts}_${hex}`
}

async function innertube(endpoint: string, body: Record<string, unknown>) {
  const { key, context } = await pageConfig()
  const auth = await sapisidHash()
  const res = await fetch(`${ORIGIN}/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-goog-authuser': '0',
      'x-origin': ORIGIN,
      ...(auth ? { authorization: auth } : {})
    },
    body: JSON.stringify({ context, ...body })
  })
  if (!res.ok) throw new Error(`youtubei/${endpoint} → HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  return res.json()
}

/* ------------------------------------------------------------------ response → clean JSON ---- */
type Any = any
const runsText = (t: Any): string => (t?.runs ?? []).map((r: Any) => r.text).join('')
const lastThumb = (t: Any): string | undefined => {
  const a = t?.thumbnails
  return a?.length ? a[a.length - 1].url : undefined
}

function* walk(node: Any): Generator<Any> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n) }
  else if (node && typeof node === 'object') { yield node; for (const k in node) yield* walk(node[k]) }
}

const PAGE_KIND: Record<string, ItemKind> = {
  MUSIC_PAGE_TYPE_ALBUM: 'album', MUSIC_PAGE_TYPE_AUDIOBOOK: 'album',
  MUSIC_PAGE_TYPE_PLAYLIST: 'playlist', MUSIC_PAGE_TYPE_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_USER_CHANNEL: 'artist'
}

function playEndpoint(overlay: Any) {
  const pe = overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
  return {
    videoId: pe?.watchEndpoint?.videoId as string | undefined,
    playlistId: (pe?.watchEndpoint?.playlistId ?? pe?.watchPlaylistEndpoint?.playlistId) as string | undefined
  }
}

const pageTypeOf = (be: Any): string | undefined =>
  be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType

/** Clickable artist credits out of a "Artist • Album • 3:20"-style run list. */
function artistsFromRuns(t: Any): { name: string; browseId?: string }[] | undefined {
  const out = (t?.runs ?? [])
    .filter((r: Any) => pageTypeOf(r.navigationEndpoint?.browseEndpoint) === 'MUSIC_PAGE_TYPE_ARTIST' || pageTypeOf(r.navigationEndpoint?.browseEndpoint) === 'MUSIC_PAGE_TYPE_USER_CHANNEL')
    .map((r: Any) => ({ name: String(r.text), browseId: r.navigationEndpoint.browseEndpoint.browseId as string }))
  return out.length ? out : undefined
}

function toItem(c: Any): Item | null {
  const r = c.musicResponsiveListItemRenderer
  if (r) {
    const col = (i: number) => r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text
    const { videoId: ov, playlistId } = playEndpoint(r.overlay)
    const videoId = r.playlistItemData?.videoId ?? ov
    const be = r.navigationEndpoint?.browseEndpoint
    const kind: ItemKind = videoId ? 'song'
      : PAGE_KIND[be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType] ?? 'other'
    const title = runsText(col(0))
    if (!title) return null
    const c1 = runsText(col(1))
    const albumRun = col(2)?.runs?.find((x: Any) => x.navigationEndpoint?.browseEndpoint)
    const album = albumRun?.text as string | undefined
    const albumId = albumRun?.navigationEndpoint?.browseEndpoint?.browseId as string | undefined
    const dur = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text
    return {
      kind, title, subtitle: c1, artist: album ? c1 : undefined, album, artists: artistsFromRuns(col(1)),
      duration: dur ? runsText(dur) : undefined,
      thumbnail: lastThumb(r.thumbnail?.musicThumbnailRenderer?.thumbnail),
      videoId, playlistId, browseId: be?.browseId, albumId,
      setVideoId: r.playlistItemData?.playlistSetVideoId as string | undefined
    }
  }
  const t = c.musicTwoRowItemRenderer
  if (t) {
    const { videoId: ov, playlistId } = playEndpoint(t.thumbnailOverlay)
    const be = t.navigationEndpoint?.browseEndpoint
    const videoId = t.navigationEndpoint?.watchEndpoint?.videoId ?? ov
    const kind: ItemKind = videoId ? 'song'
      : PAGE_KIND[be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType] ?? 'other'
    return {
      kind, title: runsText(t.title), subtitle: runsText(t.subtitle), artists: artistsFromRuns(t.subtitle),
      thumbnail: lastThumb(t.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail),
      videoId, playlistId, browseId: be?.browseId
    }
  }
  return null
}

const items = (contents: Any[] = []) => contents.map(toItem).filter((x): x is Item => !!x)

/** Collects every shelf-like container in a response, whatever page it came from. */
function parseShelves(root: Any): Shelf[] {
  const out: Shelf[] = []
  for (const n of walk(root)) {
    const car = n.musicCarouselShelfRenderer
    if (car) {
      out.push({ title: runsText(car.header?.musicCarouselShelfBasicHeaderRenderer?.title), items: items(car.contents) })
      continue
    }
    const card = n.musicCardShelfRenderer            // search "Top result" (exact title / artist match)
    if (card) {
      const ep = card.title?.runs?.[0]?.navigationEndpoint
      const videoId = ep?.watchEndpoint?.videoId ?? card.onTap?.watchEndpoint?.videoId
      const be = ep?.browseEndpoint
      const title = runsText(card.title)
      if (title) {
        const top: Item = {
          kind: videoId ? 'song' : PAGE_KIND[be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType] ?? 'other',
          title, subtitle: runsText(card.subtitle),
          thumbnail: lastThumb(card.thumbnail?.musicThumbnailRenderer?.thumbnail),
          videoId, playlistId: card.onTap?.watchEndpoint?.playlistId, browseId: be?.browseId
        }
        out.push({ title: 'Top result', items: [top] })
      }
    }
    const shelf = n.musicShelfRenderer ?? n.musicPlaylistShelfRenderer
    if (shelf) out.push({ title: runsText(shelf.title), items: items(shelf.contents) })
    const grid = n.gridRenderer
    if (grid) out.push({ title: '', items: items(grid.items) })
  }
  return out.filter((s) => s.items.length)
}

/* ------------------------------------------------------------------ public RPC surface ---- */
const handlers: { [K in RpcMethod]: (a: RpcMap[K]['args']) => Promise<RpcMap[K]['result']> } = {
  // signed-in account's display name (first name is taken in the UI)
  account: async () => {
    const bodies = [
      { deviceTheme: 'DEVICE_THEME_SELECTED', userInterfaceTheme: 'USER_INTERFACE_THEME_DARK' },
      {}
    ]
    for (const body of bodies) {
      try {
        const res = await innertube('account/account_menu', body)
        for (const n of walk(res)) {
          const an = n.accountName
          const name = an && (typeof an === 'object' ? (runsText(an) || an.simpleText) : '')
          if (name) return { name: String(name) }
        }
        log(`account: no accountName in response (keys: ${Object.keys(res ?? {}).join(',')})`)
      } catch (e) { log(`account failed: ${e}`) }
    }
    return null
  },
  // Two queries in parallel: the normal mixed search (Top result, artists, albums, playlists) and the
  // "Songs"-only filter, which returns a much longer, title-ranked song list than the mixed page's 4 rows.
  search: async ({ query }) => {
    const [mixed, songs] = await Promise.allSettled([
      innertube('search', { query }),
      innertube('search', { query, params: SONGS_FILTER })
    ])
    if (mixed.status === 'rejected' && songs.status === 'rejected') throw mixed.reason
    const m = mixed.status === 'fulfilled' ? parseShelves(mixed.value) : []
    const songItems = songs.status === 'fulfilled' ? parseShelves(songs.value).flatMap((sh) => sh.items).filter((i) => i.kind === 'song') : []
    log(`search "${query}": mixed ${m.map((x) => `${x.title}(${x.items.length})`).join(', ')} | songs-filter ${songItems.length}`)
    const top = m.filter((x) => x.title === 'Top result')
    const mixedSongs = m.filter((x) => x.title === 'Songs')
    const rest = m.filter((x) => x.title !== 'Top result' && x.title !== 'Songs')
    return [
      ...top,
      ...(songItems.length ? [{ title: 'Songs', items: songItems }] : mixedSongs),
      ...rest
    ]
  },
  // Artist profile: header (name / photo / listeners / bio) + the artist page's shelves (songs, albums, singles, videos, related).
  artist: async ({ browseId, name }) => {
    let id = browseId
    if (!id && name) {
      const res = parseShelves(await innertube('search', { query: name, params: ARTISTS_FILTER }))
      const arts = res.flatMap((sh) => sh.items).filter((i) => i.kind === 'artist' && i.browseId)
      const n = name.toLowerCase()
      id = (arts.find((a) => a.title.toLowerCase() === n) ?? arts[0])?.browseId
    }
    if (!id) return null
    const res = await innertube('browse', { browseId: id })
    let header: Any
    for (const n of walk(res)) { header = n.musicImmersiveHeaderRenderer ?? n.musicVisualHeaderRenderer ?? n.musicHeaderRenderer; if (header) break }
    return {
      browseId: id,
      name: runsText(header?.title) || name || 'Artist',
      thumbnail: lastThumb((header?.thumbnail?.musicThumbnailRenderer ?? header?.foregroundThumbnail?.musicThumbnailRenderer)?.thumbnail),
      subscribers: runsText(header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText) || undefined,
      description: runsText(header?.description) || undefined,
      shelves: parseShelves(res)
    }
  },
  // New playlist from a name: an EMPTY private playlist (the playlist page suggests songs to add with a + button).
  createPlaylist: async ({ name }) => {
    const title = name.trim().slice(0, 100)
    if (!title) throw new Error('Give the playlist a name.')
    const res = await innertube('playlist/create', { title, description: 'Created with Triad', privacyStatus: 'PRIVATE' })
    const playlistId = res?.playlistId as string | undefined
    if (!playlistId) throw new Error('YouTube Music did not create the playlist.')
    log(`created empty playlist "${title}" → ${playlistId}`)
    return { playlistId, title, count: 0 }
  },
  // Liked Music is a "like"; any other playlist gets the track appended (duplicates are skipped)
  addToPlaylist: async ({ playlistId, videoId }) => {
    const id = playlistId.replace(/^VL/, '')
    const res = id === 'LM'
      ? await innertube('like/like', { target: { videoId } })
      : await innertube('browse/edit_playlist', { playlistId: id, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }] })
    if (res?.status && res.status !== 'STATUS_SUCCEEDED') throw new Error(`YouTube Music said ${res.status}`)
    log(`added ${videoId} to ${id}`)
    return { ok: true as const }
  },
  // What's coming up after the current song (YouTube's own order for the playlist / radio it's playing from)
  queue: async ({ videoId, playlistId }) => {
    const res = await innertube('next', { videoId, ...(playlistId ? { playlistId } : {}), isAudioOnly: true })
    const all: QueueItem[] = []
    for (const n of walk(res)) {
      const r = n.playlistPanelVideoRenderer
      if (!r?.videoId || all.some((x) => x.videoId === r.videoId)) continue
      all.push({
        videoId: r.videoId, title: runsText(r.title),
        artist: runsText(r.longBylineText).split(' • ')[0], thumbnail: lastThumb(r.thumbnail)
      })
    }
    const i = all.findIndex((x) => x.videoId === videoId)
    return all.slice(i + 1, i + 31)
  },
  // The music-video version of a song: YouTube Music lists it as the "counterpart" in the watch-next response;
  // failing that, search the Videos tab for the title.
  musicVideo: async ({ videoId, title, artist }) => {
    const mvt = (r: Any) => r?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType as string | undefined
    const isVideo = (t?: string) => !!t && /OMV|UGC|OFFICIAL_SOURCE/.test(t)
    const res = await innertube('next', { videoId })
    for (const n of walk(res)) {
      const w = n.playlistPanelVideoWrapperRenderer
      if (!w) continue
      const prim = w.primaryRenderer?.playlistPanelVideoRenderer
      if (prim && prim.videoId !== videoId && !(w.counterpart ?? []).some((c: Any) => c.counterpartRenderer?.playlistPanelVideoRenderer?.videoId === videoId)) continue
      for (const r of [prim, ...(w.counterpart ?? []).map((c: Any) => c.counterpartRenderer?.playlistPanelVideoRenderer)]) {
        if (r?.videoId && isVideo(mvt(r))) return r.videoId as string
      }
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const want = norm((title ?? '').replace(/\s*[\(\[].*?[\)\]]/g, ''))
    if (want.length < 3) return null
    const found = parseShelves(await innertube('search', { query: `${artist ?? ''} ${title ?? ''}`.trim(), params: VIDEOS_FILTER }))
      .flatMap((s) => s.items).filter((i) => i.videoId)
    return found.find((i) => norm(i.title).includes(want))?.videoId ?? null
  },
  suggest: async ({ query }) => {
    const q = query.trim()
    if (!q) return []
    const res = await innertube('music/get_search_suggestions', { input: q })
    const out: string[] = []
    for (const n of walk(res)) { const r = n.searchSuggestionRenderer; const t = r && runsText(r.suggestion); if (t) out.push(t) }
    return [...new Set(out)].slice(0, 8)
  },
  removeFromPlaylist: async ({ playlistId, videoId, setVideoId }) => {
    const id = playlistId.replace(/^VL/, '')
    if (id === 'LM') await innertube('like/removelike', { target: { videoId } })       // Liked Music: un-like it
    else await innertube('browse/edit_playlist', { playlistId: id, actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: videoId, ...(setVideoId ? { setVideoId } : {}) }] })
    return { ok: true as const }
  },
  moveInPlaylist: async ({ playlistId, setVideoId, beforeSetVideoId }) => {
    await innertube('browse/edit_playlist', { playlistId: playlistId.replace(/^VL/, ''), actions: [{ action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId, movedSetVideoId: beforeSetVideoId }] })
    return { ok: true as const }
  },
  renamePlaylist: async ({ playlistId, name }) => {
    const n = name.trim().slice(0, 100)
    if (!n) throw new Error('The name can’t be empty.')
    await innertube('browse/edit_playlist', { playlistId: playlistId.replace(/^VL/, ''), actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: n }] })
    return { ok: true as const }
  },
  // your own playlist → deleted; one you only saved → removed from your library instead
  deletePlaylist: async ({ playlistId }) => {
    const id = playlistId.replace(/^VL/, '')
    try { await innertube('playlist/delete', { playlistId: id }) }
    catch (e) { log(`playlist/delete failed (${e}); trying remove-from-library`); await innertube('like/removelike', { target: { playlistId: id } }) }
    return { ok: true as const }
  },
  home: async () => parseShelves(await innertube('browse', { browseId: 'FEmusic_home' })),
  library: async () => parseShelves(await innertube('browse', { browseId: 'FEmusic_liked_playlists' })),
  // Only real playlist ids get the "VL" prefix. Artists (UC…), albums (MPRE…) and already-prefixed ids pass through.
  playlist: async ({ browseId }) =>
    parseShelves(await innertube('browse', { browseId: /^(PL|RD|OLAK|LM$|SE$)/.test(browseId) ? `VL${browseId}` : browseId }))
  ,
  // Lyrics: watch-next response → the "Lyrics" tab's browseId (MPLY…) → description text
  lyrics: async ({ videoId }) => {
    const next = await innertube('next', { videoId, isAudioOnly: true })
    let browseId: string | undefined
    for (const n of walk(next)) {
      const id = n.tabRenderer?.endpoint?.browseEndpoint?.browseId
      if (typeof id === 'string' && id.startsWith('MPLY')) { browseId = id; break }
    }
    if (!browseId) return null
    const res = await innertube('browse', { browseId })
    for (const n of walk(res)) {
      const d = n.musicDescriptionShelfRenderer
      if (d) return { text: runsText(d.description), source: runsText(d.footer) || undefined }
    }
    return null
  }
}

export function rpc<K extends RpcMethod>(method: K, args: RpcMap[K]['args']): Promise<RpcMap[K]['result']> {
  const h = handlers[method]
  if (!h) throw new Error(`unknown RPC method ${method}`)
  return h(args)
}
