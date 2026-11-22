import type { Item } from '@shared/types'

export type View =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'artist'; browseId?: string; artistName: string }
  | { name: 'playlist'; browseId: string; title: string; subtitle?: string; thumbnail?: string; playlistId?: string }

export function playItem(it: Item) {
  if (it.videoId) window.ytm.command({ type: 'playTrack', videoId: it.videoId, playlistId: it.playlistId })
  else if (it.playlistId) window.ytm.command({ type: 'playPlaylist', playlistId: it.playlistId })
}

/** What opening a card/row should show (null = not openable). */
export function openTarget(it: Item): View | null {
  const id = it.browseId
  if (!id) return null
  if (it.kind === 'artist' || /^UC/.test(id)) return { name: 'artist', browseId: id, artistName: it.title }
  const playlistId = it.playlistId ?? (/^(PL|RD|OLAK|LM$)/.test(id) ? id : id.startsWith('VL') ? id.slice(2) : undefined)
  return { name: 'playlist', browseId: id, title: it.title, subtitle: it.subtitle, thumbnail: it.thumbnail, playlistId }
}

/** Open an artist profile from anywhere (by YouTube Music channel id, or just a name to look up). */
export const openArtist = (a: { name: string; browseId?: string }) =>
  window.dispatchEvent(new CustomEvent('triad:open-artist', { detail: a }))

/** Open an album page from anywhere: by browse id when known, otherwise looked up by name. */
export const openAlbum = (a: { title: string; artist?: string; browseId?: string }) =>
  window.dispatchEvent(new CustomEvent('triad:open-album', { detail: a }))

export interface SongRef {
  videoId: string; title: string; artist?: string; thumbnail?: string
  album?: string; albumId?: string
  artists?: { name: string; browseId?: string }[]
  /** set when the song is shown inside a playlist you can edit */
  playlist?: { id: string; setVideoId?: string; prevSetVideoId?: string; nextSetVideoId?: string; reload: () => void }
}
/** Right-click menu for a song (play, add to playlist, go to artist, copy link). */
export function openSongMenu(song: SongRef, e: { preventDefault(): void; clientX: number; clientY: number }) {
  e.preventDefault()
  window.dispatchEvent(new CustomEvent('triad:song-menu', { detail: { song, x: e.clientX, y: e.clientY } }))
}
export const toast = (message: string) => window.dispatchEvent(new CustomEvent('triad:toast', { detail: message }))
