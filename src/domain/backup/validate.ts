import { BACKUP_FORMAT, BACKUP_VERSION, MAX_BOOKMARKS_PER_BOOK, MAX_BOOKMARK_NOTE_CHARS } from '@/config/app'
import { normalizeBookmarkNote } from '@/domain/bookmarks'
import { normalizeReaderSettings } from '@/domain/readerSettings'
import type {
  BackupBook,
  BackupManifest,
  RestorePlan,
} from '@/types/backup'
import type {
  Bookmark,
  ReaderSettings,
  ReadingProgress,
  TextEncoding,
} from '@/types/models'
import { isSafeId } from '@/utils/id'

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupValidationError'
  }
}

const ENCODINGS: readonly TextEncoding[] = ['utf-8', 'gbk', 'gb18030']
const MAX_BOOKS = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(
  value: unknown,
  field: string,
  maxLength = 10_000,
): string {
  if (typeof value !== 'string') {
    throw new BackupValidationError(`备份中的 ${field} 字段格式无效。`)
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) {
    throw new BackupValidationError(`备份中的 ${field} 字段为空或过长。`)
  }
  return trimmed
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BackupValidationError(`备份中的 ${field} 必须是非负整数。`)
  }
  return value as number
}

function requireTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BackupValidationError(`备份中的 ${field} 时间戳无效。`)
  }
  return value
}

function validateProgress(
  value: unknown,
  bookId: string,
  field: string,
): ReadingProgress | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) {
    throw new BackupValidationError(`备份中的 ${field} 阅读进度格式无效。`)
  }

  const chapterKey = requireString(value.chapterKey, `${field}.chapterKey`, 64)
  const chapterIndex = requireNonNegativeInteger(
    value.chapterIndex,
    `${field}.chapterIndex`,
  )
  const charOffset = requireNonNegativeInteger(
    value.charOffset,
    `${field}.charOffset`,
  )
  const chapterProgress = value.chapterProgress
  const bookProgress = value.bookProgress
  if (
    typeof chapterProgress !== 'number' ||
    !Number.isFinite(chapterProgress) ||
    chapterProgress < 0 ||
    chapterProgress > 1
  ) {
    throw new BackupValidationError(`备份中的 ${field}.chapterProgress 无效。`)
  }
  if (
    typeof bookProgress !== 'number' ||
    !Number.isFinite(bookProgress) ||
    bookProgress < 0 ||
    bookProgress > 1
  ) {
    throw new BackupValidationError(`备份中的 ${field}.bookProgress 无效。`)
  }

  return {
    bookId,
    chapterKey,
    chapterIndex,
    charOffset,
    chapterProgress,
    bookProgress,
    updatedAt: requireTimestamp(value.updatedAt, `${field}.updatedAt`),
  }
}

function validateBookmark(
  value: unknown,
  bookId: string,
  field: string,
): Bookmark {
  if (!isRecord(value)) {
    throw new BackupValidationError(`备份中的 ${field} 书签格式无效。`)
  }
  const id = requireString(value.id, `${field}.id`, 80)
  if (!isSafeId(id)) {
    throw new BackupValidationError(`备份中的书签 ID 无效。`)
  }
  return {
    id,
    bookId,
    chapterKey: requireString(value.chapterKey, `${field}.chapterKey`, 64),
    chapterIndex: requireNonNegativeInteger(
      value.chapterIndex,
      `${field}.chapterIndex`,
    ),
    charOffset: requireNonNegativeInteger(value.charOffset, `${field}.charOffset`),
    chapterTitle: requireString(value.chapterTitle, `${field}.chapterTitle`, 200),
    excerpt: requireString(value.excerpt, `${field}.excerpt`, 400),
    note: value.note === undefined || value.note === '' ? undefined :
      normalizeBookmarkNote(requireString(value.note, `${field}.note`, MAX_BOOKMARK_NOTE_CHARS)),
    createdAt: requireTimestamp(value.createdAt, `${field}.createdAt`),
  }
}

function validateBook(
  value: unknown,
  index: number,
): BackupBook {
  if (!isRecord(value)) {
    throw new BackupValidationError(`备份中的第 ${index + 1} 本书格式无效。`)
  }

  const id = requireString(value.id, `books[${index}].id`, 64)
  if (!isSafeId(id)) {
    throw new BackupValidationError('备份中存在无效的书籍 ID。')
  }

  const format = value.format
  if (format !== 'txt') {
    throw new BackupValidationError('备份中包含当前版本不支持的书籍格式。')
  }

  const encoding = value.encoding
  if (!ENCODINGS.includes(encoding as TextEncoding)) {
    throw new BackupValidationError('备份中存在不支持的文本编码。')
  }

  const contentHash = requireString(
    value.contentHash,
    `books[${index}].contentHash`,
    64,
  )
  if (!/^[0-9a-f]{64}$/i.test(contentHash)) {
    throw new BackupValidationError('备份中的书籍内容摘要格式无效。')
  }

  const byteSize = requireNonNegativeInteger(
    value.byteSize,
    `books[${index}].byteSize`,
  )
  if (byteSize <= 0) {
    throw new BackupValidationError('备份中的原文件大小无效。')
  }

  const chapterCount = requireNonNegativeInteger(
    value.chapterCount,
    `books[${index}].chapterCount`,
  )
  if (chapterCount <= 0) {
    throw new BackupValidationError('备份中的章节数量无效。')
  }

  const originalPath = requireString(
    value.originalPath,
    `books[${index}].originalPath`,
    200,
  )
  if (originalPath !== `books/${id}/original.txt`) {
    throw new BackupValidationError('备份中的原文件路径不安全或与书籍 ID 不匹配。')
  }

  const originalSize = requireNonNegativeInteger(
    value.originalSize,
    `books[${index}].originalSize`,
  )
  if (originalSize !== byteSize) {
    throw new BackupValidationError('备份中的原文件大小不一致。')
  }

  const progress = validateProgress(
    value.progress,
    id,
    `books[${index}].progress`,
  )

  if (!Array.isArray(value.bookmarks)) {
    throw new BackupValidationError('备份中的书签列表格式无效。')
  }
  if (value.bookmarks.length > MAX_BOOKMARKS_PER_BOOK) {
    throw new BackupValidationError('单本书的书签数量超出备份支持上限。')
  }
  const bookmarks = value.bookmarks.map((bookmark, bookmarkIndex) =>
    validateBookmark(bookmark, id, `books[${index}].bookmarks[${bookmarkIndex}]`),
  )

  const warnings = Array.isArray(value.parseWarnings)
    ? value.parseWarnings
        .filter((warning): warning is string => typeof warning === 'string')
        .slice(0, 20)
    : []

  const title = requireString(value.title, `books[${index}].title`, 200)
  const author = value.author === undefined || value.author === ''
    ? undefined
    : requireString(value.author, `books[${index}].author`, 80)
  const sourceFileName = requireString(
    value.sourceFileName,
    `books[${index}].sourceFileName`,
    255,
  )

  return {
    id,
    title,
    author,
    format: 'txt',
    sourceFileName,
    contentHash: contentHash.toLowerCase(),
    byteSize,
    encoding: encoding as TextEncoding,
    totalChars: requireNonNegativeInteger(
      value.totalChars,
      `books[${index}].totalChars`,
    ),
    chapterCount,
    parserVersion: requireNonNegativeInteger(
      value.parserVersion,
      `books[${index}].parserVersion`,
    ),
    parseWarnings: warnings,
    importedAt: requireTimestamp(
      value.importedAt,
      `books[${index}].importedAt`,
    ),
    lastReadAt: requireTimestamp(
      value.lastReadAt,
      `books[${index}].lastReadAt`,
    ),
    originalPath,
    lastOpenedAt: value.lastOpenedAt === undefined ? undefined :
      requireTimestamp(value.lastOpenedAt, `books[${index}].lastOpenedAt`),
    originalSize,
    progress,
    bookmarks,
  }
}

export function validateBackupManifest(value: unknown): BackupManifest {
  if (!isRecord(value)) {
    throw new BackupValidationError('备份清单不是有效的 JSON 对象。')
  }
  if (value.format !== BACKUP_FORMAT) {
    throw new BackupValidationError('这不是 ReadNook 备份文件。')
  }
  if (!Number.isInteger(value.version)) {
    throw new BackupValidationError('备份版本号无效。')
  }
  if ((value.version as number) > BACKUP_VERSION) {
    throw new BackupValidationError(
      '这个备份来自更新版本的 ReadNook，请先更新应用后再恢复。',
    )
  }
  if ((value.version as number) < 1) {
    throw new BackupValidationError('备份版本不受支持。')
  }
  if (!Array.isArray(value.books)) {
    throw new BackupValidationError('备份中的书籍列表格式无效。')
  }
  if (value.books.length > MAX_BOOKS) {
    throw new BackupValidationError('备份中的书籍数量超出支持上限。')
  }

  const createdAt = requireString(value.createdAt, 'createdAt', 64)
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new BackupValidationError('备份创建时间格式无效。')
  }

  let settings: ReaderSettings | null = null
  if (value.settings !== null && value.settings !== undefined) {
    if (!isRecord(value.settings)) {
      throw new BackupValidationError('备份中的阅读设置格式无效。')
    }
    settings = normalizeReaderSettings(value.settings)
  }

  const books = value.books.map(validateBook)
  const bookCount = requireNonNegativeInteger(value.bookCount, 'bookCount')
  if (bookCount !== books.length) {
    throw new BackupValidationError('备份清单的书籍数量与列表不一致。')
  }
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const book of books) {
    if (ids.has(book.id)) {
      throw new BackupValidationError('备份中存在重复的书籍 ID。')
    }
    if (paths.has(book.originalPath)) {
      throw new BackupValidationError('备份中存在重复的原文件路径。')
    }
    ids.add(book.id)
    paths.add(book.originalPath)
  }

  return {
    format: BACKUP_FORMAT,
    version: value.version as number,
    createdAt,
    appVersion:
      typeof value.appVersion === 'string' && value.appVersion.trim()
        ? value.appVersion.trim().slice(0, 40)
        : 'unknown',
    parserVersion:
      typeof value.parserVersion === 'number' &&
      Number.isInteger(value.parserVersion)
        ? value.parserVersion
        : 0,
    bookCount: books.length,
    settings,
    books,
  }
}

export function planRestore(
  manifest: BackupManifest,
  existingContentHashes: ReadonlySet<string>,
  existingBookIds: ReadonlySet<string>,
  makeId: () => string,
): RestorePlan {
  const accepted: RestorePlan['accepted'] = []
  const skipped: RestorePlan['skipped'] = []
  const seenHashes = new Set<string>()
  const reservedIds = new Set(existingBookIds)
  const usedAssignedIds = new Set<string>()

  for (const book of manifest.books) {
    if (
      existingContentHashes.has(book.contentHash) ||
      seenHashes.has(book.contentHash)
    ) {
      skipped.push({
        bookId: book.id,
        title: book.title,
        reason: existingContentHashes.has(book.contentHash)
          ? 'duplicate'
          : 'duplicate-in-backup',
      })
      continue
    }

    let assignedBookId = book.id
    if (reservedIds.has(assignedBookId) || usedAssignedIds.has(assignedBookId)) {
      do {
        assignedBookId = makeId()
      } while (
        reservedIds.has(assignedBookId) ||
        usedAssignedIds.has(assignedBookId)
      )
    }

    usedAssignedIds.add(assignedBookId)
    seenHashes.add(book.contentHash)
    accepted.push({ book, assignedBookId })
  }

  return { accepted, skipped }
}
