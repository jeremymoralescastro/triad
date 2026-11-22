import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, RotateCcw, X } from 'lucide-react'
import type { MainSettings, UpdateStatus } from '@shared/types'
import { THEMES, useSettings } from '@/lib/settings'
import { BASE_HUE } from '@/lib/hue'
import { Equalizer } from './Equalizer'

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-white/20'}`}>
      <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[14.5px] font-medium text-white/90">{title}</div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-snug text-mute">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-5 last:mb-0">
    <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-white/45">{title}</h3>
    <div className="divide-y divide-white/[.08]">{children}</div>
  </section>
)

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ui = useSettings()
  const [main, setMain] = useState<MainSettings | null>(null)
  const [cleared, setCleared] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => { window.ytm.getSettings().then(setMain).catch(() => {}) }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const eqTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const setEq = (eq: number[], final: boolean) => {
    setMain((m) => (m ? { ...m, eq } : m))
    clearTimeout(eqTimer.current)
    if (final) window.ytm.setSettings({ eq })
    else eqTimer.current = setTimeout(() => window.ytm.setSettings({ eq }), 70)       // live while dragging, not on every pixel
  }
  const eqOn = main?.eqEnabled ?? true
  const eqFlat = (main?.eq ?? []).every((g) => g === 0)
  const [clientId, setClientId] = useState('')
  useEffect(() => { if (main) setClientId((c) => c || main.discordClientId) }, [main])
  const idOk = /^\d{15,25}$/.test(clientId.trim())
  const [aiSet, setAiSet] = useState(false)
  const [aiKey, setAiKey] = useState('')
  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const [aiProv, setAiProv] = useState<{ provider: 'claude' | 'ollama' | 'none'; model?: string } | null>(null)
  const refreshAi = () => window.ytm.aiStatus().then(setAiProv).catch(() => {})
  useEffect(() => { window.ytm.aiKey().then(setAiSet).catch(() => {}); refreshAi() }, [])
  const saveKey = async (v: string) => {
    try { setAiSet(await window.ytm.aiKey(v)); setAiKey(''); setAiMsg(v ? 'Saved.' : 'Removed.'); refreshAi() }
    catch (e) { setAiMsg(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')) }
  }

  const setMainValue = (patch: Partial<MainSettings>) => {
    setMain((m) => (m ? { ...m, ...patch } : m))                 // instant, then confirmed by the main process
    window.ytm.setSettings(patch).then(setMain).catch(() => {})
  }

  const [upd, setUpd] = useState<UpdateStatus | null>(null)
  useEffect(() => { window.ytm.updateStatus().then(setUpd).catch(() => {}); return window.ytm.onUpdateStatus(setUpd) }, [])
  const isMac = /Mac/i.test(navigator.userAgent)
  const updText = !upd ? '' : upd.state === 'checking' ? 'Checking…'
    : upd.state === 'current' ? 'You’re up to date.'
    : upd.state === 'available' ? `Version ${upd.version} is available.${upd.url ? ' Download it from GitHub.' : ''}`
    : upd.state === 'downloading' ? `Downloading version ${upd.version}… ${upd.percent ?? 0}%`
    : upd.state === 'ready' ? `Version ${upd.version} is ready. It also installs when you close Triad.`
    : upd.state === 'error' ? `Couldn’t check: ${upd.message ?? 'unknown error'}`
    : isMac ? 'Updates on Mac are manual: check here, then download the new version.' : 'Triad checks for updates by itself while it runs.'
  const updBusy = upd?.state === 'checking' || upd?.state === 'downloading'

  const TABS = [['appearance', 'Appearance'], ['equalizer', 'Equalizer'], ['playback', 'Playback'], ['discord', 'Discord'], ['ai', 'AI'], ['system', 'System']] as const
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('appearance')
  const tabEls = useRef<Record<string, HTMLButtonElement | null>>({})
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => { const el = tabEls.current[tab]; if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth }) }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [tab])

  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}
        className="menu-pop flex h-[min(680px,86vh)] w-full max-w-[520px] flex-col overflow-hidden rounded-[28px] px-6 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[22px] font-bold tracking-tight">Settings</h2>
          <button onClick={onClose} aria-label="Close settings" className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </div>
        <div role="tablist" aria-label="Settings sections" className="relative mb-3 flex shrink-0 gap-0.5 overflow-x-auto rounded-full bg-white/[.06] p-1 [scrollbar-width:none]">
          {pill && <span aria-hidden className="absolute bottom-1 top-1 rounded-full bg-white/15 transition-[left,width] duration-300 ease-out" style={{ left: pill.left, width: pill.width }} />}
          {TABS.map(([k, label]) => (
            <button key={k} ref={(el) => { tabEls.current[k] = el }} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`relative h-8 flex-auto shrink-0 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium transition-colors ${tab === k ? 'text-white' : 'text-white/55 hover:text-white'}`}>{label}</button>
          ))}
        </div>

        <div key={tab} className="set-tab-in min-h-0 flex-1 overflow-y-auto pb-6 pr-1">

        {tab === 'appearance' && (<Section title="Appearance">
          <Row title="Theme" hint="Triad is the default. Vista is a glossy Windows Aero look. OLED is pure black, flat and light. Retro is an old NES / Famicom style in beige, charcoal and maroon.">
            <div className="flex rounded-full bg-white/10 p-0.5" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.id} role="radio" aria-checked={ui.theme === t.id} onClick={() => ui.set({ theme: t.id })}
                  className={`h-7 rounded-full px-3 text-[13px] font-semibold transition-colors ${ui.theme === t.id ? 'blue-glass' : 'text-white/70 hover:text-white'}`}>{t.label}</button>
              ))}
            </div>
          </Row>
          <Row title="Accent color" hint="Turns every blue in Triad into another color. Retro keeps its maroon.">
            <div className="flex items-center gap-3">
              <input type="range" className="hue-slider w-36" aria-label="Accent color" min={0} max={360} step={1} value={ui.hue ?? 0}
                style={{ ['--hue-grad' as string]: `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${BASE_HUE + i * 30} 100% 65%)`).join(', ')})`, ['--thumb' as string]: `hsl(${BASE_HUE + (ui.hue ?? 0)} 100% 65%)` }}
                onChange={(e) => ui.set({ hue: +e.target.value })} />
              <button onClick={() => ui.set({ hue: 0 })} disabled={(ui.hue ?? 0) === 0}
                className="h-7 rounded-full bg-white/10 px-3 text-[12.5px] font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-40">Reset</button>
            </div>
          </Row>
          <Row title="Interface size" hint="Zoom the whole app in or out.">
            <div className="flex items-center gap-3">
              <input type="range" className="slider w-36" aria-label="Interface size" min={0.7} max={1.5} step={0.05} value={ui.zoom}
                style={{ ['--p' as string]: `${((ui.zoom - 0.7) / 0.8) * 100}%` }} onChange={(e) => ui.set({ zoom: Math.round(+e.target.value * 100) / 100 })} />
              <span className="w-11 text-right text-[13px] tabular-nums text-mute">{Math.round(ui.zoom * 100)}%</span>
              <button onClick={() => ui.set({ zoom: 1 })} disabled={ui.zoom === 1}
                className="h-7 rounded-full bg-white/10 px-3 text-[12.5px] font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-40">Reset</button>
            </div>
          </Row>
          <Row title="Artwork background" hint="A soft blur of the album cover behind the app.">
            <Switch label="Artwork background" on={ui.wallpaper} onChange={(v) => ui.set({ wallpaper: v })} />
          </Row>
          <Row title="Lyrics panel" hint="Show the lyrics column on the right.">
            <Switch label="Lyrics panel" on={ui.lyricsPanel} onChange={(v) => ui.set({ lyricsPanel: v })} />
          </Row>
          <Row title="Lyrics text size">
            <div className="flex rounded-full bg-white/10 p-0.5" role="radiogroup" aria-label="Lyrics text size">
              {(['S', 'M', 'L'] as const).map((sz) => (
                <button key={sz} role="radio" aria-checked={ui.lyricsSize === sz} onClick={() => ui.set({ lyricsSize: sz })}
                  className={`h-7 w-9 rounded-full text-[13px] font-semibold transition-colors ${ui.lyricsSize === sz ? 'blue-glass' : 'text-white/70 hover:text-white'}`}>{sz}</button>
              ))}
            </div>
          </Row>
          <Row title="Synced lyrics" hint="Highlight and scroll to the line being sung.">
            <Switch label="Synced lyrics" on={ui.lyricsSync} onChange={(v) => ui.set({ lyricsSync: v })} />
          </Row>
        </Section>)}

        {tab === 'equalizer' && (<Section title="Equalizer">
          <div className="py-3">
            <div className="mb-3 flex items-center justify-end gap-2">
              <button onClick={() => setEq([0, 0, 0, 0, 0, 0, 0, 0], true)} disabled={eqFlat}
                className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 pl-2.5 pr-3 text-[12.5px] font-semibold text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-40">
                <RotateCcw size={14} strokeWidth={2.4} />Reset
              </button>
              {/* same look as the lyrics sync switch: soft green ✓ = on, soft red ✕ = off */}
              <button onClick={() => setMainValue({ eqEnabled: !eqOn })} aria-pressed={eqOn} title={eqOn ? 'Equalizer: on' : 'Equalizer: off'}
                className={`flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-3 text-[12.5px] font-semibold ring-1 backdrop-blur-md transition-colors ${
                  eqOn ? 'bg-[rgba(100,190,140,.16)] text-[#8fd0ae] ring-[rgba(100,190,140,.32)] hover:bg-[rgba(100,190,140,.24)]'
                       : 'bg-[rgba(214,110,110,.16)] text-[#e39b9b] ring-[rgba(214,110,110,.32)] hover:bg-[rgba(214,110,110,.24)]'}`}>
                {eqOn ? <Check size={15} strokeWidth={2.8} /> : <X size={15} strokeWidth={2.8} />}{eqOn ? 'On' : 'Off'}
              </button>
            </div>
            <Equalizer gains={main?.eq ?? [0, 0, 0, 0, 0, 0, 0, 0]} onChange={setEq} disabled={!eqOn} />
            <p className="mt-2.5 text-[12.5px] leading-snug text-mute">Drag the surface to shape the sound. Applies to everything Triad plays. Turn it off to hear the original sound; your curve is kept.</p>
          </div>
        </Section>)}

        {tab === 'playback' && (<Section title="Playback & privacy">
          <Row title="Track listening history" hint="Powers “Your most played” on the home screen. Stays on this computer.">
            <Switch label="Track listening history" on={main?.trackHistory ?? true} onChange={(v) => setMainValue({ trackHistory: v })} />
          </Row>
          <Row title="Clear listening history" hint="Resets your most played songs and artists.">
            {confirmClear ? (
              <div className="flex gap-2">
                <button onClick={() => { window.ytm.clearHistory().then(() => { setCleared(true); setConfirmClear(false) }) }}
                  className="h-8 rounded-full bg-[rgba(214,110,110,.25)] px-3 text-[13px] font-semibold text-[#f0aaaa] hover:bg-[rgba(214,110,110,.38)]">Clear</button>
                <button onClick={() => setConfirmClear(false)} className="h-8 rounded-full bg-white/10 px-3 text-[13px] hover:bg-white/15">Keep</button>
              </div>
            ) : (
              <button onClick={() => { setCleared(false); setConfirmClear(true) }}
                className="h-8 rounded-full bg-white/10 px-3.5 text-[13px] font-medium hover:bg-white/15">{cleared ? 'Cleared ✓' : 'Clear…'}</button>
            )}
          </Row>
          <Row title="Global shortcuts" hint={(/Mac/i.test(navigator.userAgent) ? '⌘⌥' : 'Ctrl+Alt+') + 'Space play/pause · ' + (/Mac/i.test(navigator.userAgent) ? '⌘⌥' : 'Ctrl+Alt+') + '←/→ previous/next · ' + (/Mac/i.test(navigator.userAgent) ? '⌘⌥' : 'Ctrl+Alt+') + '↑/↓ volume. Works while Triad is in the background.'}>
            <Switch label="Global shortcuts" on={main?.hotkeys ?? true} onChange={(v) => setMainValue({ hotkeys: v })} />
          </Row>
        </Section>)}

        {tab === 'discord' && (<Section title="Discord">
          <Row title="Show what I'm listening to" hint="Displays “Listening to …” on your Discord profile while music plays. Only while Discord is open.">
            <Switch label="Discord listening status" on={main?.discord ?? false} onChange={(v) => setMainValue({ discord: v })} />
          </Row>
          {!main?.discordBuiltIn && <div className="py-3">
            <label htmlFor="did" className="text-[14.5px] font-medium text-white/90">Discord application ID</label>
            <input id="did" value={clientId} onChange={(e) => setClientId(e.target.value)} onBlur={() => idOk && clientId.trim() !== main?.discordClientId && setMainValue({ discordClientId: clientId.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} inputMode="numeric" placeholder="e.g. 123456789012345678" spellCheck={false}
              className="mt-2 h-10 w-full rounded-full bg-white/10 px-4 text-[14px] outline-none placeholder:text-mute focus:ring-2 focus:ring-accent" />
            <p className={`mt-2 text-[12.5px] leading-snug ${clientId && !idOk ? 'text-[#e69a9a]' : 'text-mute'}`}>
              {clientId && !idOk ? 'That doesn’t look like an application ID (it’s 17–20 digits).' : <>Create a free app at <button onClick={() => window.ytm.openExternal('https://discord.com/developers/applications')} className="underline hover:text-white">discord.com/developers</button>, name it “Triad” (that name is what friends see), and paste its Application ID here.</>}
            </p>
          </div>}
        </Section>)}

        {tab === 'ai' && (<Section title="AI playlists">
          <div className="py-3">
            <div className="text-[14.5px] font-medium text-white/90">Make playlists from a description</div>
            <p className="mt-1 text-[12.5px] leading-snug text-white/75">
              {aiProv == null ? 'Checking…' : aiProv.provider === 'claude' ? 'Using: your Anthropic key.' : aiProv.provider === 'ollama' ? `Using: local AI (${aiProv.model}), free and private.` : 'Using: smart search (works with no AI installed, but it doesn’t really understand the description).'}
              {' '}<button onClick={refreshAi} className="underline hover:text-white">Check again</button>
            </p>
            <p className="mt-2 text-[12.5px] leading-snug text-mute">
              Where: Your Library → New playlist → Describe it. For free local AI, install <button onClick={() => window.ytm.openExternal('https://ollama.com/download')} className="underline hover:text-white">Ollama</button>, then run <code className="rounded bg-white/10 px-1">ollama pull llama3.2</code> once in a terminal. Triad finds it by itself.
            </p>
          </div>
          <div className="py-3">
            <label htmlFor="aik" className="text-[14.5px] font-medium text-white/90">Optional: Anthropic API key {aiSet && <span className="ml-1 text-[12.5px] font-normal text-accent">· saved</span>}</label>
            <div className="mt-2 flex gap-2">
              <input id="aik" type="password" value={aiKey} onChange={(e) => { setAiKey(e.target.value); setAiMsg(null) }} placeholder={aiSet ? '••••••••••••  (saved, paste a new one to replace)' : 'sk-ant-…'} spellCheck={false} autoComplete="off"
                onKeyDown={(e) => e.key === 'Enter' && aiKey.trim() && saveKey(aiKey)}
                className="h-10 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-[14px] outline-none placeholder:text-mute focus:ring-2 focus:ring-accent" />
              <button onClick={() => saveKey(aiKey)} disabled={!aiKey.trim()} className="h-10 rounded-full bg-white/10 px-4 text-[13px] font-medium hover:bg-white/15 disabled:opacity-40">Save</button>
              {aiSet && <button onClick={() => saveKey('')} className="h-10 rounded-full bg-white/10 px-3 text-[13px] hover:bg-white/15">Remove</button>}
            </div>
            <p className={`mt-2 text-[12.5px] leading-snug ${aiMsg && !/^(Saved|Removed)/.test(aiMsg) ? 'text-[#e69a9a]' : 'text-mute'}`}>
              {aiMsg ?? <>Better song picks than a small local AI. Uses your own key from <button onClick={() => window.ytm.openExternal('https://console.anthropic.com/settings/keys')} className="underline hover:text-white">console.anthropic.com</button> (a few cents per playlist at most); only your description is sent to Anthropic. The key is stored encrypted on this computer, and while one is saved it is used instead of the local AI.</>}
            </p>
          </div>
        </Section>)}

        {tab === 'system' && (<Section title="System">
          <Row title="Updates" hint={`Triad ${upd?.current ?? ''} · ${updText}`}>
            {upd?.state === 'ready'
              ? <button onClick={() => window.ytm.updateInstall()} className="h-8 shrink-0 rounded-full blue-glass px-3.5 text-[13px] font-semibold">Restart to update</button>
              : upd?.state === 'available' && upd.url
                ? <button onClick={() => window.ytm.openExternal(upd.url!)} className="h-8 shrink-0 rounded-full blue-glass px-3.5 text-[13px] font-semibold">Open download page</button>
                : <button onClick={() => window.ytm.updateCheck()} disabled={updBusy} className="h-8 shrink-0 rounded-full bg-white/10 px-3.5 text-[13px] font-medium hover:bg-white/15 disabled:opacity-50">{updBusy ? 'Checking…' : 'Check for updates'}</button>}
          </Row>
          <Row title="Launch at login" hint="Start Triad when you sign in to Windows (installed app only).">
            <Switch label="Launch at login" on={main?.launchAtLogin ?? false} onChange={(v) => setMainValue({ launchAtLogin: v })} />
          </Row>
        </Section>)}

        <p className="mt-5 text-[12px] text-white/40">Triad · music from YouTube Music, lyrics from Genius &amp; LRCLIB</p>
        </div>
      </div>
    </div>,
    document.body
  )
}
