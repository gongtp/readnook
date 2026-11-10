import { describe, expect, it } from 'vitest'
import {
  countFrontMatterChapters,
  displayChapterNumber,
  isFrontMatterChapter,
} from '@/domain/books/frontMatter'
import { formatChapterLocation } from '@/utils/format'

describe('front matter chapters', () => {
  it('treats parsed opening chapters as front matter', () => {
    expect(isFrontMatterChapter({ title: '开篇' })).toBe(true)
    expect(isFrontMatterChapter({ title: '开篇（续 2）' })).toBe(true)
    expect(
      isFrontMatterChapter({ title: '正文 1', autoSplitReason: 'no-headings' }),
    ).toBe(false)
    expect(isFrontMatterChapter({ title: '第一章 雾起' })).toBe(false)
  })

  it('counts only the leading front matter run', () => {
    expect(countFrontMatterChapters([])).toBe(0)
    expect(countFrontMatterChapters([{ title: '第一章 雾起' }])).toBe(0)
    expect(
      countFrontMatterChapters([
        { title: '开篇' },
        { title: '开篇（续 2）' },
        { title: '第一章 雾起' },
      ]),
    ).toBe(2)
  })

  it('skips numbering for front matter and starts real chapters at 1', () => {
    expect(displayChapterNumber(0, 1)).toBeNull()
    expect(displayChapterNumber(1, 1)).toBe(1)
    expect(displayChapterNumber(6, 1)).toBe(6)
    expect(displayChapterNumber(0, 0)).toBe(1)
  })
})

describe('formatChapterLocation', () => {
  it('labels front matter and counts only numbered chapters', () => {
    expect(formatChapterLocation(0, 7, 1)).toBe('开篇')
    expect(formatChapterLocation(1, 7, 1)).toBe('第 1 / 6 章')
    expect(formatChapterLocation(6, 7, 1)).toBe('第 6 / 6 章')
    expect(formatChapterLocation(0, 7)).toBe('第 1 / 7 章')
    expect(formatChapterLocation(0, 1, 1)).toBe('暂无章节')
  })
})
