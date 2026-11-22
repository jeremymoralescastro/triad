import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { MainSettings } from '@shared/types'

/** Settings that only the main process can apply (login item, global shortcuts, history). Stored in the user's data folder. */
const defaults: MainSettings = { launchAtLogin: false, hotkeys: true, trackHistory: true, eq: [0, 0, 0, 0, 0, 0, 0, 0], eqEnabled: true, volume: 35, discord: true, discordClientId: '', backend: 'ytm' }
let cur: MainSettings | null = null
const file = () => join(app.getPath('userData'), 'settings.json')

export function getSettings(): MainSettings {
  if (!cur) {
    try { cur = { ...defaults, ...(existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}) } }
    catch { cur = { ...defaults } }
  }
  return cur!
}
export function setSettings(patch: Partial<MainSettings>): MainSettings {
  cur = { ...getSettings(), ...patch }
  try { writeFileSync(file(), JSON.stringify(cur)) } catch (e) { console.log('[settings] save failed', String(e)) }
  applyLoginItem()
  return cur
}
/** Only meaningful for the installed app (in dev it would register the Electron dev binary). */
export function applyLoginItem() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: getSettings().launchAtLogin })
}
