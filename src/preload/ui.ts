import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { CH, type Backend, type Command, type LoginStatus, type LyricsResult, type MainSettings, type PlayerState, type RpcMap, type StatsResult, type RpcMethod } from '@shared/types'

/** what the UI has seen of every song (so a click can show the new song instantly) and the last "up next" list */
interface TrackMeta { title: string; artist: string; thumbnail?: string; duration?: string }
const meta = new Map<string, TrackMeta>()
let lastQueue: { videoId: string; title: string; artist: string; thumbnail?: string }[] = []
const scan = (x: any, d = 0): void => {
  if (!x || typeof x !== 'object' || d > 4) return
  if (Array.isArray(x)) { x.forEach((i) => scan(i, d + 1)); return }
  if (typeof x.videoId === 'string' && typeof x.title === 'string') {
    meta.set(x.videoId, { title: x.title, artist: x.artist ?? x.subtitle ?? '', thumbnail: x.thumbnail, duration: x.duration })
    if (meta.size > 4000) meta.delete(meta.keys().next().value as string)
  }
  for (const v of Object.values(x)) if (v && typeof v === 'object') scan(v, d + 1)
}
/** ask the main process; if it hasn't finished starting up yet ("No handler registered"), try again a moment later */
const ask = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  for (let i = 0; ; i++) {
    try { return (await ipcRenderer.invoke(channel, ...args)) as T }
    catch (e) { if (i >= 25 || !/No handler registered/i.test(String(e))) throw e; await new Promise((r) => setTimeout(r, 200)) }
  }
}
const cmdListeners = new Set<(c: Command) => void>()

const api = {
  getState: (): Promise<PlayerState> => ask<PlayerState>(CH.getState),
  onState(cb: (s: PlayerState) => void) {
    const h = (_: unknown, s: PlayerState) => cb(s)
    ipcRenderer.on(CH.state, h)
    return () => ipcRenderer.off(CH.state, h)
  },
  command: (cmd: Command) => { cmdListeners.forEach((f) => { try { f(cmd) } catch { /* ignore */ } }); ipcRenderer.send(CH.command, cmd) },
  /** called right when a command is sent (before the player has answered): lets the UI react instantly */
  onCommand: (cb: (c: Command) => void) => { cmdListeners.add(cb) },
  trackMeta: (videoId: string): TrackMeta | null => meta.get(videoId) ?? null,
  upcoming: () => lastQueue,
  rpc: <K extends RpcMethod>(method: K, args?: RpcMap[K]['args']): Promise<RpcMap[K]['result']> =>
    (ask<RpcMap[K]['result']>(CH.rpc, method, args)).then((r) => { try { scan(r); if (method === 'queue') lastQueue = (r as typeof lastQueue) ?? [] } catch { /* ignore */ } return r }),
  showLogin: () => ipcRenderer.send(CH.showLogin),
  signIn: () => ipcRenderer.send(CH.signIn),
  cancelSignIn: () => ipcRenderer.send(CH.cancelSignIn),
  signOut: (): Promise<void> => ipcRenderer.invoke(CH.signOut),
  importCookies: (): Promise<{ ok: boolean; count?: number; message?: string } | null> => ipcRenderer.invoke(CH.importCookies),
  onLoginStatus(cb: (s: LoginStatus) => void) {
    const h = (_: unknown, s: LoginStatus) => cb(s)
    ipcRenderer.on(CH.loginStatus, h)
    return () => ipcRenderer.off(CH.loginStatus, h)
  },
  getSettings: (): Promise<MainSettings> => ask<MainSettings>(CH.settingsGet),
  setSettings: (patch: Partial<MainSettings>): Promise<MainSettings> => ipcRenderer.invoke(CH.settingsSet, patch),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(CH.clearHistory),
  stats: (): Promise<StatsResult> => ipcRenderer.invoke(CH.stats),
  lyrics: (q: { title: string; artist: string; duration?: number }): Promise<LyricsResult | null> => ipcRenderer.invoke(CH.lyrics, q),
  openExternal: (url: string) => ipcRenderer.send(CH.openExternal, url),
  openVideo: (videoId: string, at: number) => ipcRenderer.send(CH.videoOpen, { videoId, at }),
  closeVideo: () => ipcRenderer.send(CH.videoClose),
  /** music-video frames from the player (JPEGs) while the video pane is open */
  onVideoFrame: (cb: (jpeg: Uint8Array) => void) => {
    const h = (_: unknown, b: Uint8Array) => cb(b)
    ipcRenderer.on(CH.videoFrame, h)
    return () => ipcRenderer.off(CH.videoFrame, h)
  },
  /** zoom the whole interface (1 = 100%) */
  setZoom: (factor: number) => { try { webFrame.setZoomFactor(Math.max(0.5, Math.min(2, factor))) } catch { /* ignore */ } },
  /** light themes need dark window-control icons */
  setBackend: (b: Backend): Promise<void> => ipcRenderer.invoke(CH.setBackend, b),
  setTitleBar: (light: boolean) => ipcRenderer.send(CH.titleBar, light)
}

contextBridge.exposeInMainWorld('ytm', api)
export type YtmApi = typeof api
