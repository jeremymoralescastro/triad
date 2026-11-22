import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronUp, Mic2, X } from 'lucide-react'
import { VideoPane, type VideoStatus } from './VideoPane'
import type { LrcLine, LyricsResult } from '@shared/types'
import { usePlayer } from '@/lib/store'
import { seekTo, useLiveTime } from './ScrubBar'
import { LYRICS_PX, useSettings } from '@/lib/settings'

type S = { status: 'idle' | 'loading' | 'done'; data: LyricsResult | null }

/** No real timestamps? Best guess: spread the lines over the song, longer lines get more time. */
function estimate(text: string, duration: number): LrcLine[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l))
  if (!lines.length || !duration) return []
  const intro = Math.min(14, duration * 0.08), outro = Math.min(12, duration * 0.07)
  const span = Math.max(1, duration - intro - outro)
  const w = lines.map((l) => Math.max(l.length, 10))
  const total = w.reduce((a, b) => a + b, 0)
  let acc = 0
  return lines.map((l, i) => { const t = intro + (span * acc) / total; acc += w[i]; return { t, text: l } })
}

export function LyricsPanel() {
  const videoId = usePlayer((s) => s.videoId)
  const isSc = usePlayer((s) => s.backend) === 'sc'      // SoundCloud has no music videos
  const title = usePlayer((s) => s.title)
  const artist = usePlayer((s) => s.artist)
  const duration = usePlayer((s) => s.duration)
  const [st, setSt] = useState<S>({ status: 'idle', data: null })
  const syncOn = useSettings((x) => x.lyricsSync)
  const setSetting = useSettings((x) => x.set)
  const fontSize = LYRICS_PX[useSettings((x) => x.lyricsSize)]
  const scroller = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLElement | null)[]>([])
  const manualUntil = useRef(0)
  const time = useLiveTime()

  useEffect(() => {
    if (!videoId || !title) { setSt({ status: 'idle', data: null }); return }
    let live = true
    setSt({ status: 'loading', data: null })
    const t = setTimeout(async () => {          // brief debounce: title/artist settle a moment after the track changes
      let data: LyricsResult | null = null
      try { data = await window.ytm.lyrics({ title, artist, duration: usePlayer.getState().duration }) } catch { /* fall through */ }
      if (!data) {                              // nothing found → YouTube Music's own lyrics
        try { const r = await window.ytm.rpc('lyrics', { videoId }); if (r) data = { text: r.text, source: 'YouTube Music' } } catch { /* none */ }
      }
      if (live) { setSt({ status: 'done', data }); scroller.current?.scrollTo({ top: 0 }) }
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [title, artist, videoId])

  const { status, data } = st
  const realSync = !!data?.synced?.length
  const timeline = useMemo<LrcLine[]>(
    () => (!data ? [] : data.synced?.length ? data.synced : estimate(data.text, duration)),
    [data, duration])
  const showSynced = syncOn && timeline.length > 0

  // active line = the last one whose timestamp has passed (a hair early, so the highlight lands as the line is sung)
  let active = -1
  if (showSynced) for (let i = 0; i < timeline.length && timeline[i].t <= time + 0.3; i++) active = i

  useEffect(() => {
    if (!showSynced || active < 0 || Date.now() < manualUntil.current) return
    const box = scroller.current, el = lineRefs.current[active]
    if (box && el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
  }, [active, showSynced])

  const toggle = () => setSetting({ lyricsSync: !syncOn })

  // music video: look up the video version, load it in a second player, show its frames
  const [videoOpen, setVideoOpen] = useState(false)
  const [vstatus, setVstatus] = useState<VideoStatus>('looking')
  const run = useRef(0)
  const shownFor = useRef('')
  const startVideo = async () => {
    const st = usePlayer.getState(); const mine = ++run.current
    shownFor.current = `${st.videoId}|${st.title}|${st.artist}`
    if (!st.videoId) { setVstatus('none'); return }
    setVstatus('looking')
    try {
      const id = await window.ytm.rpc('musicVideo', { videoId: st.videoId, title: st.title, artist: st.artist })
      if (run.current !== mine) return
      const now = usePlayer.getState()
      if (`${now.videoId}|${now.title}|${now.artist}` !== shownFor.current) { void startVideo(); return }   // the song changed while we were looking: go again
      if (!id) { setVstatus('none'); return }
      setVstatus('loading')
      window.ytm.openVideo(id, usePlayer.getState().currentTime)
      setTimeout(() => { if (run.current === mine) setVstatus((s) => (s === 'loading' ? 'failed' : s)) }, 25000)
    } catch { if (run.current === mine) setVstatus('failed') }
  }
  const openVideo = () => { setVideoOpen(true); void startVideo() }
  const closeVideo = () => { run.current++; setVideoOpen(false); window.ytm.closeVideo() }
  const onFrame = useRef(() => setVstatus('playing')).current
  const songId = usePlayer((s) => s.videoId)
  const first = useRef(true)
  useEffect(() => {                                    // anything about the song changed while the video is open: look it up again
    if (first.current) { first.current = false; return }
    if (!videoOpen) return
    if (`${songId}|${title}|${artist}` === shownFor.current) return
    run.current++; setVstatus('looking')               // cover the old picture straight away
    const t = setTimeout(() => void startVideo(), 350) // let the new title/artist settle before looking it up
    return () => clearTimeout(t)
  }, [songId, title, artist])
  useEffect(() => { if ((vstatus === 'none' || vstatus === 'failed') && videoOpen) { const t = setTimeout(closeVideo, 2600); return () => clearTimeout(t) } }, [vstatus, videoOpen])
  useEffect(() => () => { window.ytm.closeVideo() }, [])

  return (
    <aside aria-label="Lyrics" className="relative hidden w-[300px] shrink-0 flex-col glass overflow-hidden rounded-[30px] min-[1180px]:flex">
      <h2 className="flex items-center gap-2 px-5 pb-2 pt-4 text-[15px] font-semibold text-mute">
        <Mic2 size={16} className="text-accent" />{data?.source === 'YouTube Music' ? 'Lyrics' : data?.source === 'LRCLIB' ? 'Lyrics' : 'Genius Lyrics'}
      </h2>
      <div ref={scroller} onWheel={() => { manualUntil.current = Date.now() + 4000 }} onTouchMove={() => { manualUntil.current = Date.now() + 4000 }}
        className="lyric-fade relative min-h-0 flex-1 select-text overflow-y-auto px-5 pb-20 pt-2">
        {status === 'idle' ? <p className="text-[14px] text-mute">Play a song to see its lyrics.</p>
          : status === 'loading' ? <p className="text-[14px] text-mute">Finding lyrics…</p>
          : !data ? <p className="text-[14px] text-mute">No lyrics found for this song.</p>
          : (<>
              {showSynced ? (
                <div className="flex flex-col gap-2 py-[30%]">
                  {timeline.map((l, i) => l.text === '' ? <div key={i} ref={(n) => { lineRefs.current[i] = n }} className="h-4" /> : (
                    <p key={i} ref={(n) => { lineRefs.current[i] = n }}
                      onClick={() => seekTo(l.t - 0.1)}
                      style={{ fontSize }} className={`cursor-pointer font-bold leading-snug transition-[opacity,color] duration-300 ${
                        i === active ? 'text-white' : i < active ? 'text-white/35 hover:text-white/60' : 'text-white/50 hover:text-white/75'}`}>
                      {l.text}
                    </p>))}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {data.text.split('\n').map((line, i) =>
                    /^\[.*\]$/.test(line.trim())
                      ? <p key={i} className="mt-5 text-[13px] font-semibold text-accent">{line.trim().slice(1, -1)}</p>
                      : line.trim() === '' ? <div key={i} className="h-3" />
                      : <p key={i} style={{ fontSize }} className="font-bold leading-snug text-white/90">{line}</p>)}
                </div>
              )}
              <p className="mt-8 text-[12px] text-mute">
                Lyrics from {data.source}
                {data.url && <> · <button onClick={() => window.ytm.openExternal(data.url!)} className="underline hover:text-white">view on Genius</button></>}
                {showSynced && <> · {realSync ? 'timing from LRCLIB' : 'timing estimated'}</>}
              </p>
            </>)}
      </div>

      {/* music video: the arrow is always here; clicking looks for this song's video */}
      {!isSc && (
        <button onClick={() => (videoOpen ? closeVideo() : openVideo())} aria-pressed={videoOpen} aria-label="Show music video" title="Music video"
          className="absolute bottom-3 left-3 z-10 grid size-8 place-items-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white">
          <ChevronUp size={18} strokeWidth={2.6} />
        </button>)}
      <VideoPane open={videoOpen} status={vstatus} onFrame={onFrame} onClose={closeVideo} />

      {/* sync switch: soft red ✕ = off, soft green ✓ = on */}
      <button onClick={toggle} aria-pressed={syncOn} title={syncOn ? 'Lyric sync: on' : 'Lyric sync: off'}
        className={`absolute bottom-3 right-3 z-10 flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-3 text-[12.5px] font-semibold ring-1 backdrop-blur-md transition-colors ${
          syncOn ? 'bg-[rgba(100,190,140,.16)] text-[#8fd0ae] ring-[rgba(100,190,140,.32)] hover:bg-[rgba(100,190,140,.24)]'
                 : 'bg-[rgba(214,110,110,.16)] text-[#e39b9b] ring-[rgba(214,110,110,.32)] hover:bg-[rgba(214,110,110,.24)]'}`}>
        {syncOn ? <Check size={15} strokeWidth={2.8} /> : <X size={15} strokeWidth={2.8} />}Sync
      </button>
    </aside>
  )
}
