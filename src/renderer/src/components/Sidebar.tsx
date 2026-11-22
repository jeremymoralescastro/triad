import { Home, Library, Search } from 'lucide-react'

export type View = { name: 'home' } | { name: 'search' } | { name: 'library' } | { name: 'playlist'; browseId: string; title: string }

const nav = [
  { name: 'home', label: 'Home', Icon: Home },
  { name: 'search', label: 'Search', Icon: Search },
  { name: 'library', label: 'Library', Icon: Library }
] as const

export function Sidebar({ view, go }: { view: View; go: (v: View) => void }) {
  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-line px-3 pt-14">
      {nav.map(({ name, label, Icon }) => {
        const active = view.name === name
        return (
          <button key={name} onClick={() => go({ name } as View)} aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[15px] transition-colors
              ${active ? 'bg-raise text-text' : 'text-mute hover:text-text'}`}>
            <Icon size={19} strokeWidth={active ? 2.4 : 1.8} className={active ? 'text-accent' : ''} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
