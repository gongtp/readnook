export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}

export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22
    )
  }

  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
  }

  return false
}

export const STORAGE_FULL_MESSAGE =
  '本地存储空间不足，无法完成写入。请清理不需要的书籍，或在设置页先导出备份后重试。'
