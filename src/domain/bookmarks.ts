import { MAX_BOOKMARK_NOTE_CHARS } from '@/config/app'
import type { Bookmark } from '@/types/models'

export type BookmarkSort = 'newest' | 'position'
export const BOOKMARK_EXCERPT_VERSION = 1
const BOOKMARK_EXCERPT_CHARS = 48

/** 字符偏移沿用正文的 UTF-16 坐标；展示只从定位点往后取，不附加前文。 */
export function createBookmarkExcerpt(content: string, offset: number, fallback: string): string {
  const start = Math.max(0, Math.min(content.length, Math.floor(offset)))
  const characters: string[] = []
  let pendingSpace = false
  for (const character of content.slice(start)) {
    if (/\s/u.test(character)) {
      if (characters.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) characters.push(' ')
    pendingSpace = false
    characters.push(character)
    if (characters.length > BOOKMARK_EXCERPT_CHARS) break
  }
  if (characters.length === 0) return fallback
  const excerpt = characters.slice(0, BOOKMARK_EXCERPT_CHARS).join('')
  return characters.length > BOOKMARK_EXCERPT_CHARS ? `${excerpt}…` : excerpt
}

export function normalizeBookmarkNote(note: string): string | undefined {
  const normalized = note.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (normalized.length > MAX_BOOKMARK_NOTE_CHARS) {
    throw new Error(`书签备注最多 ${MAX_BOOKMARK_NOTE_CHARS} 字。`)
  }
  return normalized || undefined
}

export function filterBookmarks(bookmarks: readonly Bookmark[], query: string, sort: BookmarkSort): Bookmark[] {
  const keyword = query.trim().toLocaleLowerCase('zh-CN')
  const filtered = bookmarks.filter(bookmark => !keyword ||
    [bookmark.chapterTitle, bookmark.excerpt, bookmark.note ?? ''].some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
  return filtered.sort((a, b) => sort === 'position'
    ? a.chapterIndex - b.chapterIndex || a.charOffset - b.charOffset || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
    : b.createdAt - a.createdAt || a.chapterIndex - b.chapterIndex || a.charOffset - b.charOffset || a.id.localeCompare(b.id))
}
