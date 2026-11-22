import { webFrame } from 'electron'

/**
 * Belt-and-braces on top of the Ghostery/uBO engine. Equivalent in spirit to uBO's
 * `json-prune` + `trusted-replace-fetch-response` scriptlets: strips ad fields from the
 * player response before YouTube's player ever sees them. If YouTube changes field names,
 * update AD_KEYS. Safe to delete if the engine's own scriptlets already cover you.
 */
export function installEarlyAdPatch() {
  webFrame.executeJavaScript(`(() => {
    const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
    const prune = (o) => { if (o && typeof o === 'object') for (const k of AD_KEYS) if (k in o) delete o[k]; return o; };

    const parse = JSON.parse;
    JSON.parse = function (...a) {
      const r = parse.apply(this, a);
      try { if (r && (r.playerResponse || r.streamingData || r.adPlacements)) { prune(r); prune(r.playerResponse); } } catch {}
      return r;
    };

    const f = window.fetch;
    window.fetch = async function (...a) {
      const res = await f.apply(this, a);
      try {
        const u = typeof a[0] === 'string' ? a[0] : a[0] && a[0].url;
        if (u && u.includes('/youtubei/v1/player')) {
          const j = await res.clone().json();
          prune(j);
          return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: res.headers });
        }
      } catch {}
      return res;
    };
  })();`)
}

/** Last line of defence: if an ad slips through, mute + fast-forward + click skip. */
export function skipAdIfShowing(video: HTMLVideoElement | null): boolean {
  const player = document.querySelector('#movie_player')
  const showing = !!player?.classList.contains('ad-showing') || !!document.querySelector('.ytp-ad-player-overlay')
  if (!showing) return false
  document.querySelector<HTMLElement>('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')?.click()
  if (video) {
    video.muted = true
    if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration
    video.playbackRate = 16
  }
  return true
}

/** Stop the page from registering a beforeunload veto (see will-prevent-unload in main/ipc.ts). */
export function allowNavigation() {
  webFrame.executeJavaScript(`(() => {
    window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true);
    try { Object.defineProperty(window, 'onbeforeunload', { get() { return null }, set() {}, configurable: true }) } catch {}
  })();`)
}
