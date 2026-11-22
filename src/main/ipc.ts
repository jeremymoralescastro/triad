import { BrowserWindow, dialog, globalShortcut, ipcMain, session, shell } from 'electron'
import { getLyrics } from './lyrics'
import { clearStats, getStats, trackListening } from './stats'
import { getSettings, setSettings } from './settings'
import { holdSessionSaves, loadSession, saveSession } from './session'
import { BUILT_IN_APP_ID, discord } from './discord'
import { closeVideo, openVideo, syncVideo } from './videoWindow'
import { openLogin, openScChallenge, openScLogin, setScLight, SC_PARTITION, SC_URL, YTM_PARTITION, YTM_URL } from './windows'
import { browserName, findBrowser, startBrowserSignIn, type BrowserSignIn } from './browserLogin'
import { importCookieFile, setCookies } from './cookies'
import { CH, emptyState, type Backend, type Command, type LoginStatus, type MainSettings, type PlayerState, type RpcMethod } from '@shared/types'

export function wireIpc(first: BrowserWindow, firstBackend: Backend, makeEngine: (b: Backend) => Promise<BrowserWindow>, ui: BrowserWindow) {
  const engines: Partial<Record<Backend, BrowserWindow>> = { [firstBackend]: first }
  let backend: Backend = firstBackend
  let engine = first                        // the engine of the service that's active right now
  let state: PlayerState = { ...emptyState, engineReady: true, backend }
  let volTimer: ReturnType<typeof setTimeout> | undefined

  // ---- engine -> UI: merge partial state, forward ----
  ipcMain.on(CH.engineState, (e, patch: Partial<PlayerState>) => {
    if (e.sender !== engine.webContents) return           // the other (idle) service's page: ignore
    state = { ...state, ...patch, backend }
    if (backend === 'sc' && state.loggedIn && engine.isVisible()) engine.hide()    // signed in: put the sign-in window away
    trackListening(state)
    saveSession(state)
    discord.update(state)
    syncVideo(state)
    if (!ui.isDestroyed()) ui.webContents.send(CH.state, state)
  })
  ipcMain.handle(CH.getState, () => state)

  // ---- diagnostics: shows up in the terminal where you ran `npm run dev` ----
  ipcMain.on(CH.engineLog, (_e, msg: string) => console.log('[engine]', msg))
  // the SoundCloud page reloads / redirects while it starts up; requests sent meanwhile would be lost, so hold them until its player reports ready
  const pageReady = new WeakMap<Electron.WebContents, boolean>()
  ipcMain.on(CH.scFull, (e) => { setSettings({ scFull: true }); setScLight(false); e.sender.reloadIgnoringCache() })     // light mode found no page data: use the full page
  ipcMain.on(CH.engineReady, (e) => { pageReady.set(e.sender, true) })
  const whenReady = (w: BrowserWindow) => backend !== 'sc' || pageReady.get(w.webContents) !== false ? Promise.resolve() : new Promise<void>((res) => {
    const iv = setInterval(() => { if (pageReady.get(w.webContents) !== false || w.isDestroyed()) { clearInterval(iv); clearTimeout(to); res() } }, 100)
    const to = setTimeout(() => { clearInterval(iv); res() }, 6_000)
  })
  const adopt = (w: BrowserWindow) => {
    if (backend === 'sc' || w !== first) pageReady.set(w.webContents, false)            // a SoundCloud page that's still loading can't take requests yet
    w.webContents.on('did-start-loading', () => pageReady.set(w.webContents, false))
    // YouTube Music sets a "Leave site?" (beforeunload) prompt while music plays; Electron then silently cancels
    // our navigation to the next track. Always allow the unload.
    w.webContents.on('will-prevent-unload', (e) => e.preventDefault())
    w.webContents.on('did-navigate-in-page', (_e, url) => console.log('[engine] in-page →', url))
    w.webContents.on('did-navigate', (_e, url) => console.log('[engine] page →', url))
    w.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain) console.log('[engine] LOAD FAILED', code, desc, url) })
    w.webContents.on('did-finish-load', () => { if (w === engine) { send({ type: 'eq', gains: eqGains() }); if (backend === 'sc') send({ type: 'volume', value: getSettings().volume }) } })   // every YTM track start can be a page load
  }
  // SoundCloud sign-in: once the page leaves /signin (it's logged in now), reload it once so the player picks up the new session
  let scLoginReload = false
  let scChallenge = false
  const watchScLogin = (w: BrowserWindow) => {
    const check = (_e: unknown, url: string) => {
      if (w !== engine || !w.isVisible()) return
      let u: URL; try { u = new URL(url) } catch { return }
      if (scChallenge && /(^|\.)soundcloud\.com$/.test(u.hostname)) {         // captcha solved: tidy up and reload the player
        scChallenge = false
        setTimeout(() => { if (!w.isDestroyed()) { w.hide(); setScLight(true); w.webContents.reloadIgnoringCache() } }, 900)
        return
      }
      if (!scLoginReload) return
      if (!/(^|\.)soundcloud\.com$/.test(u.hostname) || /^\/(signin|connect|login|authorize)/.test(u.pathname)) return
      scLoginReload = false
      setTimeout(() => { if (!w.isDestroyed()) { setScLight(true); w.webContents.reloadIgnoringCache() } }, 1200)
    }
    w.webContents.on('did-navigate', check); w.webContents.on('did-navigate-in-page', check)
  }
  adopt(first)
  if (firstBackend === 'sc') watchScLogin(first)

  // ---- UI -> engine: fire-and-forget commands ----
  const send = (cmd: Command) => { const w = engine; void whenReady(w).then(() => { if (!w.isDestroyed()) w.webContents.send(CH.engineCommand, cmd) }) }
  ipcMain.on(CH.command, (_e, cmd: Command) => {
    send(cmd)
    if (cmd.type === 'volume' && cmd.value > 0) {           // the saved volume only changes when YOU change it
      clearTimeout(volTimer); const v = Math.round(cmd.value * 10) / 10
      volTimer = setTimeout(() => setSettings({ volume: v }), 500)
    }
  })

  // ---- UI -> engine: request/response (search, home, library …) ----
  let seq = 0
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; t: NodeJS.Timeout }>()
  ipcMain.handle(CH.rpc, async (_e, method: RpcMethod, args: unknown) => {
    const target = engine
    await whenReady(target)
    return new Promise((resolve, reject) => {
      const id = ++seq
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`engine RPC "${method}" timed out`)) }, 20_000)
      pending.set(id, { resolve, reject, t })
      target.webContents.send(CH.engineRpc, { id, method, args })
    })
  })
  ipcMain.on(CH.engineRpcResult, (_e, r: { id: number; ok: boolean; data?: unknown; error?: string }) => {
    const p = pending.get(r.id); if (!p) return
    clearTimeout(p.t); pending.delete(r.id)
    if (!r.ok && backend === 'sc') {
      const ch = r.error?.match(/https:\/\/geo\.captcha-delivery\.com\S+/)?.[0]
      void ch                                  // (no pop-up: a bot check on a write just means "couldn't do that")
    }
    r.ok ? p.resolve(r.data) : p.reject(new Error((r.error ?? 'engine error').replace(/ https:\/\/geo\.captcha-delivery\.com\S+/, '')))
  })

  ipcMain.handle(CH.stats, () => getStats())

  // ---- Genius lyrics (fetched in main; failures just mean "no lyrics", the UI falls back) ----
  ipcMain.handle(CH.lyrics, (_e, q: { title: string; artist: string; duration?: number }) =>
    getLyrics(q).catch((err) => { console.log('[lyrics]', String(err)); return null }))
  ipcMain.on(CH.videoOpen, (_e, a: { videoId: string; at: number }) => openVideo(a.videoId, a.at, ui))
  ipcMain.on(CH.videoClose, () => closeVideo())
  ipcMain.on(CH.engineVideoFrame, (_e, buf: Uint8Array) => { if (!ui.isDestroyed()) ui.webContents.send(CH.videoFrame, buf) })
  ipcMain.on(CH.titleBar, (_e, light: boolean) => { try { ui.setTitleBarOverlay({ color: '#00000000', symbolColor: light ? '#2a2a2a' : '#ffffff', height: 44 }) } catch { /* not supported here */ } })
  ipcMain.on(CH.openExternal, (_e, url: string) => { if (/^https:\/\/(genius\.com|discord\.com\/developers)\//.test(url)) shell.openExternal(url) })

  // ---- login: reveal the hidden engine window so you can sign in to Google ----
  // ---- switch between YouTube Music and SoundCloud ----
  ipcMain.handle(CH.setBackend, async (_e, b: Backend) => {
    if (b === backend || (b !== 'ytm' && b !== 'sc')) return
    send({ type: 'pause' }); closeVideo()
    engines[b] ??= await makeEngine(b).then((w) => { adopt(w); if (b === 'sc') watchScLogin(w); return w })
    engine = engines[b]!; backend = b
    setSettings({ backend: b })
    state = { ...emptyState, engineReady: true, backend: b, volume: state.volume }
    send({ type: 'eq', gains: eqGains() }); send({ type: 'volume', value: getSettings().volume })
    resumeLast()
    if (!ui.isDestroyed()) { ui.webContents.send(CH.state, state); ui.webContents.reload() }   // every view refetches from the new service
  })
  ipcMain.on(CH.showLogin, () => (backend === 'sc' ? (scLoginReload = true, openScLogin(engine)) : openLogin(engines.ytm ?? engine)))

  // ---- login via the user's real browser (Chrome/Edge) + cookie transfer ----
  const ses = session.fromPartition(YTM_PARTITION)
  const status = (s: LoginStatus) => { if (!ui.isDestroyed()) ui.webContents.send(CH.loginStatus, s) }
  // after new cookies are in, reload the engine and confirm it actually became logged in
  const reloadAndVerify = () => {
    engines.ytm?.loadURL(YTM_URL)
    setTimeout(() => {
      if (state.loggedIn) status({ kind: 'done' })
      else status({ kind: 'failed', message: "Signed in, but YouTube Music didn't accept the session. Try \"Use cookies.txt\" instead." })
    }, 15_000)
  }
  let signIn: BrowserSignIn | null = null
  ipcMain.on(CH.signIn, async () => {
    if (signIn) return
    if (backend === 'sc') { scLoginReload = true; openScLogin(engine); status({ kind: 'fallback' }); return }      // SoundCloud: sign in right in the window
    const exe = findBrowser()
    if (!exe) { status({ kind: 'fallback' }); openLogin(engine); return }
    status({ kind: 'waiting', browser: browserName(exe) })
    const attempt = (signIn = startBrowserSignIn(exe))
    const r = await attempt.done
    signIn = null
    if (r.kind === 'cookies') {
      status({ kind: 'importing' })
      const n = await setCookies(ses, r.cookies)
      console.log(`[login] imported ${n} cookies from browser`)
      if (n === 0) status({ kind: 'failed', message: 'No cookies were imported.' })
      else reloadAndVerify()
    } else if (r.kind === 'cancelled') status({ kind: 'idle' })
    else status({ kind: 'failed', message: r.message })
  })
  ipcMain.on(CH.cancelSignIn, () => { signIn?.cancel(); status({ kind: 'idle' }) })

  // ---- sign out: wipe the engine's Google/YouTube login, reload logged-out ----
  ipcMain.handle(CH.signOut, async () => {
    if (backend === 'sc') {
      const sc = session.fromPartition(SC_PARTITION)
      try { await sc.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }); await sc.cookies.flushStore() } catch (e) { console.log('[login] sign-out', String(e)) }
      state = { ...emptyState, engineReady: true, backend, volume: state.volume }
      if (!ui.isDestroyed()) ui.webContents.send(CH.state, state)
      status({ kind: 'idle' }); engine.loadURL(SC_URL); return
    }
    try { await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }) } catch (e) { console.log('[login] sign-out', String(e)) }
    await ses.cookies.flushStore()
    state = { ...emptyState, engineReady: true, loggedIn: false }
    if (!ui.isDestroyed()) ui.webContents.send(CH.state, state)
    status({ kind: 'idle' })
    engines.ytm?.loadURL(YTM_URL)     // stops playback and comes back as a signed-out page
  })

  // ---- login via a cookies.txt the user picks ----
  ipcMain.handle(CH.importCookies, async () => {
    const pick = await dialog.showOpenDialog(ui, {
      title: 'Choose your cookies.txt', properties: ['openFile'],
      filters: [{ name: 'cookies.txt', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (pick.canceled || !pick.filePaths[0]) return null
    try {
      const count = await importCookieFile(ses, pick.filePaths[0])
      if (!count) return { ok: false, message: "That file didn't contain any Google/YouTube cookies." }
      reloadAndVerify()
      return { ok: true, count }
    } catch (err) { return { ok: false, message: String((err as Error).message ?? err) } }
  })

  // ---- Windows 11 media keys / SMTC ----
  // Chromium already publishes the engine's navigator.mediaSession to SMTC and handles the
  // hardware media keys (play/pause/next/prev) natively. Do NOT also register MediaPlayPause
  // globally or it will fire twice. These are extra, optional hotkeys:
  const hk: Record<string, Command> = {
    'CommandOrControl+Alt+Space': { type: 'togglePlay' },
    'CommandOrControl+Alt+Right': { type: 'next' },
    'CommandOrControl+Alt+Left': { type: 'previous' },
    'CommandOrControl+Alt+Up': { type: 'volume', value: Math.min(100, state.volume + 5) },
    'CommandOrControl+Alt+Down': { type: 'volume', value: Math.max(0, state.volume - 5) }
  }
  const registerHotkeys = () => {
    for (const [accel, cmd] of Object.entries(hk)) {
      globalShortcut.register(accel, () =>
        send(cmd.type === 'volume'
          ? { type: 'volume', value: Math.max(0, Math.min(100, state.volume + (accel.endsWith('Up') ? 5 : -5))) }
          : cmd))
    }
  }
  const unregisterHotkeys = () => { for (const accel of Object.keys(hk)) globalShortcut.unregister(accel) }
  if (getSettings().hotkeys) registerHotkeys()

  // ---- Settings window: things only the main process can apply ----
  const eqGains = () => { const c = getSettings(); return c.eqEnabled ? c.eq : c.eq.map(() => 0) }   // EQ off = flat
  ipcMain.handle(CH.settingsGet, () => ({ ...getSettings(), discordBuiltIn: !!BUILT_IN_APP_ID }))
  ipcMain.handle(CH.settingsSet, (_e, patch: Partial<MainSettings>) => {
    const was = getSettings().hotkeys
    const next = setSettings(patch)
    if (next.hotkeys !== was) next.hotkeys ? registerHotkeys() : unregisterHotkeys()
    if (patch.eq || 'eqEnabled' in patch) send({ type: 'eq', gains: eqGains() })
    if ('discord' in patch || 'discordClientId' in patch) discord.configure(next.discord, next.discordClientId)
    return next
  })
  ipcMain.handle(CH.clearHistory, () => { clearStats() })

  // ---- startup: restore the equalizer, Discord, and reopen the last song (paused, at the same spot) ----
  send({ type: 'eq', gains: eqGains() })
  discord.configure(getSettings().discord, getSettings().discordClientId)
  const resumeLast = () => {
    const last = loadSession(backend)
    if (last && last.videoId) {
      holdSessionSaves()
      setTimeout(() => send({ type: 'resume', videoId: last.videoId, playlistId: last.playlistId ?? undefined, seconds: last.currentTime }), 800)
    }
  }
  if (backend === 'sc') send({ type: 'volume', value: getSettings().volume })
  resumeLast()
}
