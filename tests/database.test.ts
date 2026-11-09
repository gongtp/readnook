import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadNookDatabase } from '@/db/database'
import {
  addBookmark,
  deleteBookCascade,
  getBook,
  getBookByContentHash,
  getChapter,
  getChapterContent,
  getProgressMap,
  listBooks,
  listBookmarks,
  listChapters,
  saveBookBundle,
  saveProgress,
  type BookBundle,
} from '@/db/libraryRepository'
import {
  getReaderSettings,
  saveReaderSettings,
} from '@/db/settingsRepository'
import type { Bookmark, ReaderSettings } from '@/types/models'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const BOOK_ID_2 = '22222222-2222-4222-8222-222222222222'
const HASH = 'a'.repeat(64)
const HASH_2 = 'b'.repeat(64)

function makeBundle(
  bookId = BOOK_ID,
  hash = HASH,
  overrides: Partial<BookBundle['book']> = {},
): BookBundle {
  const now = 1_700_000_000_000
  return {
    book: {
      id: bookId,
      title: '山雨',
      format: 'txt',
      sourceFileName: '山雨.txt',
      contentHash: hash,
      byteSize: 20,
      encoding: 'utf-8',
      totalChars: 8,
      chapterCount: 2,
      parserVersion: 1,
      parseWarnings: [],
      importedAt: now,
      lastReadAt: now,
      updatedAt: now,
      ...overrides,
    },
    file: {
      bookId,
      blob: new Blob(['第一章\n雨\n第二章\n晴'], { type: 'text/plain' }),
      byteLength: 20,
      mimeType: 'text/plain',
    },
    chapters: [
      {
        meta: {
          id: `${bookId}:ch_0000`,
          bookId,
          chapterKey: 'ch_0000',
          order: 0,
          title: '第一章',
          startChar: 0,
          charCount: 2,
          autoSplit: false,
          autoSplitReason: null,
        },
        content: { chapterId: `${bookId}:ch_0000`, content: '雨' },
      },
      {
        meta: {
          id: `${bookId}:ch_0001`,
          bookId,
          chapterKey: 'ch_0001',
          order: 1,
          title: '第二章',
          startChar: 2,
          charCount: 2,
          autoSplit: false,
          autoSplitReason: null,
        },
        content: { chapterId: `${bookId}:ch_0001`, content: '晴' },
      },
    ],
    progress: {
      bookId,
      chapterKey: 'ch_0000',
      chapterIndex: 0,
      charOffset: 0,
      chapterProgress: 0,
      bookProgress: 0,
      updatedAt: now,
    },
    bookmarks: [
      {
        id:
          bookId === BOOK_ID
            ? '33333333-3333-4333-8333-333333333333'
            : '44444444-4444-4444-8444-444444444444',
        bookId,
        chapterKey: 'ch_0001',
        chapterIndex: 1,
        charOffset: 1,
        chapterTitle: '第二章',
        excerpt: '晴',
        createdAt: now + 10,
      },
    ],
  }
}

let database: ReadNookDatabase

beforeEach(() => {
  database = new ReadNookDatabase(`ReadNookTest-${crypto.randomUUID()}`)
})

afterEach(async () => {
  await database.delete()
})

describe('book persistence', () => {
  it('writes a complete book bundle in one transaction', async () => {
    const bundle = makeBundle()
    await saveBookBundle(bundle, database)

    expect(await database.books.count()).toBe(1)
    expect(await database.files.count()).toBe(1)
    expect(await database.chapters.count()).toBe(2)
    expect(await database.chapterContents.count()).toBe(2)
    expect(await database.progress.count()).toBe(1)
    expect(await database.bookmarks.count()).toBe(1)
    expect(await getBook(BOOK_ID, database)).toMatchObject({
      title: '山雨',
      chapterCount: 2,
    })
  })

  it('finds books by content hash and lists chapters by order', async () => {
    await saveBookBundle(makeBundle(), database)
    expect((await getBookByContentHash(HASH, database))?.id).toBe(BOOK_ID)
    expect(await getBookByContentHash(HASH_2, database)).toBeUndefined()

    const chapters = await listChapters(BOOK_ID, database)
    expect(chapters.map((chapter) => chapter.chapterKey)).toEqual([
      'ch_0000',
      'ch_0001',
    ])
    expect((await getChapter(BOOK_ID, 'ch_0001', database))?.title).toBe(
      '第二章',
    )
    expect(
      await getChapterContent(`${BOOK_ID}:ch_0000`, database),
    ).toBe('雨')
    expect(await getChapterContent('missing', database)).toBe('')
  })

  it('enforces the unique content hash index', async () => {
    await saveBookBundle(makeBundle(), database)
    await expect(
      saveBookBundle(makeBundle(BOOK_ID_2, HASH), database),
    ).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await database.books.count()).toBe(1)
    expect(await database.chapters.count()).toBe(2)
  })

  it('rolls back the whole bundle when a chapter write fails', async () => {
    const bundle = makeBundle()
    const second = bundle.chapters[1]!
    bundle.chapters.push({
      meta: { ...second.meta, id: `${BOOK_ID}:duplicate` },
      content: { chapterId: `${BOOK_ID}:duplicate`, content: '坏数据' },
    })

    await expect(saveBookBundle(bundle, database)).rejects.toBeTruthy()
    expect(await database.books.count()).toBe(0)
    expect(await database.files.count()).toBe(0)
    expect(await database.chapters.count()).toBe(0)
    expect(await database.chapterContents.count()).toBe(0)
    expect(await database.progress.count()).toBe(0)
  })

  it('cascades deletion but leaves other books untouched', async () => {
    await saveBookBundle(makeBundle(), database)
    await saveBookBundle(makeBundle(BOOK_ID_2, HASH_2), database)

    await deleteBookCascade(BOOK_ID, database)

    expect(await database.books.count()).toBe(1)
    expect(await database.files.count()).toBe(1)
    expect(await database.chapters.count()).toBe(2)
    expect(await database.chapterContents.count()).toBe(2)
    expect(await database.progress.count()).toBe(1)
    expect(await database.bookmarks.count()).toBe(1)
    expect(await getBook(BOOK_ID, database)).toBeUndefined()
    expect(await getBook(BOOK_ID_2, database)).toBeDefined()
    expect((await listBooks(database)).map((book) => book.id)).toEqual([
      BOOK_ID_2,
    ])
  })
})

describe('progress and bookmarks', () => {
  it('saves progress and updates the book read time', async () => {
    const bundle = makeBundle()
    await saveBookBundle(bundle, database)

    await saveProgress(
      {
        bookId: BOOK_ID,
        chapterKey: 'ch_0001',
        chapterIndex: 1,
        charOffset: 1,
        chapterProgress: 0.5,
        bookProgress: 0.75,
        updatedAt: 1_700_000_999_000,
      },
      database,
    )

    expect((await database.progress.get(BOOK_ID))?.bookProgress).toBe(0.75)
    expect((await getBook(BOOK_ID, database))?.lastReadAt).toBe(
      1_700_000_999_000,
    )
    expect((await getBook(BOOK_ID, database))?.updatedAt).toBe(
      1_700_000_999_000,
    )
  })

  it('does not create progress for a missing book', async () => {
    await saveProgress(
      {
        bookId: BOOK_ID,
        chapterKey: 'ch_0000',
        chapterIndex: 0,
        charOffset: 0,
        chapterProgress: 0,
        bookProgress: 0,
        updatedAt: 1,
      },
      database,
    )
    expect(await database.progress.count()).toBe(0)
  })

  it('reads progress for many books at once', async () => {
    await saveBookBundle(makeBundle(), database)
    await saveBookBundle(makeBundle(BOOK_ID_2, HASH_2), database)
    const map = await getProgressMap([BOOK_ID, BOOK_ID_2, 'missing'], database)
    expect([...map.keys()]).toEqual([BOOK_ID, BOOK_ID_2])
    expect(map.get(BOOK_ID_2)?.bookId).toBe(BOOK_ID_2)
  })

  it('adds and lists bookmarks newest first', async () => {
    await saveBookBundle(makeBundle(), database)
    const newer: Bookmark = {
      id: '44444444-4444-4444-8444-444444444444',
      bookId: BOOK_ID,
      chapterKey: 'ch_0000',
      chapterIndex: 0,
      charOffset: 0,
      chapterTitle: '第一章',
      excerpt: '雨',
      createdAt: 1_700_000_000_100,
    }
    await addBookmark(newer, database)
    const bookmarks = await listBookmarks(BOOK_ID, database)
    expect(bookmarks.map((bookmark) => bookmark.id)).toEqual([
      newer.id,
      '33333333-3333-4333-8333-333333333333',
    ])
  })
})

describe('reader settings persistence', () => {
  it('returns defaults when nothing has been saved', async () => {
    expect(await getReaderSettings(database)).toEqual({
      theme: 'paper',
      fontSize: 19,
      lineHeight: 1.85,
      pageMargin: 22,
    })
  })

  it('saves normalized settings', async () => {
    const settings: ReaderSettings = {
      theme: 'dark',
      fontSize: 24,
      lineHeight: 2,
      pageMargin: 30,
    }
    await saveReaderSettings(settings, database)
    expect(await getReaderSettings(database)).toEqual(settings)

    await saveReaderSettings(
      {
        theme: 'dark',
        fontSize: 999,
        lineHeight: 0.1,
        pageMargin: 1,
      },
      database,
    )
    expect(await getReaderSettings(database)).toEqual({
      theme: 'dark',
      fontSize: 26,
      lineHeight: 1.5,
      pageMargin: 16,
    })
  })
})
