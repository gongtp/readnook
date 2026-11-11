import { db, type ReadNookDatabase } from '@/db/database'
import { countFrontMatterChapters } from '@/domain/books/frontMatter'
import { BOOKMARK_EXCERPT_VERSION, createBookmarkExcerpt, normalizeBookmarkNote } from '@/domain/bookmarks'
import { MAX_BOOKMARKS_PER_BOOK } from '@/config/app'
import type {
  Book,
  BookFile,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ReadingProgress,
} from '@/types/models'

export interface ChapterBundleItem {
  meta: ChapterMeta
  content: ChapterContent
}

export interface BookBundle {
  book: Book
  file: BookFile
  chapters: ChapterBundleItem[]
  progress: ReadingProgress
  bookmarks?: Bookmark[]
}

export async function listBooks(
  database: ReadNookDatabase = db,
): Promise<Book[]> {
  return database.books.toArray()
}

export async function getBook(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<Book | undefined> {
  return database.books.get(bookId)
}

export async function getBookByContentHash(
  contentHash: string,
  database: ReadNookDatabase = db,
): Promise<Book | undefined> {
  return database.books.where('contentHash').equals(contentHash).first()
}

export async function getBookFile(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<BookFile | undefined> {
  return database.files.get(bookId)
}

export async function getProgress(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<ReadingProgress | undefined> {
  return database.progress.get(bookId)
}

export async function getProgressMap(
  bookIds: readonly string[],
  database: ReadNookDatabase = db,
): Promise<Map<string, ReadingProgress>> {
  const rows = await database.progress.bulkGet([...bookIds])
  const map = new Map<string, ReadingProgress>()
  for (const row of rows) {
    if (row) map.set(row.bookId, row)
  }
  return map
}

export async function listChapters(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<ChapterMeta[]> {
  const chapters = await database.chapters.where('bookId').equals(bookId).toArray()
  return chapters.sort((a, b) => a.order - b.order)
}

/**
 * 旧书没有 frontMatterCount 字段，这里按章节标题补算一次并写回，
 * 之后书架与进度文案就能稳定排除“开篇”。
 */
export async function backfillFrontMatterCounts(
  books: Book[],
  database: ReadNookDatabase = db,
): Promise<void> {
  const pending = books.filter(
    (book) => typeof book.frontMatterCount !== 'number',
  )
  if (pending.length === 0) return

  const rows = await database.chapters
    .where('bookId')
    .anyOf(pending.map((book) => book.id))
    .toArray()

  const byBook = new Map<string, ChapterMeta[]>()
  for (const row of rows) {
    const list = byBook.get(row.bookId)
    if (list) list.push(row)
    else byBook.set(row.bookId, [row])
  }

  for (const book of pending) {
    const list = (byBook.get(book.id) ?? []).sort((a, b) => a.order - b.order)
    const count = countFrontMatterChapters(list)
    book.frontMatterCount = count
    await database.books.update(book.id, { frontMatterCount: count })
  }
}

export async function getChapter(
  bookId: string,
  chapterKey: string,
  database: ReadNookDatabase = db,
): Promise<ChapterMeta | undefined> {
  return database.chapters
    .where('[bookId+chapterKey]')
    .equals([bookId, chapterKey])
    .first()
}

export async function getChapterContent(
  chapterId: string,
  database: ReadNookDatabase = db,
): Promise<string> {
  const row = await database.chapterContents.get(chapterId)
  return row?.content ?? ''
}

export async function listBookmarks(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<Bookmark[]> {
  return database.transaction('rw', [database.bookmarks, database.chapters, database.chapterContents], async () => {
    const rows = await database.bookmarks.where('bookId').equals(bookId).toArray()
    const legacyByChapter = new Map<string, Bookmark[]>()
    for (const row of rows) {
      if (row.excerptVersion === BOOKMARK_EXCERPT_VERSION) continue
      const group = legacyByChapter.get(row.chapterKey) ?? []
      group.push(row)
      legacyByChapter.set(row.chapterKey, group)
    }
    // 每章只读取一次正文；旧书签只更新摘录，保留原始定位、备注和创建时间。
    for (const [chapterKey, bookmarks] of legacyByChapter) {
      const chapter = await getChapter(bookId, chapterKey, database)
      if (!chapter) continue
      const content = await database.chapterContents.get(chapter.id)
      if (!content) continue
      for (const bookmark of bookmarks) {
        bookmark.excerpt = createBookmarkExcerpt(content.content, bookmark.charOffset, chapter.title)
        bookmark.excerptVersion = BOOKMARK_EXCERPT_VERSION
        await database.bookmarks.update(bookmark.id, {
          excerpt: bookmark.excerpt,
          excerptVersion: bookmark.excerptVersion,
        })
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  })
}

export async function addBookmark(
  bookmark: Bookmark,
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.bookmarks, async () => {
    const nearby = await database.bookmarks.where('[bookId+chapterKey]')
      .equals([bookmark.bookId, bookmark.chapterKey]).toArray()
    if (nearby.some(row => Math.abs(row.charOffset - bookmark.charOffset) <= 2)) {
      throw new Error('这个位置已经有书签了。')
    }
    const count = await database.bookmarks.where('bookId').equals(bookmark.bookId).count()
    if (count >= MAX_BOOKMARKS_PER_BOOK) {
      throw new Error(`每本书最多支持 ${MAX_BOOKMARKS_PER_BOOK} 个书签，请先删除不需要的书签。`)
    }
    await database.bookmarks.add({ ...bookmark, note: normalizeBookmarkNote(bookmark.note ?? '') })
  })
}

export async function updateBookmarkNote(
  bookmarkId: string,
  note: string,
  database: ReadNookDatabase = db,
): Promise<Bookmark> {
  const normalized = normalizeBookmarkNote(note)
  return database.transaction('rw', database.bookmarks, async () => {
    const bookmark = await database.bookmarks.get(bookmarkId)
    if (!bookmark) throw new Error('这个书签已不存在，请重新打开书签列表。')
    const updated = { ...bookmark, note: normalized }
    await database.bookmarks.put(updated)
    return updated
  })
}

export async function deleteBookmark(
  bookmarkId: string,
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.bookmarks.delete(bookmarkId)
}

export async function saveProgress(
  progress: ReadingProgress,
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.transaction(
    'rw',
    database.progress,
    database.books,
    async () => {
      const book = await database.books.get(progress.bookId)
      if (!book) return
      await database.progress.put(progress)
      await database.books.update(progress.bookId, {
        lastReadAt: progress.updatedAt,
        updatedAt: progress.updatedAt,
      })
    },
  )
}

export async function touchBookReadTime(
  bookId: string,
  now = Date.now(),
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.books.update(bookId, { lastReadAt: now, lastOpenedAt: now })
}

export async function saveBookBundle(
  bundle: BookBundle,
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.books,
      database.files,
      database.chapters,
      database.chapterContents,
      database.progress,
      database.bookmarks,
    ],
    async () => {
      await database.books.add(bundle.book)
      await database.files.add(bundle.file)
      await database.chapters.bulkAdd(bundle.chapters.map((item) => item.meta))
      await database.chapterContents.bulkAdd(
        bundle.chapters.map((item) => item.content),
      )
      await database.progress.add(bundle.progress)
      if (bundle.bookmarks?.length) {
        await database.bookmarks.bulkAdd(bundle.bookmarks)
      }
    },
  )
}

export async function deleteBookCascade(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.books,
      database.files,
      database.chapters,
      database.chapterContents,
      database.progress,
      database.bookmarks,
    ],
    async () => {
      const chapters = await database.chapters
        .where('bookId')
        .equals(bookId)
        .toArray()
      const chapterIds = chapters.map((chapter) => chapter.id)

      if (chapterIds.length > 0) {
        await database.chapterContents.bulkDelete(chapterIds)
      }
      await database.chapters.where('bookId').equals(bookId).delete()
      await database.bookmarks.where('bookId').equals(bookId).delete()
      await database.progress.delete(bookId)
      await database.files.delete(bookId)
      await database.books.delete(bookId)
    },
  )
}

export async function getAllBookFiles(
  database: ReadNookDatabase = db,
): Promise<BookFile[]> {
  return database.files.toArray()
}

export async function getAllProgress(
  database: ReadNookDatabase = db,
): Promise<ReadingProgress[]> {
  return database.progress.toArray()
}

export async function getAllBookmarks(
  database: ReadNookDatabase = db,
): Promise<Bookmark[]> {
  return database.bookmarks.toArray()
}

export async function getAllChapterMetadata(
  bookId: string,
  database: ReadNookDatabase = db,
): Promise<ChapterMeta[]> {
  return database.chapters.where('bookId').equals(bookId).toArray()
}
