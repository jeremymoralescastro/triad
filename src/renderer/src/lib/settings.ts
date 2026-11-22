import { create } from 'zustand'

/** Look-and-feel settings that live in the UI (saved in this window's local storage). */
export type Theme = 'glass' | 'vista' | 'oled' | 'retro'
export const THEMES: { id: Theme; label: string }[] = [{ id: 'glass', label: 'Triad' }, { id: 'vista', label: 'Vista' }, { id: 'oled', label: 'OLED' }, { id: 'retro', label: 'Retro' }]

export interface UiSettings {
  theme: Theme                    // whole-app look
  zoom: number                    // interface scale, 1 = 100%
  wallpaper: boolean              // artwork-blur background
  lyricsPanel: boolean            // show the lyrics column
  lyricsSize: 'S' | 'M' | 'L'
  lyricsSync: boolean             // highlight + scroll the current lyric line
  hue: number                     // accent color shift in degrees (0 = Triad blue)
}
const KEY = 'triad:settings'
const defaults: UiSettings = { zoom: 1, theme: 'glass', wallpaper: true, lyricsPanel: true, lyricsSize: 'M', lyricsSync: true, hue: 0 }

function load(): UiSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    const legacySync = localStorage.getItem('triad:lyrics-sync')      // from before there was a settings window
    return { ...defaults, ...(legacySync !== null && !('lyricsSync' in saved) ? { lyricsSync: legacySync !== '0' } : {}), ...saved }
  } catch { return { ...defaults } }
}

const applyTheme = (t: Theme) => { try { document.documentElement.dataset.theme = t; window.ytm?.setTitleBar?.(t === 'retro') } catch { /* ignore */ } }

const applyHue = (h: number) => { try { document.documentElement.style.setProperty('--hue', String(Math.round(h) || 0)) } catch { /* ignore */ } }

export const useSettings = create<UiSettings & { set: (p: Partial<UiSettings>) => void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p)
    if (p.theme) applyTheme(p.theme)
    if (p.hue !== undefined) applyHue(p.hue)
    if (p.zoom !== undefined) window.ytm?.setZoom?.(p.zoom)
    const { set: _s, ...rest } = get()
    try { localStorage.setItem(KEY, JSON.stringify(rest)) } catch { /* ignore */ }
  }
}))

applyTheme(useSettings.getState().theme)
applyHue(useSettings.getState().hue)
window.ytm?.setZoom?.(useSettings.getState().zoom)

export const LYRICS_PX = { S: 16, M: 19, L: 23 } as const
