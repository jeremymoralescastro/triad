import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Checks GitHub Releases for a newer version, downloads it quietly, and installs it the next time Triad closes.
 * Does nothing in `npm run dev` (only packaged builds update).
 */
export function startUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => console.log('[update]', m), warn: (m: unknown) => console.log('[update]', m), error: (m: unknown) => console.log('[update]', m), debug: () => {} } as never
  const check = () => { autoUpdater.checkForUpdates().catch((e) => console.log('[update] check failed:', String(e?.message ?? e))) }
  autoUpdater.on('update-downloaded', (i) => console.log(`[update] ${i.version} downloaded, installs when Triad closes`))
  setTimeout(check, 15_000)                    // let the app finish starting first
  setInterval(check, 4 * 60 * 60 * 1000)       // and every 4 hours while it stays open
}
