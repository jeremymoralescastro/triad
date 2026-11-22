import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AI playlists. Who writes the song list, in order:
 *   1. Claude, if you saved your own Anthropic API key (best results);
 *   2. a local model through Ollama (free, private, nothing leaves your PC), found automatically at localhost:11434;
 *   3. nothing: the UI then builds the playlist with plain "smart search" (no AI at all).
 * The key is stored encrypted with the operating system in its own file, never in settings.json, and is never sent to the UI.
 */
const CLAUDE_MODEL = 'claude-sonnet-5-5'
const OLLAMA = 'http://127.0.0.1:11434'
const file = () => join(app.getPath('userData'), 'ai-key.bin')
let cached: string | null | undefined

function readKey(): string | null {
  if (cached !== undefined) return cached
  try { cached = existsSync(file()) ? safeStorage.decryptString(readFileSync(file())) : null } catch { cached = null }
  return cached ?? null
}
export const hasAiKey = () => !!readKey()
export function setAiKey(k: string) {
  const key = k.trim()
  if (!key) { rmSync(file(), { force: true }); cached = null; return }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer can’t encrypt the key safely, so Triad won’t store it.')
  writeFileSync(file(), safeStorage.encryptString(key)); cached = key
}

/** the first chat model Ollama has installed (null = Ollama isn't running or has no model) */
let ollamaCache: { at: number; model: string | null } | null = null
export async function ollamaModel(): Promise<string | null> {
  if (ollamaCache && Date.now() - ollamaCache.at < 10_000) return ollamaCache.model
  let model: string | null = null
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500)
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: ctl.signal }); clearTimeout(t)
    const j: any = await r.json()
    const chat: string[] = (j?.models ?? []).map((m: any) => String(m?.name ?? '')).filter((n: string) => n && !/embed|nomic|bge|minilm/i.test(n))
    model = chat.find((n) => /llama3|qwen|gemma|mistral|phi/i.test(n)) ?? chat[0] ?? null
  } catch { model = null }
  ollamaCache = { at: Date.now(), model }
  return model
}

export type AiStatus = { provider: 'claude' | 'ollama' | 'none'; model?: string }
export async function aiStatus(): Promise<AiStatus> {
  if (hasAiKey()) return { provider: 'claude' }
  const m = await ollamaModel()
  return m ? { provider: 'ollama', model: m } : { provider: 'none' }
}

export interface AiPlaylist { name: string; songs: { title: string; artist: string }[] }

const systemPrompt = (n: number, service: string) =>
  `You are a music curator building a playlist that will be searched for on ${service}. Reply with ONLY a JSON object, no other text: ` +
  `{"name": "a short playlist title (max 50 characters)", "songs": [{"title": "...", "artist": "..."}]}. ` +
  `Give exactly ${n} real, existing songs that fit the user's description, with the real title and main artist of each. ` +
  `Vary the artists, no duplicates, prefer the original recordings unless the user asks for covers or remixes.`

async function askClaude(key: string, system: string, prompt: string): Promise<string> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60_000)
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content: prompt }] })
    })
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'The AI took too long to answer.' : 'Couldn’t reach Anthropic. Check your internet connection.')
  } finally { clearTimeout(timer) }
  const body: any = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Anthropic rejected that API key. Check it in Settings → AI playlists.')
    if (res.status === 429) throw new Error('Anthropic says you’re sending too many requests, or the account is out of credit.')
    throw new Error(`Anthropic error: ${body?.error?.message ?? res.status}`)
  }
  return (body?.content ?? []).map((c: any) => (c?.type === 'text' ? c.text : '')).join('')
}

async function askOllama(model: string, system: string, prompt: string): Promise<string> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 240_000)       // the first request also loads the model into memory
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.8, num_predict: 3000 }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
    })
    if (!res.ok) throw new Error(`Ollama said: ${(await res.text().catch(() => '')).slice(0, 160) || res.status}`)
    const j: any = await res.json()
    return String(j?.message?.content ?? '')
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('The local AI took too long to answer.')
    throw e
  } finally { clearTimeout(timer) }
}

function parsePlan(text: string, n: number, fallbackName: string): AiPlaylist {
  let parsed: any
  const obj = text.match(/\{[\s\S]*\}/), arr = text.match(/\[[\s\S]*\]/)
  try { parsed = JSON.parse(obj ? obj[0] : text) } catch {
    try { parsed = JSON.parse(arr ? arr[0] : text) } catch { throw new Error('The AI answered in a format Triad couldn’t read.') }
  }
  const list: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.songs) ? parsed.songs : []
  const seen = new Set<string>()
  const songs = list
    .map((s) => ({ title: String(s?.title ?? s?.song ?? '').slice(0, 150).trim(), artist: String(s?.artist ?? '').slice(0, 150).trim() }))
    .filter((s) => s.title && !seen.has((s.title + '|' + s.artist).toLowerCase()) && !!seen.add((s.title + '|' + s.artist).toLowerCase()))
  if (!songs.length) throw new Error('The AI didn’t suggest any songs.')
  return { name: String(parsed?.name ?? '').slice(0, 100).trim() || fallbackName.slice(0, 50), songs: songs.slice(0, n) }
}

export async function suggestPlaylist(prompt: string, count: number, service: string): Promise<AiPlaylist> {
  const n = Math.max(5, Math.min(50, Math.round(count) || 20))
  const st = await aiStatus()
  if (st.provider === 'none') throw new Error('NO_AI')
  const system = systemPrompt(n, service)
  const text = st.provider === 'claude' ? await askClaude(readKey()!, system, prompt) : await askOllama(st.model!, system, prompt)
  return parsePlan(text, n, prompt)
}
