import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app, type Session } from 'electron'

/** A cookie in a neutral shape (works for both CDP cookies and cookies.txt lines). */
export interface RawCookie {
  name: string
  value: string
  domain: string            // leading "." = domain cookie, none = host-only
  path: string
  secure: boolean
  httpOnly: boolean
  expires?: number          // unix seconds; <= 0 / undefined = session cookie
  sameSite?: string         // 'Lax' | 'Strict' | 'None' (CDP spelling)
}

const THIRTY_DAYS = 30 * 24 * 3600

/** Put Google/YouTube cookies into the engine's session. Returns how many were set. */
export async function setCookies(ses: Session, list: RawCookie[]): Promise<number> {
  let ok = 0
  for (const c of list) {
    if (!c.name || !/(google|youtube)\./i.test(c.domain + '.')) continue
    const host = c.domain.replace(/^\./, '')
    const hostOnly = !c.domain.startsWith('.') || c.name.startsWith('__Host-')
    const ss = (c.sameSite ?? '').toLowerCase()
    try {
      await ses.cookies.set({
        url: `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`,
        name: c.name, value: c.value,
        domain: hostOnly ? undefined : c.domain,
        path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly,
        // session cookies would vanish when Triad quits; keep the login for a month instead
        expirationDate: c.expires && c.expires > 0 ? c.expires : Math.floor(Date.now() / 1000) + THIRTY_DAYS,
        sameSite: ss === 'lax' ? 'lax' : ss === 'strict' ? 'strict' : ss === 'none' && c.secure ? 'no_restriction' : 'unspecified'
      })
      ok++
    } catch { /* skip cookies Chromium refuses */ }
  }
  await ses.cookies.flushStore()
  return ok
}

/** Netscape cookies.txt (what the "Get cookies.txt" browser extensions export). */
export function parseNetscape(text: string): RawCookie[] {
  const out: RawCookie[] = []
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false
    if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice(10) }
    else if (!line.trim() || line.startsWith('#')) continue
    const [domain, , path, secure, expires, name, ...rest] = line.split('\t')
    if (!name || !domain) continue
    out.push({ domain, path, secure: secure === 'TRUE', httpOnly, expires: Number(expires), name, value: rest.join('\t') })
  }
  return out
}

/** Import a cookies.txt the user picked. Returns the number of cookies set. */
export async function importCookieFile(ses: Session, file: string): Promise<number> {
  const n = await setCookies(ses, parseNetscape(readFileSync(file, 'utf8')))
  console.log(`[cookies] imported ${n} from ${file}`)
  return n
}

/**
 * Dev/legacy fallback: if a cookies.txt sits next to the app, import it, then DELETE it
 * (it's a login key).
 */
export async function importCookiesIfPresent(ses: Session) {
  const file = [join(app.getAppPath(), 'cookies.txt'), join(process.cwd(), 'cookies.txt'), join(app.getPath('userData'), 'cookies.txt')]
    .find(existsSync)
  if (!file) return
  await importCookieFile(ses, file)
  try { unlinkSync(file) } catch {}
}
