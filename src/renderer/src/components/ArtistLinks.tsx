import type { Item } from '@shared/types'
import { openArtist } from '@/lib/view'

/** "Artist1, Artist2" with each name clickable → artist profile. Falls back to plain text. */
export function ArtistLinks({ item, text, className = '' }: { item?: Item; text?: string; className?: string }) {
  const credits = item?.artists
  if (credits?.length)
    return (
      <span className={className}>
        {credits.map((a, i) => (
          <span key={i}>
            {i > 0 && ', '}
            <button onClick={(e) => { e.stopPropagation(); openArtist(a) }} className="hover:text-white hover:underline">{a.name}</button>
          </span>
        ))}
      </span>
    )
  const t = text ?? item?.artist ?? item?.subtitle ?? ''
  if (!t) return null
  return <span className={className}>{t}</span>
}
