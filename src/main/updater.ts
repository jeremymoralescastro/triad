import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Updates.
 *  - Windows installed app: checks GitHub Releases after start and every 4 hours, downloads quietly, and installs when you restart
 *    (or right away with "Restart to update").
 *  - Anywhere else (Mac, `npm run dev`): can't update itself, so "Check for updates" just asks GitHub for the newest version
 *    and points to its download page.
 */
const REPO = 'jeremymoralescastro/triad'
let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let emit: ((s: UpdateStatus) => void) | null = null
const set = (s: Omit<UpdateStatus, 'current'>) => { status = { ...s, current: app.getVersion() }; try { emit?.(status) } catch { /* window gone */ } }

export const getUpdateStatus = () => status
export const setUpdateEmitter = (f: (s: UpdateStatus) => void) => { emit = f }

const newer = (a: string, b: string) => {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0), pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true; if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false }
  return false
}
const canSelfUpdate = () => app.isPackaged && process.platform === 'win32'

async function checkGithub() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(r.status === 404 ? 'No release has been published yet.' : `GitHub said ${r.status}.`)
  const j: any = await r.json()
  const tag = String(j?.tag_name ?? '')
  if (tag && newer(tag, app.getVersion())) set({ state: 'available', version: tag.replace(/^v/, ''), url: String(j?.html_url ?? `https://github.com/${REPO}/releases/latest`) })
  else set({ state: 'current' })
}

export async function checkNow(): Promise<UpdateStatus> {
  if (status.state === 'checking' || status.state === 'downloading') return status
  set({ state: 'checking' })
  try {
    if (canSelfUpdate()) await autoUpdater.checkForUpdates()      // the events below report what it finds
    else await checkGithub()
  } catch (e) {
    set({ state: 'error', message: String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160) })
  }
  return status
}

export function installNow() {
  if (status.state === 'ready' && canSelfUpdate()) autoUpdater.quitAndInstall(true, true)    // silent install, then reopen Triad
}

export function startUpdater() {
  if (!canSelfUpdate()) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => console.log('[update]', m), warn: (m: unknown) => console.log('[update]', m), error: (m: unknown) => console.log('[update]', m), debug: () => {} } as never
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'current' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => { console.log(`[update] ${i.version} downloaded, installs when Triad closes`); set({ state: 'ready', version: i.version }) })
  autoUpdater.on('error', (e) => set({ state: 'error', message: String(e?.message ?? e).split('\n')[0].slice(0, 160) }))
  setTimeout(() => void checkNow(), 15_000)                        // let the app finish starting first
  setInterval(() => void checkNow(), 4 * 60 * 60 * 1000)           // and every 4 hours while it stays open
}
