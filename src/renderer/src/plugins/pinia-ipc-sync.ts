import type { PiniaPlugin } from 'pinia'

const SYNCED_STORES = ['agent', 'workspace']

function cloneState(state: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(state))
  } catch {
    return null
  }
}

export function createIPCSyncPlugin(): PiniaPlugin {
  return ({ store }) => {
    if (!SYNCED_STORES.includes(store.$id)) return

    let isRemoteUpdate = false

    // 本地变更 -> 发送到 Main
    store.$subscribe((_mutation, state) => {
      if (isRemoteUpdate) return
      const plain = cloneState(state)
      if (plain) {
        window.electronAPI.store.sync(store.$id, plain)
      }
    })

    // Main 广播 -> 更新本地
    window.electronAPI.store.onSync((storeId: string, state: unknown) => {
      if (storeId !== store.$id) return
      isRemoteUpdate = true
      store.$patch(state as Record<string, unknown>)
      isRemoteUpdate = false
    })
  }
}
