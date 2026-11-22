const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
const unescapeHtml = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENT[m] ?? m)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SEP = '[-–—:|]'

/** Words that only ever describe the upload, not the song. A bracket made ONLY of these is removed; "(Remix)", "(feat. X)", "(Live)" stay. */
const NOISE = new Set(['official', 'music', 'video', 'videos', 'lyric', 'lyrics', 'audio', 'visualizer', 'visualiser', 'visualizers', 'hd', 'hq', '4k', '8k', '1080p', '720p', 'mv', 'm/v', 'clip',
  'full', 'new', 'with', 'w', 'and', 'the', 'a', 'out', 'now', 'version', 'color', 'coded', 'hd+', 'topic', 'dir', 'directed', 'by', 'shot', 'wshh', 'exclusive', 'premiere', 'free', 'download'])
const onlyNoise = (s: string) => {
  const words = s.toLowerCase().replace(/[^a-z0-9+/\s]/g, ' ').split(/\s+/).filter(Boolean)
  return words.length > 0 && words.every((w) => NOISE.has(w)) && words.some((w) => w === 'official' || w === 'video' || w === 'lyrics' || w === 'lyric' || w === 'audio' || w === 'visualizer' || w === 'visualiser' || w === 'mv' || w === 'hd' || w === 'hq' || w === '4k' || w === 'clip')
}
function stripNoise(title: string): string {
  let t = title
  t = t.replace(/\s*[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, (m, inner: string) => (onlyNoise(inner) ? '' : m))          // (Official Music Video) [HD] …
  t = t.replace(new RegExp(`\\s*${'[-–—:|]'}\\s*([^-–—:|]+)$`), (m, tail: string) => (onlyNoise(tail) ? '' : m))   // … - Official Video
  t = t.replace(/\s+official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visuali[sz]er)\s*$/i, '')              // … Official Video
  return t.replace(/\s{2,}/g, ' ').trim()
}

/**
 * "PlaqueBoyMax - Mean Street (Official Video)" by PlaqueBoyMax → "Mean Street (Official Video)".
 * Also drops upload noise like "(Official Music Video)", "[HD]", "- Lyrics" (a word list, see NOISE).
 * Removes the artist when the title starts or ends with it (any credited artist counts); never leaves an empty title.
 */
export function cleanTitle(title: string | null | undefined, artist?: string | null): string {
  let t = unescapeHtml((title ?? '').trim())
  const cleaned = stripNoise(t)
  if (cleaned.length >= 2) t = cleaned
  if (!t || !artist) return t
  const names = unescapeHtml(artist).split(/\s*(?:,|&|\band\b|\bx\b|×|feat\.?|ft\.?|with)\s*/i).map((n) => n.trim()).filter((n) => n.length >= 2)
  if (names.length) {
    const alt = names.map(esc).join('|')
    const JOIN = '\\s*(?:,|&|\\band\\b|\\bx\\b|×|feat\\.?|ft\\.?|with)\\s*'            // "A & B", "A, B", "A x B" …
    const group = `(?:${alt})(?:${JOIN}(?:${alt}))*`
    const next = t.replace(new RegExp(`^\\s*${group}\\s*${SEP}\\s*`, 'i'), '').replace(new RegExp(`\\s*${SEP}\\s*${group}\\s*$`, 'i'), '').trim()
    if (next.length >= 2) t = next
  }
  return t
}
