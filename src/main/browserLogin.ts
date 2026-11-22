import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { RawCookie } from './cookies'

/**
 * Sign-in through the user's REAL browser (Chrome or Edge), because Google refuses to sign in inside
 * Electron. We launch the browser with a throw-away profile + a debugging port, let the user sign in
 * normally, read the YouTube cookies over the Chrome DevTools Protocol, then close the browser and
 * delete the temp profile. Nothing from the user's normal browser profile is touched.
 */

const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent('https://music.youtube.com/')

export function findBrowser(): string | null {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] ?? ''
  const candidates = [
    join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),   // ships with Windows 10/11
    join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]
  return candidates.find((p) => p && existsSync(p)) ?? null
}
export const browserName = (exe: string) => (/edge/i.test(exe) ? 'Microsoft Edge' : 'Chrome')

export type SignInResult =
  | { kind: 'cookies'; cookies: RawCookie[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

export interface BrowserSignIn { cancel(): void; done: Promise<SignInResult> }

/**
 * Titles of the sign-in browser's windows (Windows). Looks at every Chrome/Edge process started with our throw-away profile
 * (the one we launched may hand its window to a helper process, so its own title can be empty).
 */
function windowTitles(dir: string): string {
  if (process.platform !== 'win32') return ''
  try {
    const marker = dir.split(/[\\/]/).pop()!.replace(/'/g, "''")
    const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle } | Where-Object { $_ }`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    return String(r.stdout).replace(/\r?\n/g, ' | ').trim()
  } catch { return '' }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Tiny DevTools-protocol client over Node's built-in WebSocket. */
function connect(url: string): Promise<{ call(method: string, params?: object): Promise<any>; close(): void }> {
  return new Promise((resolve, reject) => {
    const WS = (globalThis as any).WebSocket
    if (!WS) return reject(new Error('WebSocket unavailable'))
    const ws = new WS(url)
    let id = 0
    const waiting = new Map<number, (m: any) => void>()
    ws.onmessage = (ev: any) => {
      const m = JSON.parse(String(ev.data))
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id) }
    }
    ws.onerror = () => reject(new Error('debugging connection failed'))
    ws.onclose = () => { for (const f of waiting.values()) f({ error: { message: 'closed' } }); waiting.clear() }
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        const i = ++id
        waiting.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)))
        ws.send(JSON.stringify({ id: i, method, params }))
      }),
      close: () => { try { ws.close() } catch {} }
    })
  })
}

const hasLogin = (cs: RawCookie[]) =>
  cs.some((c) => /youtube\.com$/.test(c.domain) && (c.name === 'SAPISID' || c.name === '__Secure-3PAPISID')) &&
  cs.some((c) => /youtube\.com$/.test(c.domain) && (c.name === '__Secure-3PSID' || c.name === 'SID'))

/**
 * Two phases, so Google never sees an automated browser:
 *  1) launch the browser PLAIN (no debugging flags) with a temp profile; the user signs in. We watch the
 *     profile's cookie database for the login cookie NAMES (values are encrypted, names aren't) and close
 *     the window once they appear (or the user closes it).
 *  2) relaunch the same profile headless with a debugging port and read the cookies, which the browser
 *     itself decrypts for us.
 */
export function startBrowserSignIn(exe: string): BrowserSignIn {
  const dir = mkdtempSync(join(tmpdir(), 'triad-signin-'))
  const cookieDb = join(dir, 'Default', 'Network', 'Cookies')
  let cancelled = false
  let current: ChildProcess | null = null
  let exited = false

  const launch = (args: string[]) => {
    exited = false
    const c = spawn(exe, [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', ...args], { stdio: 'ignore' })
    c.on('exit', () => { if (current === c) exited = true })
    c.on('error', () => { if (current === c) exited = true })
    current = c
    return c
  }
  const killCurrent = () => {
    const c = current
    try {
      if (process.platform === 'win32' && c?.pid) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' })
      else c?.kill()
    } catch {}
  }
  const cleanup = () => {
    killCurrent()
    setTimeout(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 }) } catch {} }, 1500)
  }
  const cookieNamesOnDisk = () => {
    try {
      const t = readFileSync(cookieDb).toString('latin1')
      return t.includes('SAPISID') && (t.includes('__Secure-3PSID') || /[^_]SID/.test(t))
    } catch { return false }                       // locked or not written yet
  }

  const done = (async (): Promise<SignInResult> => {
    try {
      // ---- phase 1: normal browser window, user signs in ----
      launch(['--new-window', '--window-size=480,660', '--window-position=120,60', SIGN_IN_URL])     // a small, normal browser window (its title follows the page, which is how we tell you're in)
      const deadline = Date.now() + 10 * 60_000
      let seenAt = 0, lastDisk = 0, lastTitles = '', lastTitleCheck = 0
      while (Date.now() < deadline && !cancelled && !exited) {
        // the instant the browser lands on YouTube Music the sign-in is done: let it finish writing its cookies, then close it politely
        // (a polite close makes the browser save the cookies; a forced kill would lose them)
        let landed = false
        if (Date.now() - lastTitleCheck > 600) {
          lastTitleCheck = Date.now()
          const titles = windowTitles(dir)
          if (titles !== lastTitles) { lastTitles = titles; console.log('[login] browser window:', titles || '(none)') }
          // the window is named after its page: once it reads YouTube Music (and no longer Google's sign-in pages), you're in
          landed = /music\.youtube\.com|youtube music/i.test(titles) && !/accounts\.google|sign in|choose an account/i.test(titles)
        }
        if (landed) {
          console.log('[login] reached YouTube Music: closing the sign-in window')
          await sleep(3000)                                         // let YouTube finish setting its cookies
          const c = current
          if (process.platform === 'win32' && c?.pid) spawn('taskkill', ['/pid', String(c.pid), '/T'], { stdio: 'ignore', windowsHide: true })    // polite close = the browser saves its cookies
          for (let i = 0; i < 40 && !exited; i++) await sleep(250)
          break
        }
        if (Date.now() - lastDisk > 1500) {                                // fallback: spot the login cookies on disk
          lastDisk = Date.now()
          if (cookieNamesOnDisk()) { seenAt = seenAt || Date.now(); if (Date.now() - seenAt > 3000) break }
        }
        await sleep(300)
      }
      if (cancelled) return { kind: 'cancelled' }
      if (!exited && Date.now() >= deadline) return { kind: 'error', message: 'Timed out waiting for you to sign in.' }
      killCurrent()                                // flushes nothing new: the cookies are already on disk
      await sleep(2000)

      // ---- phase 2: headless relaunch of the same profile, read cookies over DevTools ----
      for (const f of ['DevToolsActivePort', 'lockfile', 'SingletonLock']) { try { rmSync(join(dir, f), { force: true }) } catch {} }
      launch(['--headless=new', '--remote-debugging-port=0', '--remote-allow-origins=*', '--disable-extensions', 'about:blank'])
      const portFile = join(dir, 'DevToolsActivePort')
      for (let i = 0; i < 80 && !existsSync(portFile) && !exited; i++) await sleep(250)
      if (!existsSync(portFile)) return { kind: 'error', message: `Couldn't read the sign-in from ${basename(exe)}.` }
      const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
      const cdp = await connect(`ws://127.0.0.1:${port}${path}`)
      let all: any[] = []
      for (let i = 0; i < 8; i++) {                // cookies load a moment after startup
        all = (await cdp.call('Storage.getCookies')).cookies as any[]
        if (hasLogin(all)) break
        await sleep(750)
      }
      cdp.close()
      console.log('[login] cookies read from the sign-in browser:', all.length, '| youtube login cookies:', hasLogin(all))
      if (!hasLogin(all)) return { kind: 'error', message: 'The sign-in window closed before YouTube Music finished signing in. Click Sign in and wait on the YouTube Music page for a moment.' }
      return {
        kind: 'cookies',
        cookies: all
          .filter((c) => /(google|youtube)\./i.test(c.domain + '.'))
          .map((c) => ({
            name: c.name, value: c.value, domain: c.domain, path: c.path, secure: !!c.secure,
            httpOnly: !!c.httpOnly, expires: c.session ? 0 : c.expires, sameSite: c.sameSite
          }))
      }
    } catch (err) {
      return { kind: 'error', message: String((err as Error).message ?? err) }
    } finally {
      cleanup()
    }
  })()

  return { cancel: () => { cancelled = true; killCurrent() }, done }
}
