import { PERSIST_STORAGE_KEY } from '@/config/app'
import { formatBytes } from '@/utils/format'

export interface StorageStatus {
  supported: boolean
  usage: number | null
  quota: number | null
  persisted: boolean | null
  persistenceSupported: boolean
}

export class StorageCapacityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageCapacityError'
  }
}

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined' || !navigator.storage) return null
  return navigator.storage
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const manager = storageManager()
  if (!manager) {
    return {
      supported: false,
      usage: null,
      quota: null,
      persisted: null,
      persistenceSupported: false,
    }
  }

  let usage: number | null = null
  let quota: number | null = null
  let persisted: boolean | null = null

  if (typeof manager.estimate === 'function') {
    try {
      const estimate = await manager.estimate()
      usage = estimate.usage ?? null
      quota = estimate.quota ?? null
    } catch {
      usage = null
      quota = null
    }
  }

  const persistenceSupported = typeof manager.persist === 'function'
  if (persistenceSupported && typeof manager.persisted === 'function') {
    try {
      persisted = await manager.persisted()
    } catch {
      persisted = null
    }
  }

  return { supported: true, usage, quota, persisted, persistenceSupported }
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  const manager = storageManager()
  if (!manager || typeof manager.persist !== 'function') return null

  try {
    const granted = await manager.persist()
    try {
      localStorage.setItem(PERSIST_STORAGE_KEY, granted ? 'granted' : 'denied')
    } catch {
      // localStorage 不可用不影响 IndexedDB。
    }
    return granted
  } catch {
    return false
  }
}

export async function assertStorageCapacity(
  requiredBytes: number,
): Promise<void> {
  const status = await getStorageStatus()
  if (status.quota === null || status.usage === null) return

  const available = status.quota - status.usage
  if (available > 0 && available < requiredBytes) {
    throw new StorageCapacityError(
      `本地可用空间可能不足。预计需要约 ${formatBytes(requiredBytes)}，当前可用约 ${formatBytes(available)}。请先导出备份并清理不需要的书籍。`,
    )
  }
}

export async function requestPersistenceAfterImport(): Promise<void> {
  const status = await getStorageStatus()
  if (status.persistenceSupported && status.persisted === false) {
    await requestPersistentStorage()
  }
}
