# YTM Desk

Custom React UI + hidden, ad-blocked YouTube Music engine (Electron).

```
┌─ UI window (React/Tailwind, sandboxed) ─┐      ┌─ Engine window (hidden) ──────────────┐
│ window.ytm.{command,rpc,onState}        │ IPC  │ music.youtube.com, persist:ytm cookies │
│        preload/ui.ts                    │◄────►│ preload/engine/*  (bridge)             │
└──────────────┬──────────────────────────┘ main │ + Ghostery adblock (network+cosmetic+  │
               └──────── main/ipc.ts ───────────►│   uBO scriptlets) on the session       │
                                                 └────────────────────────────────────────┘
```

## Run
```
npm install
npm run dev
```
First launch: click **Sign in to YouTube Music** (reveals the engine window), log in to Google, close it (it hides).
Cookies persist in the `persist:ytm` partition.

## Where things live
| Concern | File |
|---|---|
| Adblock engine + 12h refresh | `src/main/adblock.ts` |
| Hidden engine window, UA, login | `src/main/windows.ts` |
| IPC routing, RPC correlation, hotkeys | `src/main/ipc.ts` |
| State out (mediaSession/video) | `src/preload/engine/state.ts` |
| Commands in (play/seek/vol/like/nav) | `src/preload/engine/commands.ts` |
| Search / home / library / playlist JSON | `src/preload/engine/api.ts` |
| Ad failsafe (response pruning + skipper) | `src/preload/engine/ads.ts` |
| Shared types + channel names | `src/shared/types.ts` |

## Things most likely to need tweaking
- DOM selectors in `commands.ts` (`.next-button`, like button) if YT Music changes markup.
- `AD_KEYS` in `ads.ts` and the Ghostery lists if ads reappear.
- Parser paths in `api.ts` (`musicResponsiveListItemRenderer` etc.) if the youtubei response shape shifts.
- Package versions in `package.json`: bump to current releases.
