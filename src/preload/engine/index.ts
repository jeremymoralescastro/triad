import { ipcRenderer, webFrame } from 'electron'
import { CH, type Command, type RpcMethod } from '@shared/types'
import { allowNavigation, installEarlyAdPatch } from './ads'
import { startStateLoop } from './state'
import { runCommand, setQueueFetcher } from './commands'
import { rpc } from './api'

// On Google's sign-in page, present a consistent Firefox identity (headers are handled in main/windows.ts).
if (location.hostname === 'accounts.google.com') {
  webFrame.executeJavaScript(`(() => {
    const d = (o, k, v) => { try { Object.defineProperty(o, k, { get: () => v, configurable: true }) } catch {} };
    d(navigator, 'userAgent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0');
    d(navigator, 'appVersion', '5.0 (Windows)'); d(navigator, 'vendor', ''); d(navigator, 'userAgentData', undefined);
  })()`)
}

// Runs in every frame of the engine window (incl. accounts.google.com during sign-in);
// only the music.youtube.com top frame gets the bridge.
if (location.hostname === 'music.youtube.com' && window.top === window) {
  setQueueFetcher(async (list) => {
    const shelves = await rpc('playlist', { browseId: list })
    return [...new Set(shelves.flatMap((sh) => sh.items).map((i) => i.videoId).filter((x): x is string => !!x))]
  })
  installEarlyAdPatch()                      // before YouTube's own scripts run
  allowNavigation()
  window.addEventListener('DOMContentLoaded', () => startStateLoop())

  ipcRenderer.on(CH.engineCommand, (_e, cmd: Command) => {
    runCommand(cmd).catch((err) => console.error('[bridge] command failed', cmd, err))
  })

  ipcRenderer.on(CH.engineRpc, async (_e, req: { id: number; method: RpcMethod; args: any }) => {
    try {
      const data = await rpc(req.method, req.args)
      ipcRenderer.send(CH.engineRpcResult, { id: req.id, ok: true, data })
    } catch (err) {
      ipcRenderer.send(CH.engineRpcResult, { id: req.id, ok: false, error: String(err) })
    }
  })
}
