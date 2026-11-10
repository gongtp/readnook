import { describe, expect, it } from 'vitest'
import {
  BackupValidationError,
  planRestore,
  validateBackupManifest,
} from '@/domain/backup/validate'
import type { BackupBook, BackupManifest } from '@/types/backup'
import { BACKUP_FORMAT, BACKUP_VERSION } from '@/config/app'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const BOOK_ID_2 = '33333333-3333-4333-8333-333333333333'
const BOOKMARK_ID = '22222222-2222-4222-8222-222222222222'

function makeBook(overrides: Partial<BackupBook> = {}): BackupBook {
  const id = overrides.id ?? BOOK_ID
  return {
    id,
    title: '山雨',
    format: 'txt',
    sourceFileName: '山雨.txt',
    contentHash: 'a'.repeat(64),
    byteSize: 128,
    encoding: 'utf-8',
    totalChars: 120,
    chapterCount: 2,
    parserVersion: 1,
    parseWarnings: [],
    importedAt: 1_700_000_000_000,
    lastReadAt: 1_700_000_100_000,
    originalPath: `books/${id}/original.txt`,
    originalSize: 128,
    progress: {
      bookId: id,
      chapterKey: 'ch_0001',
      chapterIndex: 1,
      charOffset: 20,
      chapterProgress: 0.4,
      bookProgress: 0.6,
      updatedAt: 1_700_000_100_000,
    },
    bookmarks: [
      {
        id: BOOKMARK_ID,
        bookId: id,
        chapterKey: 'ch_0001',
        chapterIndex: 1,
        charOffset: 10,
        chapterTitle: '第二章',
        excerpt: '他推开窗。',
        createdAt: 1_700_000_050_000,
      },
    ],
    ...overrides,
  }
}

function makeManifest(
  books: BackupBook[] = [makeBook()],
  overrides: Partial<BackupManifest> = {},
): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: '2025-01-02T03:04:05.000Z',
    appVersion: '0.1.0',
    parserVersion: 1,
    bookCount: books.length,
    settings: {
      theme: 'sepia',
      fontSize: 21,
      lineHeight: 1.9,
      pageMargin: 24,
    },
    books,
    ...overrides,
  }
}

function expectValidationError(value: unknown, fragment?: string): void {
  try {
    validateBackupManifest(value)
  } catch (error) {
    expect(error).toBeInstanceOf(BackupValidationError)
    if (fragment) {
      expect((error as Error).message).toContain(fragment)
    }
    return
  }
  throw new Error('expected a BackupValidationError')
}

describe('validateBackupManifest', () => {
  it('preserves optional authors and accepts older backups without them', () => {
    const withAuthor = validateBackupManifest(makeManifest([makeBook({ author: '  某位作者  ' })]))
    expect(withAuthor.books[0]?.author).toBe('某位作者')
    expect(validateBackupManifest(makeManifest()).books[0]?.author).toBeUndefined()
    expect(validateBackupManifest(makeManifest([makeBook({ author: '' })])).books[0]?.author).toBeUndefined()
  })

  it('rejects invalid author metadata', () => {
    expectValidationError(makeManifest([makeBook({ author: '甲'.repeat(81) })]), 'author')
    expectValidationError(makeManifest([makeBook({ author: 123 as unknown as string })]), 'author')
  })

  it('accepts and normalizes a complete manifest', () => {
    const manifest = validateBackupManifest({
      ...makeManifest(),
      appVersion: ' 0.1.0 ',
      books: [
        makeBook({
          contentHash: 'ABCDEF'.repeat(10) + 'ABCD',
          parseWarnings: ['warn', 123, 'ok'] as unknown as string[],
        }),
      ],
    })
    expect(manifest.format).toBe(BACKUP_FORMAT)
    expect(manifest.bookCount).toBe(1)
    expect(manifest.appVersion).toBe('0.1.0')
    expect(manifest.books[0]?.contentHash).toBe('abcdef'.repeat(10) + 'abcd')
    expect(manifest.books[0]?.parseWarnings).toEqual(['warn', 'ok'])
    expect(manifest.books[0]?.progress?.bookId).toBe(BOOK_ID)
    expect(manifest.books[0]?.bookmarks[0]?.bookId).toBe(BOOK_ID)
    expect(manifest.settings?.theme).toBe('sepia')
  })

  it('accepts an empty library and null settings', () => {
    const manifest = validateBackupManifest(
      makeManifest([], { settings: null }),
    )
    expect(manifest.books).toEqual([])
    expect(manifest.bookCount).toBe(0)
    expect(manifest.settings).toBeNull()
  })

  it('rejects objects from other applications', () => {
    expectValidationError({ ...makeManifest(), format: 'other' }, '不是 ReadNook')
    expectValidationError(null, 'JSON 对象')
    expectValidationError([], 'JSON 对象')
  })

  it('rejects future or invalid backup versions', () => {
    expectValidationError(
      { ...makeManifest(), version: BACKUP_VERSION + 1 },
      '更新版本',
    )
    expectValidationError({ ...makeManifest(), version: 0 }, '不受支持')
    expectValidationError({ ...makeManifest(), version: 1.5 }, '版本号无效')
  })

  it('rejects malformed dates, lists and counts', () => {
    expectValidationError(
      { ...makeManifest(), createdAt: 'not-a-date' },
      '创建时间',
    )
    expectValidationError({ ...makeManifest(), books: 'nope' }, '书籍列表')
    expectValidationError(
      { ...makeManifest(), bookCount: 2 },
      '数量与列表不一致',
    )
  })

  it('rejects unsafe identifiers and original paths', () => {
    expectValidationError(
      makeManifest([makeBook({ id: '../../evil' })]),
      '书籍 ID',
    )
    expectValidationError(
      makeManifest([makeBook({ originalPath: '../original.txt' })]),
      '路径不安全',
    )
    expectValidationError(
      makeManifest([makeBook({ originalPath: `books/${BOOK_ID}/other.txt` })]),
      '路径不安全',
    )
  })

  it('rejects duplicate book IDs', () => {
    const manifest = makeManifest([makeBook(), makeBook()], { bookCount: 2 })
    expectValidationError(manifest, '重复的书籍 ID')
  })

  it('rejects unsupported formats and encodings', () => {
    expectValidationError(
      makeManifest([makeBook({ format: 'epub' as unknown as 'txt' })]),
      '不支持的书籍格式',
    )
    expectValidationError(
      makeManifest([makeBook({ encoding: 'big5' as unknown as 'utf-8' })]),
      '不支持的文本编码',
    )
  })

  it('rejects inconsistent file sizes and empty chapters', () => {
    expectValidationError(
      makeManifest([makeBook({ originalSize: 1 })]),
      '原文件大小不一致',
    )
    expectValidationError(
      makeManifest([makeBook({ byteSize: 0, originalSize: 0 })]),
      '原文件大小无效',
    )
    expectValidationError(
      makeManifest([makeBook({ chapterCount: 0 })]),
      '章节数量无效',
    )
  })

  it('rejects invalid progress and bookmark fields', () => {
    expectValidationError(
      makeManifest([
        makeBook({
          progress: {
            ...makeBook().progress!,
            bookProgress: 1.5,
          },
        }),
      ]),
      'bookProgress',
    )
    expectValidationError(
      makeManifest([
        makeBook({
          bookmarks: [
            {
              ...makeBook().bookmarks[0]!,
              id: 'not-a-uuid',
            },
          ],
        }),
      ]),
      '书签 ID',
    )
    expectValidationError(
      makeManifest([
        makeBook({
          bookmarks: [
            {
              ...makeBook().bookmarks[0]!,
              excerpt: '',
            },
          ],
        }),
      ]),
      'excerpt',
    )
  })

  it('normalizes out-of-range reader settings instead of failing', () => {
    const manifest = validateBackupManifest({
      ...makeManifest(),
      settings: {
        theme: 'neon',
        fontSize: 999,
        lineHeight: -1,
        pageMargin: 'wide',
      },
    })
    expect(manifest.settings).toEqual({
      theme: 'paper',
      fontSize: 26,
      lineHeight: 1.5,
      pageMargin: 22,
    })
  })
})

describe('planRestore', () => {
  it('keeps every book when there are no conflicts', () => {
    const manifest = makeManifest()
    const plan = planRestore(manifest, new Set(), new Set(), () => BOOK_ID_2)
    expect(plan.skipped).toEqual([])
    expect(plan.accepted).toHaveLength(1)
    expect(plan.accepted[0]?.book.id).toBe(BOOK_ID)
    expect(plan.accepted[0]?.assignedBookId).toBe(BOOK_ID)
  })

  it('skips hashes already present in the library', () => {
    const manifest = makeManifest()
    const plan = planRestore(
      manifest,
      new Set(['a'.repeat(64)]),
      new Set(),
      () => BOOK_ID_2,
    )
    expect(plan.accepted).toEqual([])
    expect(plan.skipped).toEqual([
      { bookId: BOOK_ID, title: '山雨', reason: 'duplicate' },
    ])
  })

  it('skips duplicate hashes within the same archive', () => {
    const second = makeBook({
      id: BOOK_ID_2,
      title: '山雨（重复）',
      contentHash: 'a'.repeat(64),
    })
    const plan = planRestore(
      makeManifest([makeBook(), second]),
      new Set(),
      new Set(),
      () => '44444444-4444-4444-8444-444444444444',
    )
    expect(plan.accepted).toHaveLength(1)
    expect(plan.skipped[0]?.reason).toBe('duplicate-in-backup')
  })

  it('reassigns IDs that collide with the existing library', () => {
    const generated = '55555555-5555-4555-8555-555555555555'
    const plan = planRestore(
      makeManifest(),
      new Set(),
      new Set([BOOK_ID]),
      () => generated,
    )
    expect(plan.accepted[0]?.assignedBookId).toBe(generated)
    expect(plan.accepted[0]?.book.id).toBe(BOOK_ID)
  })

  it('keeps generating until the assigned ID is free', () => {
    const ids = [
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ]
    let index = 0
    const plan = planRestore(
      makeManifest(),
      new Set(),
      new Set([BOOK_ID, ids[0]!]),
      () => ids[index++]!,
    )
    expect(plan.accepted[0]?.assignedBookId).toBe(ids[1])
  })
})
