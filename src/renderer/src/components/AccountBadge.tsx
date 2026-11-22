import { useEffect, useRef, useState } from 'react'
import { Settings as Gear } from 'lucide-react'
import type { LoginStatus } from '@shared/types'
import { usePlayer } from '@/lib/store'
import { useRpc } from '@/lib/useRpc'
import { SettingsDialog } from './SettingsDialog'

/** Top right: "Hi, <first name>!" when signed in, otherwise Sign in (opens your browser) + cookies.txt import. */
export function AccountBadge() {
  const loggedIn = usePlayer((s) => s.loggedIn)
  const isSc = usePlayer((s) => s.backend) === 'sc'
  const { data } = useRpc('account', undefined, loggedIn)
  const [status, setStatus] = useState<LoginStatus>({ kind: 'idle' })
  const [note, setNote] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => window.ytm.onLoginStatus(setStatus), [])
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [menu])

  // add future entries (e.g. Settings) here and they show up in the menu
  const menuItems: { label: string; run: () => void }[] = [
    { label: 'Settings', run: () => setSettingsOpen(true) },
    { label: 'Sign out', run: () => { window.ytm.signOut() } }
  ]

  if (loggedIn) {
    const first = data?.name?.trim().split(/\s+/)[0]
    return (<>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <div ref={box} className="no-drag relative ml-auto shrink-0">
        <button onClick={() => setMenu((m) => !m)}
          className="rounded-full px-3 py-1.5 text-[15px] font-semibold text-white/90 transition-colors hover:bg-white/10">
          {first ? `Hi, ${first}!` : 'Hi there!'}
        </button>
        {menu && (
          <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)' }}
            className="menu-pop z-50 w-44 rounded-2xl p-1.5">
            {menuItems.map((m) => (
              <button key={m.label} role="menuitem" onClick={() => { setMenu(false); m.run() }}
                className="w-full rounded-xl px-3 py-2 text-left text-[14px] text-white/90 hover:bg-white/10">
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>)
  }

  const busy = status.kind === 'waiting' || status.kind === 'importing'
  const text =
    status.kind === 'waiting' ? `Sign in in the ${status.browser} window — it closes by itself, or close it when done.`
    : status.kind === 'importing' ? 'Finishing sign-in…'
    : status.kind === 'done' ? 'Signed in!'
    : status.kind === 'failed' ? status.message
    : status.kind === 'fallback' ? 'Sign in in the window that opened — it closes by itself.'
    : note

  const importFile = async () => {
    setNote(null)
    const r = await window.ytm.importCookies()
    if (r && !r.ok) setNote(r.message ?? 'Import failed.')
    else if (r?.ok) setNote('Cookies imported — signing in…')
  }

  return (
    <div className="no-drag ml-auto flex min-w-0 items-center gap-3">
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {text && <span className="max-w-[340px] truncate text-[12.5px] text-white/60" title={text}>{text}</span>}
      {busy ? (
        <button onClick={() => window.ytm.cancelSignIn()}
          className="lens h-10 shrink-0 rounded-full px-5 text-[14px] font-semibold transition-transform active:scale-95">
          Cancel
        </button>
      ) : (
        <>
          {!isSc && <button onClick={importFile} className="shrink-0 text-[12.5px] text-white/45 underline-offset-2 hover:text-white/80 hover:underline">
            Use cookies.txt
          </button>}
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="grid size-8 shrink-0 place-items-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"><Gear size={17} /></button>
          <button onClick={() => { setNote(null); window.ytm.signIn() }}
            className="lens h-10 shrink-0 rounded-full px-5 text-[14px] font-semibold transition-transform active:scale-95">
            Sign in
          </button>
        </>
      )}
    </div>
  )
}
