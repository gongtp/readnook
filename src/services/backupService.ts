import { APP_VERSION, BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_ARCHIVE_BYTES, MAX_BACKUP_UNCOMPRESSED_BYTES, PARSER_VERSION } from '@/config/app'
import { readBackupSnapshot, findExistingHashes, restoreBookBundle } from '@/db/backupRepository'
import {
  getAllBookFiles,
  listBooks,
} from '@/db/libraryRepository'
import {
  planRestore,
  validateBackupManifest,
  BackupValidationError,
} from '@/domain/backup/validate'
import { buildReadingProgress, clampCharOffset } from '@/domain/progress'
import { saveReaderSettings } from '@/db/settingsRepository'
import { txtFormatAdapter } from '@/services/import/txtFormatAdapter'
import {
  createChapterBundle,
  sanitizeBookTitle,
} from '@/services/import/importBook'
import type {
  BackupBook,
  BackupManifest,
  PreparedBackup,
  RestoreSummary,
} from '@/types/backup'
import type {
  Book,
  BookFile,
  Bookmark,
  ReaderSettings,
  ReadingProgress,
} from '@/types/models'
import { createId, isSafeId } from '@/utils/id'
import { formatBackupFileName } from '@/utils/format'
import { sha256Hex } from '@/utils/hash'

type AsyncZippable = Record<
  string,
  Uint8Array | [Uint8Array, { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]
>

export interface BackupBuildResult {
  blob: Blob
  fileName: string
  manifest: BackupManifest
}

export interface BackupProgressReporter {
  (stage: string): void
}

function toBackupBook(
  book: Book,
  progress: ReadingProgress | undefined,
  bookmarks: Bookmark[],
): BackupBook {
  if (!isSafeId(book.id)) {
    throw new BackupValidationError('书库中存在无效的书籍标识，无法导出备份。')
  }
  return {
    id: book.id,
    title: book.title,
    format: 'txt',
    sourceFileName: book.sourceFileName,
    contentHash: book.contentHash,
    byteSize: book.byteSize,
    encoding: book.encoding,
    totalChars: book.totalChars,
    chapterCount: book.chapterCount,
    parserVersion: book.parserVersion,
    parseWarnings: book.parseWarnings,
    importedAt: book.importedAt,
    lastReadAt: book.lastReadAt,
    originalPath: `books/${book.id}/original.txt`,
    originalSize: book.byteSize,
    progress: progress ?? null,
    bookmarks,
  }
}

export async function createBackup(
  onProgress?: BackupProgressReporter,
): Promise<BackupBuildResult> {
  onProgress?.('读取书库信息')
  const snapshot = await readBackupSnapshot()
  const progressByBook = new Map(
    snapshot.progress.map((progress) => [progress.bookId, progress]),
  )
  const bookmarksByBook = new Map<string, Bookmark[]>()
  for (const bookmark of snapshot.bookmarks) {
    const list = bookmarksByBook.get(bookmark.bookId) ?? []
    list.push(bookmark)
    bookmarksByBook.set(bookmark.bookId, list)
  }

  const filesByBook = new Map(snapshot.files.map((file) => [file.bookId, file]))
  const backups: BackupBook[] = []
  const zipEntries: AsyncZippable = {}

  for (let index = 0; index < snapshot.books.length; index += 1) {
    const book = snapshot.books[index]
    if (!book) continue
    onProgress?.(`读取原文件 ${index + 1} / ${snapshot.books.length}`)
    const file = filesByBook.get(book.id)
    if (!file) {
      throw new BackupValidationError(
        `《${book.title}》缺少原始文件，无法生成完整备份。`,
      )
    }
    const bytes = new Uint8Array(await file.blob.arrayBuffer())
    if (bytes.byteLength === 0) {
      throw new BackupValidationError(
        `《${book.title}》的原始文件为空，无法生成备份。`,
      )
    }

    const backupBook = toBackupBook(
      book,
      progressByBook.get(book.id),
      bookmarksByBook.get(book.id) ?? [],
    )
    backupBook.byteSize = bytes.byteLength
    backupBook.originalSize = bytes.byteLength
    backups.push(backupBook)
    zipEntries[backupBook.originalPath] = bytes
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    parserVersion: PARSER_VERSION,
    bookCount: backups.length,
    settings: snapshot.settings,
    books: backups,
  }

  onProgress?.('生成备份清单')
  zipEntries['manifest.json'] = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2),
  )

  onProgress?.('压缩备份文件')
  const { zip } = await import('fflate')
  const zipBytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zipEntries, { level: 6 }, (error, data) => {
      if (error) {
        reject(new Error(`压缩备份失败：${error.message}`))
        return
      }
      resolve(data)
    })
  })

  onProgress?.('备份已生成')
  const blobBytes = new Uint8Array(zipBytes.byteLength)
  blobBytes.set(zipBytes)
  return {
    blob: new Blob([blobBytes.buffer], { type: 'application/zip' }),
    fileName: formatBackupFileName(),
    manifest,
  }
}

function validateExtractedPath(path: string): boolean {
  return (
    path === 'manifest.json' ||
    /^books\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/original\.txt$/i.test(
      path,
    )
  )
}

export async function readBackupArchive(
  file: File,
  onProgress?: BackupProgressReporter,
): Promise<PreparedBackup> {
  if (file.size === 0) {
    throw new BackupValidationError('所选备份文件为空。')
  }
  if (file.size > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new BackupValidationError('备份文件过大，超出当前版本支持的范围。')
  }

  onProgress?.('读取 ZIP 文件')
  const raw = new Uint8Array(await file.arrayBuffer())
  const { unzip } = await import('fflate')

  let totalUncompressed = 0
  const files = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      try {
        unzip(
          raw,
          {
            filter: (entry) => {
              if (!validateExtractedPath(entry.name)) return false
              totalUncompressed += entry.originalSize
              if (totalUncompressed > MAX_BACKUP_UNCOMPRESSED_BYTES) {
                throw new BackupValidationError(
                  '备份解压后的内容过大，已取消恢复。',
                )
              }
              return true
            },
          },
          (error, data) => {
            if (error) {
              reject(new BackupValidationError(`无法解压备份文件：${error.message}`))
              return
            }
            resolve(data)
          },
        )
      } catch (error) {
        reject(error)
      }
    },
  )

  onProgress?.('校验备份清单')
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) {
    throw new BackupValidationError('备份中缺少 manifest.json。')
  }

  let manifestValue: unknown
  try {
    const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(
      manifestBytes,
    )
    manifestValue = JSON.parse(manifestText) as unknown
  } catch {
    throw new BackupValidationError('备份清单 JSON 无法读取或格式损坏。')
  }

  const manifest = validateBackupManifest(manifestValue)
  for (const book of manifest.books) {
    const bytes = files[book.originalPath]
    if (!bytes) {
      throw new BackupValidationError(
        `备份中缺少《${book.title}》的原始文件。`,
      )
    }
    if (bytes.byteLength !== book.originalSize) {
      throw new BackupValidationError(
        `《${book.title}》的原文件大小与清单不一致。`,
      )
    }
  }

  onProgress?.('检查书库冲突')
  const existingHashes = await findExistingHashes(
    manifest.books.map((book) => book.contentHash),
  )
  const existingBooks = await listBooks()
  const plan = planRestore(
    manifest,
    existingHashes,
    new Set(existingBooks.map((book) => book.id)),
    createId,
  )

  return {
    manifest,
    files: new Map(Object.entries(files)),
    plan,
    summary: {
      createdAt: manifest.createdAt,
      totalBooks: manifest.books.length,
      restorableBooks: plan.accepted.length,
      duplicateBooks: plan.skipped.length,
      settingsIncluded: manifest.settings !== null,
    },
  }
}

export interface RestoreOptions {
  restoreSettings: boolean
  onProgress?: BackupProgressReporter
}

function fileFromBytes(
  bytes: Uint8Array,
  fileName: string,
): File {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new File([copy], fileName, { type: 'text/plain' })
}

function toReadingProgress(
  backupBook: BackupBook,
  bookId: string,
  parsedChapters: Parameters<typeof buildReadingProgress>[1],
  totalChars: number,
  now: number,
  warnings: string[],
): ReadingProgress {
  const saved = backupBook.progress
  if (!saved) {
    return buildReadingProgress(bookId, parsedChapters, 0, 0, totalChars, now)
  }
  const chapter = parsedChapters.find(
    (item) => item.chapterKey === saved.chapterKey,
  )
  if (!chapter) {
    warnings.push(
      `《${backupBook.title}》的阅读位置章节不存在，已回到第一章开头。`,
    )
    return buildReadingProgress(bookId, parsedChapters, 0, 0, totalChars, now)
  }
  return buildReadingProgress(
    bookId,
    parsedChapters,
    chapter.order,
    clampCharOffset(saved.charOffset, chapter.charCount),
    totalChars,
    saved.updatedAt || now,
  )
}

export async function executeBackupRestore(
  prepared: PreparedBackup,
  options: RestoreOptions,
): Promise<RestoreSummary> {
  const { manifest, plan, files } = prepared
  const warnings: string[] = []
  const failures: string[] = []
  let skippedBookmarks = 0
  let restoredBooks = 0

  if (manifest.parserVersion !== PARSER_VERSION) {
    warnings.push('备份由其他解析器版本生成，章节分段可能与当时不同。')
  }

  options.onProgress?.('校验原文件摘要')
  for (let index = 0; index < plan.accepted.length; index += 1) {
    const accepted = plan.accepted[index]
    if (!accepted) continue
    const bytes = files.get(accepted.book.originalPath)
    if (!bytes) {
      throw new BackupValidationError('备份中的原文件缺失，已取消恢复。')
    }
    options.onProgress?.(
      `校验原文件 ${index + 1} / ${plan.accepted.length}`,
    )
    const digest = await sha256Hex(bytes)
    if (digest !== accepted.book.contentHash) {
      throw new BackupValidationError(
        `《${accepted.book.title}》的原始文件校验失败。未写入任何备份内容，现有书库保持不变。`,
      )
    }
  }

  for (let index = 0; index < plan.accepted.length; index += 1) {
    const accepted = plan.accepted[index]
    if (!accepted) continue
    const backupBook = accepted.book
    const bytes = files.get(backupBook.originalPath)
    if (!bytes) continue

    options.onProgress?.(
      `恢复《${backupBook.title}》 ${index + 1} / ${plan.accepted.length}`,
    )
    const sourceFile = fileFromBytes(bytes, backupBook.sourceFileName)
    const session = txtFormatAdapter.createSession(sourceFile)

    try {
      const analysis = await session.analyze(backupBook.encoding)
      const parsed = await session.parse(analysis.token, backupBook.encoding)
      const bookId = accepted.assignedBookId
      const now = Date.now()
      const chapters = createChapterBundle(bookId, parsed)
      const chapterByKey = new Map(
        parsed.chapters.map((chapter) => [chapter.chapterKey, chapter]),
      )
      const book: Book = {
        id: bookId,
        title: sanitizeBookTitle(backupBook.title, backupBook.sourceFileName),
        format: 'txt',
        sourceFileName: backupBook.sourceFileName,
        contentHash: backupBook.contentHash,
        byteSize: bytes.byteLength,
        encoding: backupBook.encoding,
        totalChars: parsed.totalChars,
        chapterCount: parsed.chapters.length,
        parserVersion: parsed.parserVersion,
        parseWarnings: parsed.warnings,
        importedAt: backupBook.importedAt,
        lastReadAt: backupBook.lastReadAt,
        updatedAt: now,
      }
      const fileRow: BookFile = {
        bookId,
        blob: sourceFile,
        byteLength: bytes.byteLength,
        mimeType: 'text/plain',
      }
      const progress = toReadingProgress(
        backupBook,
        bookId,
        parsed.chapters,
        parsed.totalChars,
        now,
        warnings,
      )

      const bookmarks: Bookmark[] = []
      for (const bookmark of backupBook.bookmarks) {
        const chapter = chapterByKey.get(bookmark.chapterKey)
        if (!chapter) {
          skippedBookmarks += 1
          continue
        }
        bookmarks.push({
          id: createId(),
          bookId,
          chapterKey: bookmark.chapterKey,
          chapterIndex: chapter.order,
          charOffset: clampCharOffset(bookmark.charOffset, chapter.charCount),
          chapterTitle: chapter.title,
          excerpt: bookmark.excerpt,
          createdAt: bookmark.createdAt,
        })
      }
      if (skippedBookmarks > 0) {
        warnings.push('部分书签的章节已不存在，已跳过这些书签。')
      }

      await restoreBookBundle({
        book,
        file: fileRow,
        chapters,
        progress,
        bookmarks,
      })
      restoredBooks += 1
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : '未知错误'
      failures.push(`《${backupBook.title}》：${message}`)
    } finally {
      session.dispose()
    }
  }

  let settingsRestored = false
  if (options.restoreSettings && manifest.settings && failures.length === 0) {
    options.onProgress?.('恢复阅读设置')
    const settings: ReaderSettings = manifest.settings
    await saveReaderSettings(settings)
    settingsRestored = true
  }

  options.onProgress?.('恢复完成')
  return {
    restoredBooks,
    skippedDuplicates: plan.skipped.length,
    skippedBookmarks,
    warnings: [...new Set(warnings)],
    failures,
    settingsRestored,
  }
}

export async function getAllFilesForTest(): Promise<BookFile[]> {
  return getAllBookFiles()
}
