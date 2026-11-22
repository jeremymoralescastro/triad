import { useRef } from 'react'
import { Disc3, Heart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { openAlbum, openArtist, openSongMenu } from '@/lib/view'
import { Thumb } from './Thumb'
import { NextPeek } from './QueueBar'
import { usePlayer } from '@/lib/store'
import { cleanTitle } from '@/lib/title'
import { ScrubBar } from './ScrubBar'
import { VolumeSlider } from './VolumeSlider'
import { PlaybackMenu } from './PlaybackMenu'

const cmd = window.ytm.command

export function PlayerBar() {
  const s = usePlayer()
  const liked = s.likeStatus === 'LIKE'
  const RepeatIcon = s.repeat === 'ONE' ? Repeat1 : Repeat
  const muted = s.volume <= 0
  const lastVol = useRef(60)                       // volume to come back to when un-muting
  if (s.volume > 0) lastVol.current = s.volume
  const toggleMute = () => cmd({ type: 'volume', value: muted ? lastVol.current || 60 : 0 })

  return (
    <footer className="glass mx-2 mb-2 mt-2 grid h-[84px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(340px,600px)_minmax(0,1fr)] items-center gap-6 rounded-full pl-4 pr-8">
      <div className="flex min-w-0 items-center gap-3 pl-2">
        <NextPeek />
        <div key={s.videoId ?? 'none'} className="now-in relative z-10 flex min-w-0 items-center gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-accent to-brand shadow-[inset_0_1px_0_rgba(255,255,255,.5),-8px_0_16px_rgba(0,0,0,.45)]">
          <Thumb src={s.artwork} round />
        </div>
        <div className="min-w-0" onContextMenu={(e) => s.videoId && openSongMenu({ videoId: s.videoId, title: s.title, artist: s.artist, album: s.album, albumId: s.albumId }, e)}>
          <div className="truncate text-[15px] font-semibold">{s.adActive ? 'Skipping an ad…' : cleanTitle(s.title, s.artist) || 'Nothing playing'}</div>
          <div className="truncate text-[13px] text-mute">
            {s.artist && <button onClick={() => openArtist({ name: s.artist })} className="max-w-full truncate hover:text-white hover:underline">{s.artist}</button>}
          </div>
        </div>
        <button onClick={() => cmd({ type: 'like' })} aria-pressed={liked} aria-label="Like"
          className={`ml-1 shrink-0 rounded-full p-1.5 ${liked ? 'text-accent' : 'text-mute hover:text-white'}`}>
          <Heart size={19} fill={liked ? 'currentColor' : 'none'} />
        </button>
        {s.album && (
          <button aria-label="Go to album" title={`Go to album: ${s.album}`} onClick={() => openAlbum({ title: s.album, artist: s.artist, browseId: s.albumId || undefined })}
            className="shrink-0 rounded-full p-1.5 text-mute hover:text-white"><Disc3 size={19} /></button>)}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-6">
          <button aria-label="Shuffle" aria-pressed={s.shuffle} title={s.shuffle ? 'Shuffle: on' : 'Shuffle: off'} onClick={() => cmd({ type: 'shuffle' })}
            className={`relative ${s.shuffle ? 'text-accent' : 'text-mute hover:text-white'}`}>
            <Shuffle size={18} />{s.shuffle && <i className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />}
          </button>
          <button aria-label="Previous" onClick={() => cmd({ type: 'previous' })} className="text-white/90 hover:text-white"><SkipBack size={22} fill="currentColor" /></button>
          <button aria-label={s.paused ? 'Play' : 'Pause'} onClick={() => cmd({ type: 'togglePlay' })}
            className="lens grid size-12 place-items-center rounded-full text-white transition-transform hover:scale-105 active:scale-95">
            {s.paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
          </button>
          <button aria-label="Next" onClick={() => cmd({ type: 'next' })} className="text-white/90 hover:text-white"><SkipForward size={22} fill="currentColor" /></button>
          <button aria-label="Repeat" aria-pressed={s.repeat !== 'NONE'} onClick={() => cmd({ type: 'repeat' })}
            title={s.repeat === 'ONE' ? 'Repeat: this song' : s.repeat === 'ALL' ? 'Repeat: all' : 'Repeat: off'}
            className={`relative ${s.repeat !== 'NONE' ? 'text-accent' : 'text-mute hover:text-white'}`}>
            <RepeatIcon size={18} />{s.repeat !== 'NONE' && <i className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />}
          </button>
        </div>
        <ScrubBar />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-3 [&>button]:shrink-0">
        <PlaybackMenu />
        <button aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={toggleMute}
          className={muted ? 'text-accent' : 'text-mute hover:text-white'}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <VolumeSlider />
      </div>
    </footer>
  )
}
