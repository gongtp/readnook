import type { ChapterMeta, ReadingProgress } from '@/types/models'

export interface ProgressChapter {
  chapterKey: string
  order: number
  charCount: number
  startChar: number
}

export interface ResumeLocation {
  chapterIndex: number
  chapterKey: string
  charOffset: number
}

export function clampCharOffset(value: number, contentLength: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.floor(value), Math.max(contentLength, 0)))
}

export function clampProgressRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, 1))
}

export function calculateChapterProgress(
  charOffset: number,
  charCount: number,
): number {
  if (charCount <= 0) return 0
  return clampProgressRatio(charOffset / charCount)
}

export function calculateBookProgress(
  startChar: number,
  charOffset: number,
  totalChars: number,
): number {
  if (totalChars <= 0) return 0
  return clampProgressRatio((startChar + charOffset) / totalChars)
}

export function buildReadingProgress(
  bookId: string,
  chapters: readonly ProgressChapter[],
  chapterIndex: number,
  rawOffset: number,
  totalChars: number,
  now = Date.now(),
): ReadingProgress {
  const safeIndex = Math.max(0, Math.min(chapterIndex, chapters.length - 1))
  const chapter = chapters[safeIndex]
  if (!chapter) {
    return {
      bookId,
      chapterKey: '',
      chapterIndex: 0,
      charOffset: 0,
      chapterProgress: 0,
      bookProgress: 0,
      updatedAt: now,
    }
  }

  const charOffset = clampCharOffset(rawOffset, chapter.charCount)
  return {
    bookId,
    chapterKey: chapter.chapterKey,
    chapterIndex: safeIndex,
    charOffset,
    chapterProgress: calculateChapterProgress(charOffset, chapter.charCount),
    bookProgress: calculateBookProgress(chapter.startChar, charOffset, totalChars),
    updatedAt: now,
  }
}

export function resolveResumeLocation(
  chapters: readonly ProgressChapter[],
  progress: ReadingProgress | null | undefined,
): ResumeLocation | null {
  if (chapters.length === 0) return null

  const byKey = progress
    ? chapters.find((chapter) => chapter.chapterKey === progress.chapterKey)
    : undefined
  if (progress && byKey) {
    return {
      chapterIndex: byKey.order,
      chapterKey: byKey.chapterKey,
      charOffset: clampCharOffset(progress.charOffset, byKey.charCount),
    }
  }

  const first = chapters[0]
  if (!first) return null
  return {
    chapterIndex: first.order,
    chapterKey: first.chapterKey,
    charOffset: 0,
  }
}

export function toProgressPercent(bookProgress: number): number {
  const ratio = clampProgressRatio(bookProgress)
  return ratio === 1 ? 100 : Math.min(99, Math.round(ratio * 100))
}

export function isValidProgress(
  value: unknown,
): value is ReadingProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as Partial<ReadingProgress>
  return (
    typeof progress.bookId === 'string' &&
    typeof progress.chapterKey === 'string' &&
    Number.isInteger(progress.chapterIndex) &&
    Number.isFinite(progress.charOffset) &&
    Number.isFinite(progress.chapterProgress) &&
    Number.isFinite(progress.bookProgress) &&
    Number.isFinite(progress.updatedAt)
  )
}

export function totalCharsFromChapters(
  chapters: readonly Pick<ChapterMeta, 'charCount'>[],
): number {
  return chapters.reduce((total, chapter) => total + chapter.charCount, 0)
}
