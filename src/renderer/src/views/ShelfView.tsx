import type { Item, RpcMap } from '@shared/types'
import { useRpc } from '@/lib/useRpc'
import { Shelves } from '@/components/Shelves'

type ShelfMethod = 'search' | 'home' | 'library' | 'playlist'

export function ShelfView<K extends ShelfMethod>({ method, args, onOpen, empty }:
  { method: K; args: RpcMap[K]['args']; onOpen: (it: Item) => void; empty?: string }) {
  const { data, error, loading } = useRpc(method, args)
  if (loading && !data) return <p className="text-mute">Loading…</p>
  if (error) return <p className="rounded-xl bg-hover p-4 text-[14px]">Couldn’t load this: {error}</p>
  if (!data?.length) return <p className="text-mute">{empty ?? 'Nothing here yet.'}</p>
  return <Shelves shelves={data} onOpen={onOpen} />
}
