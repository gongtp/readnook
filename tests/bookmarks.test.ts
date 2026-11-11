import { describe, expect, it } from 'vitest'
import { createBookmarkExcerpt, filterBookmarks, normalizeBookmarkNote } from '@/domain/bookmarks'
import type { Bookmark } from '@/types/models'

const bookmarks: Bookmark[] = [
  { id: 'a', bookId: 'book', chapterKey: 'ch_0001', chapterIndex: 1, charOffset: 80, chapterTitle: '第二章 雨夜', excerpt: '窗外灯火闪烁', note: 'Alice 的线索', createdAt: 10 },
  { id: 'b', bookId: 'book', chapterKey: 'ch_0000', chapterIndex: 0, charOffset: 10, chapterTitle: '第一章', excerpt: '旧友归来', createdAt: 20 },
  { id: 'c', bookId: 'book', chapterKey: 'ch_0001', chapterIndex: 1, charOffset: 20, chapterTitle: '第二章 雨夜', excerpt: '门开了', note: '伏笔', createdAt: 30 },
]

describe('bookmark search and sorting', () => {
  it('searches chapter names, excerpts and notes with trimmed case-insensitive queries', () => {
    expect(filterBookmarks(bookmarks, '雨夜', 'newest').map(row => row.id)).toEqual(['c', 'a'])
    expect(filterBookmarks(bookmarks, '旧友', 'newest').map(row => row.id)).toEqual(['b'])
    expect(filterBookmarks(bookmarks, ' ALICE ', 'newest').map(row => row.id)).toEqual(['a'])
    expect(filterBookmarks(bookmarks, '不存在', 'newest')).toEqual([])
  })

  it('sorts by creation time or reading position without reordering the source', () => {
    expect(filterBookmarks(bookmarks, '', 'newest').map(row => row.id)).toEqual(['c', 'b', 'a'])
    expect(filterBookmarks(bookmarks, '', 'position').map(row => row.id)).toEqual(['b', 'c', 'a'])
    expect(bookmarks.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('bookmark notes', () => {
  it('keeps readable line breaks and strips invalid control characters', () => {
    expect(normalizeBookmarkNote('  人物\u0000出场\r\n回看这里  ')).toBe('人物出场\n回看这里')
    expect(normalizeBookmarkNote(' \n ')).toBeUndefined()
    expect(normalizeBookmarkNote('甲'.repeat(300))).toHaveLength(300)
    expect(() => normalizeBookmarkNote('甲'.repeat(301))).toThrow('最多 300')
  })
})

describe('bookmark excerpts', () => {
  it('starts at the saved position and shows at most 48 characters plus a trailing ellipsis', () => {
    const before = '前面的内容不应该出现。'
    const after = `保存位置${'后文'.repeat(50)}`
    const excerpt = createBookmarkExcerpt(before + after, before.length, '第一章')
    expect(excerpt).toBe(`${after.slice(0, 48)}…`)
    expect(excerpt.startsWith('保存位置')).toBe(true)
    expect(excerpt).not.toContain('前面的内容')
  })

  it('keeps short excerpts complete and collapses whitespace after the saved point', () => {
    expect(createBookmarkExcerpt('前文\n　　保存点\n下一句。', 2, '第一章')).toBe('保存点 下一句。')
    expect(createBookmarkExcerpt('甲乙丙', 1, '第一章')).toBe('乙丙')
    expect(createBookmarkExcerpt('甲乙丙', 3, '第一章')).toBe('第一章')
    expect(createBookmarkExcerpt('', 0, '空章')).toBe('空章')
  })

  it('does not split emoji while keeping the original UTF-16 offset coordinates', () => {
    const excerpt = createBookmarkExcerpt(`😀${'🌙'.repeat(60)}`, 2, '第一章')
    expect(excerpt).toBe(`${'🌙'.repeat(48)}…`)
  })
})
