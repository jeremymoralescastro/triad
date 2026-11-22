import { ipcRenderer } from 'electron'
import { CH, EQ_FREQS, type Fx } from '@shared/types'

/**
 * Equalizer: the page's <video> is routed through a chain of Web Audio filters (8 bands).
 * The chain is only built once a non-flat setting is requested, so with a flat EQ the audio path is untouched.
 */
const log = (m: string) => ipcRenderer.send(CH.engineLog, m)
let graph: { ctx: AudioContext; filters: BiquadFilterNode[]; pre: GainNode; dry: GainNode; rvWet: GainNode; flWet: GainNode; out: GainNode } | null = null
let masterVol = 1                    // overall level, applied at the very end of the chain (SoundCloud keeps the element itself at 100%)
let fx: Fx = (() => { try { const j = JSON.parse(sessionStorage.getItem('ytmd:fx') || '{}'); return { reverb: +j.reverb || 0, flanger: +j.flanger || 0 } } catch { return { reverb: 0, flanger: 0 } } })()
export const getFx = () => fx

/** A synthetic room: decaying stereo noise, ~2.4 s. */
function impulse(ctx: AudioContext) {
  const len = Math.floor(ctx.sampleRate * 2.4), buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
  }
  return buf
}

function build(v: HTMLMediaElement) {
  const ctx = new AudioContext()
  const src = ctx.createMediaElementSource(v)
  const filters = EQ_FREQS.map((f, i) => {
    const b = ctx.createBiquadFilter()
    b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'
    b.frequency.value = f
    b.Q.value = 1.0
    b.gain.value = 0
    return b
  })
  const pre = ctx.createGain()                      // headroom so boosted bands don't clip
  let node: AudioNode = src
  for (const f of filters) { node.connect(f); node = f }
  node.connect(pre)
  // effects: dry path + reverb (convolver) + flanger (short modulated delay with feedback), mixed by the slider
  const out = ctx.createGain(); out.gain.value = masterVol; out.connect(ctx.destination)
  const dry = ctx.createGain(); pre.connect(dry); dry.connect(out)
  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx)
  const rvWet = ctx.createGain(); rvWet.gain.value = 0; pre.connect(conv); conv.connect(rvWet); rvWet.connect(out)
  const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.004
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35
  const depth = ctx.createGain(); depth.gain.value = 0.0028
  lfo.connect(depth); depth.connect(delay.delayTime); lfo.start()
  const fb = ctx.createGain(); fb.gain.value = 0.55; delay.connect(fb); fb.connect(delay)
  const flWet = ctx.createGain(); flWet.gain.value = 0; pre.connect(delay); delay.connect(flWet); flWet.connect(out)
  ctx.resume().catch(() => {})
  graph = { ctx, filters, pre, dry, rvWet, flWet, out }
  log('eq: audio graph built')
}

let eqGains: number[] = []
function applyFxLevels() {
  if (!graph) return
  const t = graph.ctx.currentTime, r = Math.max(0, Math.min(1, fx.reverb)), f = Math.max(0, Math.min(1, fx.flanger))
  graph.dry.gain.setTargetAtTime(1 - Math.max(r, f) * 0.45, t, 0.04)
  graph.rvWet.gain.setTargetAtTime(r * 1.1, t, 0.04)
  graph.flWet.gain.setTargetAtTime(f * 0.9, t, 0.04)
}
export function applyFx(next: Fx) {
  fx = next
  try { sessionStorage.setItem('ytmd:fx', JSON.stringify(fx)) } catch { /* ignore */ }
  applyEq(eqGains)                                   // builds the graph if needed, then sets the levels
}

export function applyEq(gains: number[]) {
  eqGains = gains
  try { sessionStorage.setItem('ytmd:eq', JSON.stringify(gains)) } catch { /* ignore */ }
  const flat = gains.every((g) => Math.abs(g) < 0.05) && fx.reverb < 0.01 && fx.flanger < 0.01
  let tries = 0
  const go = () => {
    const v = document.querySelector<HTMLMediaElement>('video, audio[data-triad]')
    if (!graph) {
      if (flat) return                              // nothing to do
      if (!v) { if (tries++ < 40) setTimeout(go, 500); return }   // the player isn't on the page yet
      try { build(v) } catch (e) { log(`eq: couldn't build graph (${e})`); return }
    }
    const g = graph!
    gains.forEach((val, i) => { if (g.filters[i]) g.filters[i].gain.setTargetAtTime(val, g.ctx.currentTime, 0.05) })
    const boost = Math.max(0, ...gains)
    g.pre.gain.setTargetAtTime(Math.pow(10, -(boost * 0.85) / 20), g.ctx.currentTime, 0.05)
    applyFxLevels()
    if (g.ctx.state !== 'running') g.ctx.resume().catch(() => {})
  }
  go()
}

/** Called on every page load / tick: restores the saved curve, keeps the audio context awake. */
export function eqKeepAlive() {
  if (graph && graph.ctx.state === 'suspended') graph.ctx.resume().catch(() => {})
}
export function restoreEq() {
  try { const raw = sessionStorage.getItem('ytmd:eq'); applyEq(raw ? JSON.parse(raw) : [0, 0, 0, 0, 0, 0, 0, 0]) } catch { /* ignore */ }
}

/** overall volume (0..1) inside the audio chain, so the media element itself can stay at 100% */
export function setMasterVolume(v: number) {
  masterVol = Math.max(0, Math.min(1, v))
  if (graph) graph.out.gain.setTargetAtTime(masterVol, graph.ctx.currentTime, 0.02)
}
/** build the chain now (needed for setMasterVolume to have any effect) */
export function ensureGraph() {
  if (graph) return
  const v = document.querySelector<HTMLMediaElement>('video, audio[data-triad]')
  if (v) try { build(v) } catch (e) { log(`eq: couldn't build graph (${e})`) }
}
