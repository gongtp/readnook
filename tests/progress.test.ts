import { describe, expect, it } from 'vitest'
import {
  buildReadingProgress,
  calculateBookProgress,
  calculateChapterProgress,
  clampCharOffset,
  clampProgressRatio,
  isValidProgress,
  resolveResumeLocation,
  toProgressPercent,
  totalCharsFromChapters,
} from '@/domain/progress'
import type { ChapterMeta, ReadingProgress } from '@/types/models'

const chapters = [
  { chapterKey: 'ch_0000', order: 0, charCount: 100, startChar: 0 },
  { chapterKey: 'ch_0001', order: 1, charCount: 200, startChar: 100 },
  { chapterKey: 'ch_0002', order: 2, charCount: 300, startChar: 300 },
]

describe('clamp helpers', () => {
  it('clamps char offsets into the chapter bounds', () => {
    expect(clampCharOffset(-5, 100)).toBe(0)
    expect(clampCharOffset(42.9, 100)).toBe(42)
    expect(clampCharOffset(500, 100)).toBe(100)
    expect(clampCharOffset(Number.NaN, 100)).toBe(0)
    expect(clampCharOffset(10, -3)).toBe(0)
  })

  it('clamps book ratios', () => {
    expect(clampProgressRatio(-1)).toBe(0)
    expect(clampProgressRatio(0.25)).toBe(0.25)
    expect(clampProgressRatio(4)).toBe(1)
    expect(clampProgressRatio(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('progress calculations', () => {
  it('calculates chapter and whole-book percentages', () => {
    expect(calculateChapterProgress(50, 200)).toBe(0.25)
    expect(calculateChapterProgress(5, 0)).toBe(0)
    expect(calculateBookProgress(100, 50, 600)).toBe(0.25)
    expect(calculateBookProgress(0, 0, 0)).toBe(0)
    expect(toProgressPercent(0.834)).toBe(83)
    expect(toProgressPercent(1.8)).toBe(100)
  })

  it('builds a persisted progress record from a chapter offset', () => {
    const progress = buildReadingProgress('book-1', chapters, 1, 50, 600, 1234)
    expect(progress).toEqual({
      bookId: 'book-1',
      chapterKey: 'ch_0001',
      chapterIndex: 1,
      charOffset: 50,
      chapterProgress: 0.25,
      bookProgress: 0.25,
      updatedAt: 1234,
    })
  })

  it('clamps an out-of-range chapter index and offset', () => {
    const progress = buildReadingProgress('book-1', chapters, 99, 9999, 600, 1)
    expect(progress.chapterIndex).toBe(2)
    expect(progress.chapterKey).toBe('ch_0002')
    expect(progress.charOffset).toBe(300)
    expect(progress.bookProgress).toBe(1)
  })

  it('handles an empty chapter list without throwing', () => {
    const progress = buildReadingProgress('book-1', [], 0, 10, 0, 5)
    expect(progress.chapterKey).toBe('')
    expect(progress.charOffset).toBe(0)
    expect(progress.bookProgress).toBe(0)
    expect(progress.updatedAt).toBe(5)
  })

  it('sums chapter char counts', () => {
    const metas = chapters.map((chapter) => ({
      ...chapter,
      id: chapter.chapterKey,
      bookId: 'book-1',
      title: chapter.chapterKey,
      autoSplit: false,
      autoSplitReason: null,
    })) satisfies ChapterMeta[]
    expect(totalCharsFromChapters(metas)).toBe(600)
    expect(totalCharsFromChapters([])).toBe(0)
  })
})

describe('resolveResumeLocation', () => {
  const saved: ReadingProgress = {
    bookId: 'book-1',
    chapterKey: 'ch_0001',
    chapterIndex: 1,
    charOffset: 42,
    chapterProgress: 0.21,
    bookProgress: 0.24,
    updatedAt: 10,
  }

  it('restores by chapter key even if the stored index is stale', () => {
    expect(
      resolveResumeLocation(chapters, { ...saved, chapterIndex: 0 }),
    ).toEqual({
      chapterIndex: 1,
      chapterKey: 'ch_0001',
      charOffset: 42,
    })
  })

  it('clamps a saved offset to the current chapter length', () => {
    expect(resolveResumeLocation(chapters, { ...saved, charOffset: 9999 }))
      .toEqual({
        chapterIndex: 1,
        chapterKey: 'ch_0001',
        charOffset: 200,
      })
  })

  it('falls back to the first chapter when the saved chapter is gone', () => {
    expect(
      resolveResumeLocation(chapters, { ...saved, chapterKey: 'deleted' }),
    ).toEqual({ chapterIndex: 0, chapterKey: 'ch_0000', charOffset: 0 })
    expect(resolveResumeLocation(chapters, null)).toEqual({
      chapterIndex: 0,
      chapterKey: 'ch_0000',
      charOffset: 0,
    })
    expect(resolveResumeLocation([], saved)).toBeNull()
  })
})

describe('isValidProgress', () => {
  const valid: ReadingProgress = {
    bookId: 'book-1',
    chapterKey: 'ch_0000',
    chapterIndex: 0,
    charOffset: 3,
    chapterProgress: 0.03,
    bookProgress: 0.01,
    updatedAt: 1,
  }

  it('accepts a complete record', () => {
    expect(isValidProgress(valid)).toBe(true)
  })

  it('rejects malformed records', () => {
    expect(isValidProgress(null)).toBe(false)
    expect(isValidProgress({})).toBe(false)
    expect(isValidProgress({ ...valid, chapterIndex: 0.5 })).toBe(false)
    expect(isValidProgress({ ...valid, charOffset: '3' })).toBe(false)
    expect(isValidProgress({ ...valid, updatedAt: Number.NaN })).toBe(false)
  })
})
