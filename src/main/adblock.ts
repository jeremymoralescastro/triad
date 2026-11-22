import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, type Session } from 'electron'
import fetch from 'cross-fetch'
import { ElectronBlocker } from '@ghostery/adblocker-electron'

/**
 * Ghostery's "ads and tracking" prebuilt engine = uBlock Origin filters + EasyList + EasyPrivacy
 * + Peter Lowe, compiled with uBO-compatible resources (scriptlets `##+js(...)`, redirects,
 * cosmetic + procedural cosmetic filters). enableBlockingInSession wires up:
 *   - network blocking/redirects via session.webRequest
 *   - cosmetic filters + scriptlets via a session preload (@ghostery/adblocker-electron-preload)
 */
const REFRESH_MS = 12 * 60 * 60 * 1000
let current: ElectronBlocker | null = null

const cachePath = () => join(app.getPath('userData'), 'adblock-engine.bin')

/**
 * The engine window is hidden, so cosmetic hiding is pointless there — and Ghostery's DOM watcher
 * does a synchronous IPC round-trip on page mutations, which stalls YouTube Music's player thread.
 * Keep network blocking + scriptlets (the ad-pruning bits); turn the DOM watcher/generic hiding off.
 */
function lean(b: ElectronBlocker): ElectronBlocker {
  try {
    const c = b.config as unknown as Record<string, unknown>
    c.enableMutationObserver = false
    c.loadGenericCosmeticsFilters = false
  } catch (e) { console.warn('[adblock] could not slim config', e) }
  return b
}

async function loadFromDisk(): Promise<{ blocker: ElectronBlocker; age: number } | null> {
  try {
    const [buf, stat] = await Promise.all([fs.readFile(cachePath()), fs.stat(cachePath())])
    return { blocker: lean(ElectronBlocker.deserialize(buf)), age: Date.now() - stat.mtimeMs }
  } catch {
    return null
  }
}

async function build(): Promise<ElectronBlocker> {
  const blocker = lean(await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch))
  await fs.writeFile(cachePath(), blocker.serialize()).catch(() => {})
  return blocker
}

function swap(ses: Session, next: ElectronBlocker) {
  if (current) current.disableBlockingInSession(ses)
  next.enableBlockingInSession(ses)
  current = next
}

export async function enableAdblock(ses: Session) {
  const cached = await loadFromDisk()          // instant start from cache…
  if (cached) swap(ses, cached.blocker)
  if (!cached || cached.age > REFRESH_MS) {    // …then refresh in the background
    swap(ses, await build())
  }
  setInterval(() => build().then((b) => swap(ses, b)).catch(console.error), REFRESH_MS)
}
