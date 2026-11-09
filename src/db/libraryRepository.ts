import { db, type ReadNookDatabase } from '@/db/database'
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
  const rows = await database.bookmarks.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function addBookmark(
  bookmark: Bookmark,
  database: ReadNookDatabase = db,
): Promise<void> {
  await database.bookmarks.add(bookmark)
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
  await database.books.update(bookId, { lastReadAt: now })
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
