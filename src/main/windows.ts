import { join } from 'node:path'
import { BrowserWindow, session, shell } from 'electron'
import { enableAdblock } from './adblock'
import { importCookiesIfPresent } from './cookies'
import { getSettings } from './settings'

const ICON = join(__dirname, '../../resources/icon.png')
export const YTM_PARTITION = 'persist:ytm' // cookies/login persist across restarts
export const SC_PARTITION = 'persist:sc'
export const SC_URL = 'https://soundcloud.com/discover'     // the page everything runs from (the bare address redirects with a script)
export const YTM_URL = 'https://music.youtube.com/'
export const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'

let quitting = false
let loginMode = false
export const markQuitting = () => { quitting = true }

/** Plain-Chrome UA for YouTube Music itself (strip the Electron/app tokens). */
function chromeUA(ses: Electron.Session) {
  return ses.getUserAgent().replace(/\s(Electron|ytm-desk)\/[\d.]+/gi, '')
}

/** Show the hidden engine window on Google's sign-in page (not the YT Music home page). */
export function openLogin(win: BrowserWindow) {
  loginMode = true
  win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent(YTM_URL))
  win.show(); win.focus()
}

export async function createEngineWindow() {
  const ses = session.fromPartition(YTM_PARTITION)
  ses.setUserAgent(chromeUA(ses))
  await enableAdblock(ses)                       // must be active BEFORE the first navigation
  await importCookiesIfPresent(ses)              // optional: login imported from cookies.txt

  // Google's "this browser may not be secure" check: on accounts.google.com only, look like Firefox
  // (drop Chromium client hints too). The preload also spoofs navigator.* in that frame.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (details, cb) => {
    const h = details.requestHeaders
    h['User-Agent'] = FIREFOX_UA
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k]
    cb({ requestHeaders: h })
  })

  const win = new BrowserWindow({
    show: false, width: 1100, height: 800, title: 'Triad – sign in to YouTube Music', icon: ICON,
    webPreferences: {
      partition: YTM_PARTITION,
      preload: join(__dirname, '../preload/engine.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,                            // the adblock preload requires it; page can't reach either world
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts\.google\.com|music\.youtube\.com)/.test(url)) return { action: 'allow' }
    shell.openExternal(url); return { action: 'deny' }
  })
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault(); win.hide()               // hide, never destroy
    if (loginMode) { loginMode = false; win.loadURL(YTM_URL) } // back to the player after sign-in
  })
  await win.loadURL(YTM_URL)
  return win
}

export function createUiWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#000000',
    title: 'Triad',
    icon: ICON,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 22 } }       // Mac: the usual red/yellow/green buttons, inset into our top bar
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/ui.js'),
      contextIsolation: true, nodeIntegration: false,
      sandbox: false // the preload imports a shared chunk, which a sandboxed preload can't load
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/** The SoundCloud engine: a hidden soundcloud.com page with its own login (separate from YouTube Music's). */
let scWin: BrowserWindow | null = null
/**
 * "Light" mode: the hidden SoundCloud page only has to exist (we use its address, cookies and the data in its HTML), so SoundCloud's
 * own app (scripts, styles, images, trackers, ads) is not loaded at all. That's what makes everything quick. The sign-in window
 * turns it off (it needs the real page). Bot-check scripts are always let through.
 */
let scLight = true
export const setScLight = (v: boolean) => { scLight = v }
export async function createScWindow() {
  if (scWin && !scWin.isDestroyed()) return scWin
  const ses = session.fromPartition(SC_PARTITION)
  scLight = !getSettings().scFull                   // (if light mode ever failed on this computer, it stays off)
  ses.setUserAgent(chromeUA(ses))
  // the page's own <audio> reads the stream cross-origin (needed for the equalizer); make sure the CDN allows it
  ses.webRequest.onHeadersReceived({ urls: ['https://*.sndcdn.com/*'] }, (d, cb) => {
    const h = { ...d.responseHeaders }
    for (const k of Object.keys(h)) if (/^access-control-allow-origin$/i.test(k)) delete h[k]
    h['Access-Control-Allow-Origin'] = ['*']
    cb({ responseHeaders: h })
  })
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
    if (!scLight) return cb({})
    const t = d.resourceType
    if (t === 'mainFrame') return cb({})
    let host = ''; try { host = new URL(d.url).hostname } catch { /* ignore */ }
    if (/datadome|captcha-delivery/.test(host)) return cb({})
    if (t === 'xhr' || t === 'media') return cb({ cancel: !/(^|\.)(api-v2\.soundcloud\.com|sndcdn\.com)$/.test(host) })
    cb({ cancel: ['script', 'stylesheet', 'image', 'font', 'subFrame', 'webSocket', 'ping', 'cspReport', 'object', 'other'].includes(t) })
  })
  const win = new BrowserWindow({
    show: false, width: 1100, height: 800, title: 'Triad – sign in to SoundCloud', icon: ICON,
    webPreferences: {
      partition: SC_PARTITION, preload: join(__dirname, '../preload/sc.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([\w-]+\.)?(soundcloud\.com|google\.com|facebook\.com|apple\.com)\//.test(url)) return { action: 'allow' }
    shell.openExternal(url); return { action: 'deny' }
  })
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault(); win.hide()
    scLight = true
    win.loadURL(SC_URL)                          // back to the (hidden) player after sign-in
  })
  scWin = win
  win.loadURL(SC_URL).catch(() => {})            // not awaited: the app window opens straight away; requests wait for the page's ready signal
  return win
}
export function openScLogin(win: BrowserWindow) {
  scLight = false                                // the sign-in page needs SoundCloud's real scripts
  win.loadURL('https://soundcloud.com/signin')
  win.show(); win.focus()
}
/** SoundCloud asked for a captcha: show it in the (normally hidden) window so you can solve it. */
export function openScChallenge(win: BrowserWindow, url: string) {
  scLight = false
  win.loadURL(url); win.show(); win.focus()
}
