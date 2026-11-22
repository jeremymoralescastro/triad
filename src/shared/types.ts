export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT'

export interface QueueItem { videoId: string; title: string; artist: string; thumbnail?: string }

export interface Fx { reverb: number; flanger: number }   // how much of each effect is mixed in, 0..1 (0 = off)
export const SPEEDS = [0.5, 1, 1.25, 1.5, 2, 2.5]

export type Backend = 'ytm' | 'sc'   // YouTube Music or SoundCloud

export interface PlayerState {
  backend: Backend            // which service is playing (set by the main process)
  videoId: string | null
  playlistId: string | null   // the ?list= of the playing page: which playlist/album/radio the queue belongs to
  title: string
  artist: string
  album: string
  artwork: string | null
  paused: boolean
  currentTime: number
  duration: number
  volume: number // 0..100
  likeStatus: LikeStatus
  repeat: 'NONE' | 'ALL' | 'ONE'
  shuffle: boolean
  speed: number               // playback rate; pitch follows it
  fx: Fx                      // reverb / flanger and how much of it is mixed in
  albumId: string             // YouTube Music browse id of the playing song's album ('' if unknown)
  userQueue: QueueItem[]      // songs added with "Play next" / "Add to queue"
  adActive: boolean
  notice: string              // a short message for the user ("stamp|text"), e.g. a song that can't be played
  loggedIn: boolean
  engineReady: boolean
}

export const emptyState: PlayerState = {
  backend: 'ytm', videoId: null, playlistId: null, title: '', artist: '', album: '', artwork: null, paused: true,
  currentTime: 0, duration: 0, volume: 100, likeStatus: 'INDIFFERENT', repeat: 'NONE', shuffle: false, albumId: '', speed: 1, fx: { reverb: 0, flanger: 0 }, userQueue: [],
  adActive: false, notice: '', loggedIn: false, engineReady: false
}

export type ItemKind = 'song' | 'album' | 'playlist' | 'artist' | 'other'

export interface Item {
  kind: ItemKind
  title: string
  subtitle: string
  thumbnail?: string
  videoId?: string
  playlistId?: string
  browseId?: string
  artist?: string
  artists?: { name: string; browseId?: string }[]   // clickable artist credits
  albumId?: string                                   // browse id of the row's album
  owned?: boolean                                    // a playlist you made yourself (can be renamed / deleted)
  setVideoId?: string                                // a row's id inside a playlist (needed to remove/move it)
  album?: string
  duration?: string
}

export interface Shelf { title: string; items: Item[] }

export type Command =
  | { type: 'togglePlay' } | { type: 'play' } | { type: 'pause' }
  | { type: 'next' } | { type: 'previous' }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; value: number }
  | { type: 'like' } | { type: 'dislike' } | { type: 'shuffle' } | { type: 'repeat' }
  | { type: 'playTrack'; videoId: string; playlistId?: string }
  | { type: 'playPlaylist'; playlistId: string }
  | { type: 'playPlaylistShuffled'; playlistId: string }
  | { type: 'queueAdd'; item: QueueItem; next: boolean }
  | { type: 'queueRemove'; index: number }
  | { type: 'queueClear' }
  | { type: 'queueMove'; from: number; to: number }
  | { type: 'resume'; videoId: string; playlistId?: string; seconds: number }
  | { type: 'eq'; gains: number[] }
  | { type: 'speed'; value: number }
  | { type: 'fx'; reverb: number; flanger: number }

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error'
  current: string               // the version you're running
  version?: string              // the newer version, if any
  percent?: number              // download progress
  url?: string                  // where to get it, when Triad can't update itself (Mac)
  message?: string
}

/** Listening party: one person hosts, others join with a room code and follow along */
export interface PartyStatus {
  role: 'none' | 'host' | 'guest'
  connected: boolean
  code?: string                 // 12 letters/digits (host: share it; guest: the one you joined)
  listeners?: number            // host: how many are listening right now
  hostName?: string             // guest: the host's name (their account name)
  hostTrack?: string            // guest: what the host is playing
  note?: string                 // e.g. the host is on the other service
}

export interface RpcMap {
  search: { args: { query: string }; result: Shelf[] }
  home: { args: undefined; result: Shelf[] }
  library: { args: undefined; result: Shelf[] }
  playlist: { args: { browseId: string }; result: Shelf[] }
  account: { args: undefined; result: { name: string } | null }
  lyrics: { args: { videoId: string }; result: { text: string; source?: string } | null }
  artist: { args: { browseId?: string; name?: string }; result: ArtistPage | null }
  createPlaylist: { args: { name: string }; result: { playlistId: string; title: string; count: number } }
  musicVideo: { args: { videoId: string; title?: string; artist?: string }; result: string | null }   // id of the video version, if there is one
  queue: { args: { videoId: string; playlistId?: string }; result: QueueItem[] }
  suggest: { args: { query: string }; result: string[] }
  removeFromPlaylist: { args: { playlistId: string; videoId: string; setVideoId?: string }; result: { ok: true } }
  moveInPlaylist: { args: { playlistId: string; setVideoId: string; beforeSetVideoId: string }; result: { ok: true } }
  addToPlaylist: { args: { playlistId: string; videoId: string; videoIds?: string[] }; result: { ok: true } }
  renamePlaylist: { args: { playlistId: string; name: string }; result: { ok: true } }
  deletePlaylist: { args: { playlistId: string }; result: { ok: true } }
}
export interface ArtistPage {
  browseId: string
  name: string
  thumbnail?: string
  subscribers?: string
  description?: string
  shelves: Shelf[]
}

export interface MainSettings {
  launchAtLogin: boolean
  hotkeys: boolean
  trackHistory: boolean
  eq: number[]               // 8 band gains in dB (-12..12)
  volume: number             // 0..100, restored on launch
  eqEnabled: boolean         // off = bypass (the curve is kept)
  discord: boolean           // show what you're listening to on Discord
  discordBuiltIn?: boolean   // set by main: Triad ships its own Discord app, no ID needed
  discordClientId: string    // your Discord application's ID
  backend?: Backend          // last used service
  scFull?: boolean           // SoundCloud's light mode didn't work here: always load the full page
}
export const EQ_FREQS = [60, 150, 350, 800, 1800, 4000, 9000, 14000] as const

/** Local listening history (main process, persisted in the user's data folder). */
export interface StatsResult {
  songs: { videoId: string; title: string; artist: string; artwork: string | null; plays: number }[]
  artists: { name: string; plays: number; artwork: string | null }[]
}
export interface LrcLine { t: number; text: string }
export interface LyricsResult {
  text: string
  source: 'Genius' | 'YouTube Music' | 'LRCLIB'
  url?: string
  synced?: LrcLine[]        // real line timestamps (LRCLIB), when available
}

export type RpcMethod = keyof RpcMap

/** Progress of the "sign in with your browser" flow, main -> UI. */
export type LoginStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; browser: string }   // browser window is open, waiting for the user to sign in
  | { kind: 'importing' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string }
  | { kind: 'fallback' }                   // no Chrome/Edge found: the old in-app sign-in window was opened


export const CH = {
  // UI -> main
  command: 'ytm:command',
  rpc: 'ytm:rpc',
  getState: 'ytm:get-state',
  showLogin: 'ytm:show-login',
  signIn: 'ytm:sign-in',
  cancelSignIn: 'ytm:cancel-sign-in',
  signOut: 'ytm:sign-out',
  stats: 'ytm:stats',
  settingsGet: 'ytm:settings-get',
  settingsSet: 'ytm:settings-set',
  clearHistory: 'ytm:clear-history',
  importCookies: 'ytm:import-cookies',
  lyrics: 'ytm:lyrics',
  openExternal: 'ytm:open-external',
  titleBar: 'ytm:title-bar',
  setBackend: 'ytm:set-backend',
  aiKey: 'ytm:ai-key',
  aiSuggest: 'ytm:ai-suggest',
  aiStatus: 'ytm:ai-status',
  partyHost: 'ytm:party-host',
  partyJoin: 'ytm:party-join',
  partyLeave: 'ytm:party-leave',
  partyGet: 'ytm:party-get',
  partyStatus: 'ytm:party-status',
  updateGet: 'ytm:update-get',
  updateCheck: 'ytm:update-check',
  updateInstall: 'ytm:update-install',
  updateStatus: 'ytm:update-status',
  videoFrame: 'ytm:video-frame',
  videoOpen: 'ytm:video-open',
  videoClose: 'ytm:video-close',
  videoSync: 'video:sync',
  videoRect: 'video:rect',
  // main -> UI
  state: 'ytm:state',
  loginStatus: 'ytm:login-status',
  // main <-> engine
  engineCommand: 'engine:command',
  engineRpc: 'engine:rpc',
  engineRpcResult: 'engine:rpc-result',
  engineState: 'engine:state',
  engineLog: 'engine:log',
  engineReady: 'engine:ready',
  scFull: 'engine:sc-full',
  engineVideoFrame: 'engine:video-frame'
} as const
