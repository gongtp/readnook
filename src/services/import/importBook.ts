import { buildReadingProgress } from '@/domain/progress'
import {
  getBookByContentHash,
  saveBookBundle,
  type ChapterBundleItem,
} from '@/db/libraryRepository'
import type { ParsedBook } from '@/types/importer'
import type { Book, BookFile, TextEncoding } from '@/types/models'
import { createId } from '@/utils/id'
import { isQuotaExceededError, STORAGE_FULL_MESSAGE } from '@/utils/errors'
import {
  assertStorageCapacity,
  requestPersistenceAfterImport,
  StorageCapacityError,
} from '@/services/storageService'

export interface ImportSaveInput {
  file: File
  title: string
  parsed: ParsedBook
  contentHash: string
  encoding: TextEncoding
}

export class DuplicateBookError extends Error {
  constructor(message = '这本书已经存在于书架中。') {
    super(message)
    this.name = 'DuplicateBookError'
  }
}

export function sanitizeBookTitle(title: string, sourceFileName: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (cleaned) return cleaned

  return sourceFileName.replace(/\.txt$/i, '').trim().slice(0, 120) || '未命名小说'
}

export function createChapterBundle(
  bookId: string,
  parsed: ParsedBook,
): ChapterBundleItem[] {
  return parsed.chapters.map((chapter) => {
    const chapterId = `${bookId}:${chapter.chapterKey}`
    return {
      meta: {
        id: chapterId,
        bookId,
        chapterKey: chapter.chapterKey,
        order: chapter.order,
        title: chapter.title,
        startChar: chapter.startChar,
        charCount: chapter.charCount,
        autoSplit: chapter.autoSplit,
        autoSplitReason: chapter.autoSplitReason,
      },
      content: {
        chapterId,
        content: chapter.content,
      },
    }
  })
}

export async function saveImportedBook(
  input: ImportSaveInput,
): Promise<Book> {
  if (input.parsed.chapters.length === 0) {
    throw new Error('没有可保存的章节。')
  }

  const duplicate = await getBookByContentHash(input.contentHash)
  if (duplicate) {
    throw new DuplicateBookError(
      `这本书已经存在于书架中：《${duplicate.title}》。`,
    )
  }

  const bookId = createId()
  const now = Date.now()
  const chapters = createChapterBundle(bookId, input.parsed)
  const firstChapter = input.parsed.chapters[0]
  if (!firstChapter) throw new Error('没有可保存的章节。')

  const book: Book = {
    id: bookId,
    title: sanitizeBookTitle(input.title, input.file.name),
    format: 'txt',
    sourceFileName: input.file.name,
    contentHash: input.contentHash,
    byteSize: input.file.size,
    encoding: input.encoding,
    totalChars: input.parsed.totalChars,
    chapterCount: input.parsed.chapters.length,
    parserVersion: input.parsed.parserVersion,
    parseWarnings: input.parsed.warnings,
    importedAt: now,
    lastReadAt: now,
    updatedAt: now,
  }
  const fileRow: BookFile = {
    bookId,
    blob: input.file,
    byteLength: input.file.size,
    mimeType: input.file.type || 'text/plain',
  }
  const progress = buildReadingProgress(
    bookId,
    input.parsed.chapters,
    0,
    0,
    input.parsed.totalChars,
    now,
  )

  const estimatedWriteBytes =
    input.file.size + input.parsed.totalChars * 2 + 2 * 1024 * 1024
  await assertStorageCapacity(estimatedWriteBytes)

  try {
    await saveBookBundle({
      book,
      file: fileRow,
      chapters,
      progress,
    })
  } catch (error) {
    if (error instanceof DuplicateBookError) throw error
    if (isQuotaExceededError(error)) {
      throw new StorageCapacityError(STORAGE_FULL_MESSAGE)
    }
    if (error instanceof Error && error.name === 'ConstraintError') {
      throw new DuplicateBookError('检测到重复书籍，未写入本地书库。')
    }
    throw error
  }

  void requestPersistenceAfterImport()
  return book
}
