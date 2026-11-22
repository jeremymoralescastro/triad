import { useEffect, useRef, useState } from 'react'
import { Clock, Search, X } from 'lucide-react'

const KEY = 'triad:search-history'
const readHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
const writeHistory = (h: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(h.slice(0, 12))) } catch { /* ignore */ } }

type Row = { text: string; recent: boolean }

/** Search field with recent searches (when empty) and live suggestions from YouTube Music (while typing). */
export function SearchBox({ query, setQuery, onSubmit }: { query: string; setQuery: (q: string) => void; onSubmit: (q: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<string[]>(readHistory)
  const [suggest, setSuggest] = useState<string[]>([])
  const [idx, setIdx] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  // live suggestions, debounced; stale answers are ignored
  useEffect(() => {
    const q = query.trim()
    if (!q) { setSuggest([]); return }
    const my = ++seq.current
    const t = setTimeout(() => {
      window.ytm.rpc('suggest', { query: q }).then((r) => { if (my === seq.current) setSuggest(r) }).catch(() => { if (my === seq.current) setSuggest([]) })
    }, 160)
    return () => clearTimeout(t)
  }, [query])

  const q = query.trim().toLowerCase()
  const recents = (q ? history.filter((h) => h.toLowerCase().includes(q) && h.toLowerCase() !== q).slice(0, 3) : history.slice(0, 8))
  const rows: Row[] = [
    ...recents.map((text) => ({ text, recent: true })),
    ...suggest.filter((s) => !recents.some((r) => r.toLowerCase() === s.toLowerCase())).map((text) => ({ text, recent: false }))
  ].slice(0, 10)
  useEffect(() => setIdx(-1), [query, focused])

  const submit = (text: string) => {
    const t = text.trim()
    if (!t) return
    setQuery(t); setFocused(false)
    const next = [t, ...history.filter((h) => h.toLowerCase() !== t.toLowerCase())]
    setHistory(next); writeHistory(next)
    onSubmit(t)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }
  const forget = (text: string) => { const n = history.filter((h) => h !== text); setHistory(n); writeHistory(n) }

  return (
    <div ref={box} className="no-drag relative w-full max-w-[560px]"
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setFocused(false) }}>
      <form onSubmit={(e) => { e.preventDefault(); submit(idx >= 0 ? rows[idx].text : query) }}>
        <label htmlFor="q" className="sr-only">Search</label>
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
        <input id="q" value={query} autoComplete="off" onChange={(e) => setQuery(e.target.value)} onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(-1, i - 1)) }
            else if (e.key === 'Escape') { setFocused(false); (e.target as HTMLInputElement).blur() }
          }}
          placeholder="Songs, albums, artists"
          className="h-11 w-full glass rounded-full pl-11 pr-4 text-[15px] outline-none placeholder:text-white/70 focus:border-white/60" />
      </form>

      {focused && rows.length > 0 && (
        <div role="listbox" className="menu-pop absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-2xl p-1.5">
          {!q && (
            <div className="flex items-center justify-between px-3 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-white/45">
              Recent searches
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setHistory([]); writeHistory([]) }} className="normal-case tracking-normal text-mute hover:text-white">Clear</button>
            </div>)}
          {rows.map((r, i) => (
            <div key={r.text + i} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2 ${i === idx ? 'bg-white/10' : ''}`}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => submit(r.text)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-[14.5px] text-white/90">
                {r.recent ? <Clock size={15} className="shrink-0 text-mute" /> : <Search size={15} className="shrink-0 text-mute" />}
                <span className="truncate">{r.text}</span>
              </button>
              {r.recent && <button aria-label={`Remove “${r.text}” from history`} onMouseDown={(e) => e.preventDefault()} onClick={() => forget(r.text)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-mute opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100"><X size={13} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
