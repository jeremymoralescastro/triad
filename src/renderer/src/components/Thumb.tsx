import { useEffect, useState } from 'react'

/** Normalise odd thumbnail URLs (protocol-relative, http, missing size suffix). */
export const fixUrl = (u?: string | null) => (!u ? '' : u.startsWith('//') ? 'https:' + u : u.replace(/^http:\/\//, 'https://'))

/**
 * Cover image that never shows the browser's broken-image icon: no referrer (some Google CDNs reject
 * app referrers), one retry, then a soft gradient placeholder.
 */
export function Thumb({ src, className = '', round = false }: { src?: string | null; className?: string; round?: boolean }) {
  const url = fixUrl(src)
  const [tries, setTries] = useState(0)
  useEffect(() => setTries(0), [url])
  if (!url || tries >= 2)
    return <span className={`block size-full bg-gradient-to-br from-accent/40 to-brand/70 ${round ? 'rounded-full' : ''}`} />
  return (
    <img key={tries} src={url} alt="" draggable={false} loading="lazy"
      referrerPolicy="no-referrer" onError={() => setTries((n) => n + 1)} className={`size-full object-cover ${className}`} />
  )
}
