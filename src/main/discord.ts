import { createHash } from 'node:crypto'
import net from 'node:net'
import { join } from 'node:path'
import type { PlayerState } from '@shared/types'
import { cleanTitle } from '@shared/title'

/**
 * Discord "Listening to …" status, spoken over Discord's local IPC pipe (no extra packages).
 * BUILT_IN_APP_ID below is Triad's own Discord application ID, so users never have to enter one.
 * Needs a Discord application ID (discord.com/developers → New Application; its name is what shows up as
 * "Listening to <name>"). Does nothing unless enabled in Settings, and quietly retries if Discord isn't open.
 */
/** Paste Triad's Discord Application ID here once (discord.com/developers → New Application → name it Triad). */
export const BUILT_IN_APP_ID: string = '1573862688478597150'

const frame = (op: number, data: object) => {
  const body = Buffer.from(JSON.stringify(data))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0); head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}
const pipePath = (i: number) =>
  process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}` : join(process.env['XDG_RUNTIME_DIR'] || process.env['TMPDIR'] || '/tmp', `discord-ipc-${i}`)

class Presence {
  private sock: net.Socket | null = null
  private ready = false
  private enabled = false
  private clientId = ''
  private retry: ReturnType<typeof setTimeout> | undefined
  private buf = Buffer.alloc(0)
  private activity: object | null = null     // what we last wanted to show
  private lastKey = ''
  private lastSent = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private partyCode: string | null = null      // hosting a listening party: show a Join button on the profile
  private partySize = 1
  private partyWith = ''                         // "with Alice, Bob" (host) or "with <host>" (guest)
  private lastState: PlayerState | null = null
  /** a friend pressed Join on our activity: Discord hands us the room code (the "secret") */
  onJoin: ((secret: string) => void) | null = null

  setParty(code: string | null, size = 1, who: string[] = []) {
    const n = code ? Math.max(1, size) : 1
    const w = who.length ? 'with ' + (who.length > 3 ? `${who.slice(0, 3).join(', ')} +${who.length - 3}` : who.join(', ')) : ''
    if (code === this.partyCode && n === this.partySize && w === this.partyWith) return
    this.partyCode = code; this.partySize = n; this.partyWith = w
    if (this.lastState) this.update(this.lastState)
  }

  configure(enabled: boolean, clientId: string) {
    const id = (BUILT_IN_APP_ID || clientId).trim()
    const changed = id !== this.clientId
    this.enabled = enabled && /^\d{15,25}$/.test(id)
    this.clientId = id
    if (!this.enabled || changed) this.disconnect()
    if (this.enabled) this.connect()
  }

  private disconnect() {
    clearTimeout(this.retry); clearTimeout(this.timer)
    try { this.sock?.destroy() } catch { /* ignore */ }
    this.sock = null; this.ready = false; this.buf = Buffer.alloc(0); this.lastKey = ''
  }

  private connect(i = 0) {
    if (this.sock || !this.enabled) return
    const s = net.connect(pipePath(i))
    this.sock = s
    s.on('connect', () => s.write(frame(0, { v: 1, client_id: this.clientId })))
    s.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d])
      while (this.buf.length >= 8) {
        const len = this.buf.readInt32LE(4)
        if (this.buf.length < 8 + len) break
        const msg = (() => { try { return JSON.parse(this.buf.subarray(8, 8 + len).toString()) } catch { return null } })()
        this.buf = this.buf.subarray(8 + len)
        if (msg?.evt === 'READY') {
          this.ready = true
          try { s.write(frame(1, { cmd: 'SUBSCRIBE', evt: 'ACTIVITY_JOIN', args: {}, nonce: String(Math.random()) })) } catch { /* ignore */ }   // tell us when someone presses Join
          this.flush(true)
        }
        if (msg?.evt === 'ACTIVITY_JOIN' && typeof msg?.data?.secret === 'string') { try { this.onJoin?.(msg.data.secret) } catch { /* ignore */ } }
      }
    })
    const gone = () => {
      if (this.sock !== s) return
      this.sock = null; this.ready = false
      if (this.enabled) this.retry = setTimeout(() => (i < 3 ? this.connect(i + 1) : this.connect(0)), i < 3 ? 300 : 15_000)
    }
    s.on('error', gone); s.on('close', gone)
  }

  private flush(force = false) {
    if (!this.ready || !this.sock) return
    this.lastSent = Date.now(); this.lastKey = JSON.stringify(this.activity)
    void force
    this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity }, nonce: String(Math.random()) }))
  }

  update(s: PlayerState) {
    this.lastState = s
    if (!this.enabled) return
    let activity: object | null = null
    if (s.videoId && s.title && !s.paused && !s.adActive) {
      const start = Math.round((Date.now() - s.currentTime * 1000) / 1000) * 1000
      activity = {
        type: this.partyCode ? 0 : 2,                         // "Listening to"; while hosting a party use "Playing" so Discord shows the Join button
        details: (cleanTitle(s.title, s.artist) || s.title).slice(0, 120),     // same cleaned title Triad shows
        state: ((s.artist || 'Unknown artist') + (this.partyWith ? ` · ${this.partyWith}` : '')).slice(0, 120),
        timestamps: s.duration > 0 ? { start, end: start + Math.round(s.duration) * 1000 } : { start },
        assets: { ...(s.artwork ? { large_image: s.artwork, large_text: this.partyWith ? `Listening ${this.partyWith} on Triad` : (s.album || s.title) } : {}) },
        // hosting a party: friends see a Join button; the secret is the room code (only the person pressing Join receives it)
        ...(this.partyCode ? {
          party: { id: 'triad-' + createHash('sha256').update(this.partyCode).digest('hex').slice(0, 16), size: [this.partySize, Math.max(10, this.partySize)] },
          secrets: { join: this.partyCode }
        } : {})
      }
    }
    this.activity = activity
    // only talk to Discord when something meaningful changed (song, pause, or a seek that moved the timeline)
    const key = JSON.stringify(activity && { ...(activity as any), timestamps: Math.round(((activity as any).timestamps.start as number) / 4000) })
    if (key === this.lastKey && this.lastKey) return
    clearTimeout(this.timer)
    const wait = Math.max(0, 3000 - (Date.now() - this.lastSent))     // Discord rate-limits presence updates
    this.timer = setTimeout(() => { this.lastKey = key; this.flush() }, wait)
  }
}

export const discord = new Presence()
