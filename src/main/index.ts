import { app, BrowserWindow, globalShortcut, nativeImage } from 'electron'
import { join } from 'path'
import { createEngineWindow, createScWindow, createUiWindow, markQuitting } from './windows'
import { wireIpc } from './ipc'
import { applyLoginItem, getSettings } from './settings'
import { startUpdater } from './updater'

// Make Chromium treat the hidden window like a normal media tab (SMTC + background audio).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.you.triad') // required for proper Win11 media overlay / notifications
  if (process.platform === 'darwin') { try { app.dock?.setIcon(nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))) } catch { /* the dock keeps its default icon */ } }   // dev runs show Electron's icon otherwise
  const make = (b: 'ytm' | 'sc') => (b === 'sc' ? createScWindow() : createEngineWindow())
  const start = getSettings().backend === 'sc' ? 'sc' : 'ytm'
  const engine = await make(start)
  const ui = createUiWindow()
  wireIpc(engine, start, make, ui)
  applyLoginItem()
  startUpdater()

  ui.on('closed', () => app.quit())
  app.on('second-instance', () => { if (ui.isMinimized()) ui.restore(); ui.focus() })
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createUiWindow() })
})

app.on('before-quit', markQuitting)
app.on('will-quit', () => globalShortcut.unregisterAll())
