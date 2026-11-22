import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Copy, Users } from 'lucide-react'
import type { PartyStatus } from '@shared/types'

const clean = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
const myName = async () => { try { return (await window.ytm.rpc('account'))?.name ?? '' } catch { return '' } }
const pretty = (c: string) => c.replace(/(.{4})(?=.)/g, '$1-')

/** Header button: host a listening party (get a room code) or join one with a code. Everyone in it hears the same song at the same spot. */
export function PartyButton() {
  const [st, setSt] = useState<PartyStatus>({ role: 'none', connected: false })
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'host' | 'join' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { window.ytm.partyStatus().then(setSt).catch(() => {}); return window.ytm.onPartyStatus(setSt) }, [])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])

  const run = async (kind: 'host' | 'join', f: () => Promise<PartyStatus>) => {
    setBusy(kind); setErr(null)
    try { setSt(await f()); setCode('') } catch (e) { setErr(clean(e)) } finally { setBusy(null) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(pretty(st.code ?? '')); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }
  const live = st.role !== 'none'

  // the circle grows into a pill that says who you're with (and shrinks back when the party ends)
  const label = st.role === 'guest' ? (st.hostName ? `Listening with ${st.hostName}` : st.connected ? 'Listening along' : 'Connecting…')
    : st.role === 'host' ? (st.names?.length ? `Hosting · ${st.names.length > 2 ? `${st.names.slice(0, 2).join(', ')} +${st.names.length - 2}` : st.names.join(', ')}` : 'Hosting · waiting for friends') : ''
  const kept = useRef(label)
  if (label) kept.current = label                      // keep the words while the pill closes
  const measure = useRef<HTMLSpanElement>(null)
  const [textW, setTextW] = useState(0)
  useLayoutEffect(() => { setTextW(measure.current?.scrollWidth ?? 0) }, [label])

  return (
    <div ref={box} className="no-drag relative">
      <button aria-label={label || 'Listening party'} aria-expanded={open} title={label || 'Listening party'} onClick={() => setOpen((o) => !o)}
        style={{ width: 44 + (label ? textW : 0) }}
        className={`glass glass-hover relative flex h-11 items-center overflow-hidden rounded-full transition-[width] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${live ? 'text-accent' : 'text-white/85 hover:text-white'}`}>
        <span className="relative grid size-11 shrink-0 place-items-center">
          <Users size={20} />
          {live && <span className={`absolute right-2 top-2 size-2 rounded-full ${st.connected ? 'bg-accent' : 'bg-[#e6c27a]'}`} />}
        </span>
        <span ref={measure} aria-hidden={!label} className={`whitespace-nowrap pr-4 text-[13px] font-semibold text-white/90 transition-opacity ${label ? 'opacity-100 duration-300 delay-200' : 'opacity-0 duration-150'}`}>{kept.current}</span>
      </button>

      {open && (
        <div className="menu-pop absolute right-0 top-[52px] z-50 w-[320px] rounded-[24px] p-4">
          <div className="text-[14.5px] font-semibold">Listening party</div>

          {st.role === 'none' && (<>
            <p className="mt-1 text-[12.5px] leading-snug text-mute">Listen to the same song at the same time as your friends. Everyone plays it from their own account, on the same service.</p>
            <button onClick={() => run('host', async () => window.ytm.partyHost(await myName()))} disabled={!!busy}
              className="mt-3 h-9 w-full rounded-full blue-glass text-[13.5px] font-semibold disabled:opacity-50">{busy === 'host' ? 'Starting…' : 'Start a party'}</button>
            <div className="my-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/35"><span className="h-px flex-1 bg-white/10" />or join<span className="h-px flex-1 bg-white/10" /></div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) run('join', async () => window.ytm.partyJoin(code, await myName())) }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code" spellCheck={false} autoComplete="off" maxLength={20} disabled={!!busy}
                className="h-9 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-[13.5px] uppercase tracking-wider outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-mute focus:ring-2 focus:ring-accent" />
              <button type="submit" disabled={!code.trim() || !!busy} className="h-9 rounded-full bg-white/10 px-4 text-[13px] font-medium hover:bg-white/15 disabled:opacity-40">{busy === 'join' ? '…' : 'Join'}</button>
            </form>
          </>)}

          {st.role === 'host' && (<>
            <p className="mt-1 text-[12.5px] leading-snug text-mute">You’re hosting. Send friends this code; they paste it under “join”.</p>
            <div className="mt-3 flex items-center gap-2 rounded-full bg-white/10 py-1 pl-4 pr-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[15px] font-semibold tracking-wider">{pretty(st.code ?? '')}</span>
              <button onClick={copy} aria-label="Copy room code" className="grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
            </div>
            <p className="mt-2 text-[12.5px] text-white/70">{st.connected ? (st.names?.length ? `Listening with you: ${st.names.join(', ')}` : 'Nobody has joined yet') : 'Reconnecting…'}</p>
            <p className="mt-1 text-[12px] leading-snug text-mute">With Discord status on, friends can also press <b>Join</b> on your Discord profile while music plays (their Triad must be open).</p>
            <button onClick={() => run('host', () => window.ytm.partyLeave())} className="mt-3 h-9 w-full rounded-full bg-white/10 text-[13.5px] font-medium hover:bg-white/15">End party</button>
          </>)}

          {st.role === 'guest' && (<>
            <p className="mt-1 text-[12.5px] leading-snug text-mute">You’re listening along. Your player follows the host’s song, pause and position.</p>
            {st.hostName && <p className="mt-3 text-[13px] font-semibold">Listening with {st.hostName}</p>}
            <p className="mt-1 truncate text-[13px] text-white/85">{st.hostTrack ?? (st.connected ? 'Waiting for the host…' : 'Reconnecting…')}</p>
            <button onClick={() => run('host', () => window.ytm.partyLeave())} className="mt-3 h-9 w-full rounded-full bg-white/10 text-[13.5px] font-medium hover:bg-white/15">Leave party</button>
          </>)}

          {st.note && <p className="mt-2 text-[12.5px] leading-snug text-[#e6c27a]">{st.note}</p>}
          {err && <p className="mt-2 text-[12.5px] leading-snug text-[#e69a9a]">{err}</p>}
        </div>
      )}
    </div>
  )
}
