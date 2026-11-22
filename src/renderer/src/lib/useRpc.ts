import { useEffect, useState } from 'react'
import type { RpcMap, RpcMethod } from '@shared/types'

/** Runs an engine request. If it fails (the player may still be starting up) it quietly tries again a few times before showing an error. */
export function useRpc<K extends RpcMethod>(method: K, args: RpcMap[K]['args'], enabled = true, nonce = 0) {
  const [data, setData] = useState<RpcMap[K]['result'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify(args ?? null)

  useEffect(() => { setAttempt(0) }, [method, key, nonce])
  useEffect(() => {
    if (!enabled) return
    let live = true, timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true); if (attempt === 0) setError(null)
    window.ytm.rpc(method, args)
      .then((d) => { if (live) { setData(d); setError(null); setLoading(false) } })
      .catch((e) => {
        if (!live) return
        if (attempt < 5) timer = setTimeout(() => live && setAttempt((a) => a + 1), 700 + attempt * 800)   // try again shortly
        else { setError(String(e.message ?? e)); setLoading(false) }
      })
    return () => { live = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, enabled, nonce, attempt])

  return { data, error, loading }
}
