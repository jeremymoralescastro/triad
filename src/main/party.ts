import { randomBytes } from 'node:crypto'
import { connect, type MqttClient } from 'mqtt'
import type { Backend, Command, PartyStatus, PlayerState } from '@shared/types'

/**
 * Listening party: the host's Triad announces what is playing (song, position, paused) and everyone who joined with the room code follows.
 * Messages travel through a free public MQTT relay (so no one needs to open ports or run a server). The room code is the only secret:
 * it picks the relay, and it is the channel name. Nothing but song ids and positions is sent, and listeners only ever act on
 * "play this song / seek / pause", each checked first.
 */
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081']
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'          // no 0/O/1/I, easy to read out loud
const ID_OK = /^[A-Za-z0-9_-]{1,40}$/

interface Remote { backend: Backend; name: string; videoId: string; title: string; artist: string; pos: number; paused: boolean; at: number; end?: boolean }
interface Hooks { send(c: Command): void; backend(): Backend; emit(s: PartyStatus): void }

class Party {
  private h!: Hooks
  private client: MqttClient | null = null
  private role: PartyStatus['role'] = 'none'
  private code = ''
  private base = ''
  private connected = false
  private note = ''
  private name = ''
  private myId = randomBytes(6).toString('hex')
  private timers: ReturnType<typeof setInterval>[] = []
  // host
  private latest: PlayerState | null = null
  private pub = { key: '', pos: 0, at: 0 }
  private listeners = new Map<string, number>()
  private names = new Map<string, string>()      // listener id -> display name
  private myName = ''                              // remembered so a Join from Discord still carries your name
  // guest
  private remote: Remote | null = null
  private last: PlayerState | null = null
  private loading = { id: '', at: 0 }
  private cmdAt = new Map<string, number>()

  configure(h: Hooks) { this.h = h }

  status(): PartyStatus {
    const now = Date.now()
    const live = this.role === 'host' ? [...this.listeners].filter(([, t]) => now - t < 25_000).map(([id]) => id) : []
    const listeners = this.role === 'host' ? live.length : undefined
    return {
      role: this.role, connected: this.connected, code: this.code || undefined, listeners, note: this.note || undefined,
      names: this.role === 'host' ? live.map((id) => this.names.get(id) || 'A friend') : undefined,
      hostName: this.role === 'guest' && this.remote && !this.remote.end ? this.remote.name || undefined : undefined,
      hostTrack: this.role === 'guest' && this.remote && !this.remote.end ? `${this.remote.title}${this.remote.artist ? ' — ' + this.remote.artist : ''}` : undefined
    }
  }
  private emit() { try { this.h.emit(this.status()) } catch { /* ignore */ } }

  private open(url: string): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      const c = connect(url, { clientId: 'triad-' + randomBytes(5).toString('hex'), clean: true, connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30 })
      const fail = setTimeout(() => { try { c.end(true) } catch { /* ignore */ } reject(new Error('timeout')) }, 9000)
      c.once('connect', () => { clearTimeout(fail); resolve(c) })
      c.once('error', (e) => { clearTimeout(fail); try { c.end(true) } catch { /* ignore */ } reject(e) })
    })
  }
  private attach(c: MqttClient) {
    this.client = c; this.connected = true
    c.on('close', () => { if (this.client === c) { this.connected = false; this.emit() } })
    c.on('connect', () => { if (this.client === c) { this.connected = true; this.emit() } })
    c.on('error', () => { /* the library keeps retrying */ })
    c.on('message', (topic, payload) => this.onMessage(topic, payload.toString()))
  }

  async host(name = ''): Promise<PartyStatus> {
    await this.leave()
    this.name = name; if (name) this.myName = name
    let c: MqttClient | null = null, idx = -1
    for (let i = 0; i < BROKERS.length && !c; i++) { try { c = await this.open(BROKERS[i]); idx = i } catch { /* try the next relay */ } }
    if (!c) throw new Error('Couldn’t reach a relay server. Check your internet connection and try again.')
    this.code = ALPHA[idx] + Array.from(randomBytes(11), (b) => ALPHA[b % ALPHA.length]).join('')
    this.base = `triad-party/v1/${this.code}`
    this.role = 'host'; this.note = ''; this.listeners.clear(); this.names.clear(); this.pub = { key: '', pos: 0, at: 0 }
    this.attach(c)
    c.subscribe(`${this.base}/g`)
    this.timers.push(setInterval(() => this.publish(true), 4000), setInterval(() => this.emit(), 5000))
    this.publish(true); this.emit()
    return this.status()
  }

  async join(raw: string, name = ''): Promise<PartyStatus> {
    if (name) this.myName = name
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const idx = ALPHA.indexOf(code[0] ?? '')
    if (code.length !== 12 || idx < 0 || idx >= BROKERS.length || [...code].some((ch) => !ALPHA.includes(ch))) throw new Error('That room code doesn’t look right. It has 12 letters and numbers.')
    await this.leave()
    let c: MqttClient
    try { c = await this.open(BROKERS[idx]) } catch { throw new Error('Couldn’t reach the relay server for that code. Check your internet connection.') }
    this.code = code; this.base = `triad-party/v1/${code}`; this.role = 'guest'; this.remote = null; this.note = 'Waiting for the host…'
    this.attach(c)
    c.subscribe(`${this.base}/s`)           // the host's latest state is retained, so it arrives right away
    const hi = () => { try { c.publish(`${this.base}/g`, JSON.stringify({ id: this.myId, name: this.myName })) } catch { /* ignore */ } }
    hi(); this.timers.push(setInterval(hi, 8000))
    this.emit()
    return this.status()
  }

  async leave(): Promise<PartyStatus> {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    const c = this.client
    if (c) {
      if (this.role === 'host') { try { c.publish(`${this.base}/s`, JSON.stringify({ v: 1, end: true }), { retain: true }) } catch { /* ignore */ } }
      this.client = null
      await new Promise((r) => setTimeout(r, this.role === 'host' ? 300 : 0))      // let the goodbye go out
      try { c.end(true) } catch { /* ignore */ }
    }
    this.role = 'none'; this.code = ''; this.base = ''; this.connected = false; this.note = ''; this.remote = null; this.listeners.clear(); this.names.clear()
    this.emit()
    return this.status()
  }

  // ---- called with every state update from the player ----
  onLocalState(s: PlayerState) {
    this.last = s
    if (this.role === 'host') {
      this.latest = s
      if (s.adActive || !s.videoId) return
      const key = `${s.backend}|${s.videoId}|${s.paused}`
      const expected = this.pub.pos + (s.paused ? 0 : (Date.now() - this.pub.at) / 1000)
      if (key !== this.pub.key || Math.abs(s.currentTime - expected) > 2.5) this.publish(false)     // new song, play/pause, or a seek
    } else if (this.role === 'guest') this.apply()
  }

  private publish(heartbeat: boolean) {
    const s = this.latest
    if (!this.client || !this.connected || !s || !s.videoId || s.adActive) return
    void heartbeat
    this.pub = { key: `${s.backend}|${s.videoId}|${s.paused}`, pos: s.currentTime, at: Date.now() }
    this.client.publish(`${this.base}/s`, JSON.stringify({ v: 1, name: this.name, backend: s.backend, videoId: s.videoId, title: s.title, artist: s.artist, pos: s.currentTime, paused: s.paused }), { retain: true })
  }

  private onMessage(topic: string, text: string) {
    if (this.role === 'host' && topic.endsWith('/g')) {
      try { const m = JSON.parse(text); if (typeof m?.id === 'string' && m.id !== this.myId) { const had = this.listeners.size; const id = m.id.slice(0, 20), nm = typeof m.name === 'string' ? m.name.replace(/[\u0000-\u001f]/g, '').slice(0, 40) : ''; this.listeners.set(id, Date.now()); const oldName = this.names.get(id); if (nm) this.names.set(id, nm); if (this.listeners.size !== had || (nm && nm !== oldName)) this.emit() } } catch { /* ignore */ }
      return
    }
    if (this.role !== 'guest' || !topic.endsWith('/s')) return
    let m: any
    try { m = JSON.parse(text) } catch { return }
    if (!m || m.v !== 1) return
    if (m.end) { this.remote = { backend: 'ytm', name: '', videoId: '', title: '', artist: '', pos: 0, paused: true, at: Date.now(), end: true }; this.note = 'The host ended the party.'; this.emit(); return }
    if ((m.backend !== 'ytm' && m.backend !== 'sc') || typeof m.videoId !== 'string' || !ID_OK.test(m.videoId) || !Number.isFinite(m.pos) || m.pos < 0 || m.pos > 86_400) return
    this.remote = { backend: m.backend, name: String(m.name ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 40), videoId: m.videoId, title: String(m.title ?? '').slice(0, 150), artist: String(m.artist ?? '').slice(0, 150), pos: m.pos, paused: !!m.paused, at: Date.now() }
    this.note = ''
    this.emit(); this.apply()
  }

  /** make this player match the host's: same song, same play/pause, same spot (within ~1.5 s) */
  private apply() {
    const r = this.remote, s = this.last
    if (!r || r.end) return
    if (r.backend !== this.h.backend()) {
      const n = `The host is on ${r.backend === 'sc' ? 'SoundCloud' : 'YouTube Music'}. Switch service (top-left logo) to listen along.`
      if (this.note !== n) { this.note = n; this.emit() }
      return
    }
    if (this.note) { this.note = ''; this.emit() }
    const now = Date.now()
    const expected = r.pos + (r.paused ? 0 : (now - r.at) / 1000)
    const once = (k: string, ms: number, c: Command) => { if (now - (this.cmdAt.get(k) ?? 0) < ms) return; this.cmdAt.set(k, now); this.h.send(c) }
    if (!s || s.videoId !== r.videoId) {
      if (this.loading.id !== r.videoId || now - this.loading.at > 6000) { this.loading = { id: r.videoId, at: now }; this.h.send({ type: 'playTrack', videoId: r.videoId }) }
      return
    }
    if (s.paused !== r.paused) once('pp', 1500, { type: r.paused ? 'pause' : 'play' })
    if (s.duration > 0 && Math.abs(s.currentTime - expected) > 1.5) once('seek', 3000, { type: 'seek', seconds: Math.max(0, expected) })
  }
}

export const party = new Party()
