import { buildReadingProgress } from '@/domain/progress'
import { saveProgress } from '@/db/libraryRepository'
import type { ProgressChapter } from '@/domain/progress'

export interface ProgressSnapshot {
  bookId: string
  chapters: readonly ProgressChapter[]
  chapterIndex: number
  charOffset: number
  totalChars: number
}

const SAVE_DELAY_MS = 1_500

let latestSnapshot: ProgressSnapshot | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let writeChain: Promise<void> = Promise.resolve()

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

export function scheduleProgress(snapshot: ProgressSnapshot): void {
  latestSnapshot = snapshot
  if (timer === null) {
    timer = setTimeout(() => {
      timer = null
      void flushReadingProgress()
    }, SAVE_DELAY_MS)
  }
}

export function flushReadingProgress(): Promise<void> {
  clearTimer()
  const snapshot = latestSnapshot
  latestSnapshot = null
  if (!snapshot) return writeChain

  const run = writeChain
    .catch(() => undefined)
    .then(async () => {
      const progress = buildReadingProgress(
        snapshot.bookId,
        snapshot.chapters,
        snapshot.chapterIndex,
        snapshot.charOffset,
        snapshot.totalChars,
      )
      await saveProgress(progress)
    })

  writeChain = run.catch(() => undefined)
  return run
}

export function clearScheduledProgress(): void {
  clearTimer()
  latestSnapshot = null
}

let listenersInstalled = false

export function installProgressFlushListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true

  const flush = () => {
    void flushReadingProgress().catch((error: unknown) => {
      console.error('ReadNook: 保存阅读进度失败', error)
    })
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}
