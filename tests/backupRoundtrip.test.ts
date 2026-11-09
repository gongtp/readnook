import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { db } from '@/db/database'
import { saveBookBundle, type BookBundle } from '@/db/libraryRepository'
import { saveReaderSettings } from '@/db/settingsRepository'
import {
  createBackup,
  readBackupArchive,
} from '@/services/backupService'
import { BackupValidationError } from '@/domain/backup/validate'
import { sha256Hex } from '@/utils/hash'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const ORIGINAL_TEXT = '第一章 山雨\n夜色像浸了水的纸。\n\n第二章 灯火\n他推开窗。\n'

function makeBundle(contentHash: string): BookBundle {
  const now = 1_700_000_000_000
  return {
    book: {
      id: BOOK_ID,
      title: '山雨',
      format: 'txt',
      sourceFileName: '山雨.txt',
      contentHash,
      byteSize: new TextEncoder().encode(ORIGINAL_TEXT).byteLength,
      encoding: 'utf-8',
      totalChars: 12,
      chapterCount: 2,
      parserVersion: 1,
      parseWarnings: [],
      importedAt: now,
      lastReadAt: now,
      updatedAt: now,
    },
    file: {
      bookId: BOOK_ID,
      blob: new Blob([ORIGINAL_TEXT], { type: 'text/plain' }),
      byteLength: new TextEncoder().encode(ORIGINAL_TEXT).byteLength,
      mimeType: 'text/plain',
    },
    chapters: [
      {
        meta: {
          id: `${BOOK_ID}:ch_0000`,
          bookId: BOOK_ID,
          chapterKey: 'ch_0000',
          order: 0,
          title: '第一章 山雨',
          startChar: 0,
          charCount: 6,
          autoSplit: false,
          autoSplitReason: null,
        },
        content: {
          chapterId: `${BOOK_ID}:ch_0000`,
          content: '夜色像浸了水的纸。',
        },
      },
    ],
    progress: {
      bookId: BOOK_ID,
      chapterKey: 'ch_0000',
      chapterIndex: 0,
      charOffset: 2,
      chapterProgress: 0.33,
      bookProgress: 0.16,
      updatedAt: now,
    },
    bookmarks: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        bookId: BOOK_ID,
        chapterKey: 'ch_0000',
        chapterIndex: 0,
        charOffset: 2,
        chapterTitle: '第一章 山雨',
        excerpt: '夜色',
        createdAt: now,
      },
    ],
  }
}

async function seedBook(): Promise<string> {
  const hash = await sha256Hex(new TextEncoder().encode(ORIGINAL_TEXT))
  await saveBookBundle(makeBundle(hash))
  await saveReaderSettings({
    theme: 'sepia',
    fontSize: 21,
    lineHeight: 1.9,
    pageMargin: 24,
  })
  return hash
}

async function blobToFile(blob: Blob, name = 'backup.zip'): Promise<File> {
  return new File([await blob.arrayBuffer()], name, { type: blob.type })
}

async function expectBackupError(
  promise: Promise<unknown>,
  fragment?: string,
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(BackupValidationError)
    if (fragment) {
      expect((error as Error).message).toContain(fragment)
    }
    return
  }
  throw new Error('expected a BackupValidationError')
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  await db.delete()
})

describe('backup export', () => {
  it('writes only the manifest and original files into the ZIP', async () => {
    const hash = await seedBook()
    const backup = await createBackup()

    expect(backup.fileName).toMatch(/^ReadNook-backup-\d{8}-\d{6}\.zip$/)
    expect(backup.manifest.bookCount).toBe(1)
    expect(backup.manifest.settings?.theme).toBe('sepia')
    expect(backup.manifest.books[0]).toMatchObject({
      id: BOOK_ID,
      title: '山雨',
      contentHash: hash,
      originalPath: `books/${BOOK_ID}/original.txt`,
      originalSize: new TextEncoder().encode(ORIGINAL_TEXT).byteLength,
    })
    expect(backup.manifest.books[0]?.bookmarks).toHaveLength(1)

    const entries = unzipSync(
      new Uint8Array(await backup.blob.arrayBuffer()),
    )
    expect(Object.keys(entries).sort()).toEqual([
      `books/${BOOK_ID}/original.txt`,
      'manifest.json',
    ])
    const original = entries[`books/${BOOK_ID}/original.txt`]
    expect(original).toBeDefined()
    expect(new TextDecoder().decode(original)).toBe(ORIGINAL_TEXT)
    const manifestEntry = entries['manifest.json']
    expect(manifestEntry).toBeDefined()
    expect(JSON.parse(new TextDecoder().decode(manifestEntry))).toMatchObject({
      format: 'readnook-backup',
      version: 1,
      bookCount: 1,
    })
  })

  it('fails when a book has no stored original file', async () => {
    const hash = await seedBook()
    await db.files.clear()
    await expectBackupError(createBackup(), '缺少原始文件')
    expect(hash).toHaveLength(64)
  })
})

describe('backup reading', () => {
  it('validates a backup and plans a restore into an empty library', async () => {
    await seedBook()
    const backup = await createBackup()
    await db.delete()
    await db.open()

    const prepared = await readBackupArchive(await blobToFile(backup.blob))
    expect(prepared.manifest.bookCount).toBe(1)
    expect(prepared.plan.accepted).toHaveLength(1)
    expect(prepared.plan.skipped).toEqual([])
    expect(prepared.summary).toEqual({
      createdAt: prepared.manifest.createdAt,
      totalBooks: 1,
      restorableBooks: 1,
      duplicateBooks: 0,
      settingsIncluded: true,
    })
    expect(prepared.files.has(`books/${BOOK_ID}/original.txt`)).toBe(true)
  })

  it('skips backups whose content is already in the library', async () => {
    await seedBook()
    const backup = await createBackup()
    const prepared = await readBackupArchive(await blobToFile(backup.blob))
    expect(prepared.plan.accepted).toEqual([])
    expect(prepared.plan.skipped[0]?.reason).toBe('duplicate')
    expect(prepared.summary.duplicateBooks).toBe(1)
  })

  it('ignores unrelated or path-traversal ZIP entries', async () => {
    await seedBook()
    const backup = await createBackup()
    await db.delete()
    await db.open()
    const entries = unzipSync(
      new Uint8Array(await backup.blob.arrayBuffer()),
    )
    const dangerous = zipSync({
      ...entries,
      '../evil.txt': new TextEncoder().encode('nope'),
      'books/not-a-uuid/original.txt': new TextEncoder().encode('nope'),
    })
    const file = new File([dangerous], 'backup.zip', {
      type: 'application/zip',
    })
    const prepared = await readBackupArchive(file)
    expect(prepared.plan.accepted).toHaveLength(1)
    expect(prepared.files.has('../evil.txt')).toBe(false)
  })

  it('rejects archives without a manifest', async () => {
    const archive = zipSync({
      'books/11111111-1111-4111-8111-111111111111/original.txt':
        new TextEncoder().encode('text'),
    })
    await expectBackupError(
      readBackupArchive(
        new File([archive], 'backup.zip', { type: 'application/zip' }),
      ),
      '缺少 manifest.json',
    )
  })

  it('rejects a manifest whose file size does not match the ZIP', async () => {
    await seedBook()
    const backup = await createBackup()
    const entries = unzipSync(
      new Uint8Array(await backup.blob.arrayBuffer()),
    )
    const manifest = JSON.parse(
      new TextDecoder().decode(entries['manifest.json']),
    ) as {
      books: Array<{ originalSize: number; byteSize: number }>
    }
    manifest.books[0]!.originalSize += 1
    manifest.books[0]!.byteSize += 1
    const archive = zipSync({
      ...entries,
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    })
    await expectBackupError(
      readBackupArchive(
        new File([archive], 'backup.zip', { type: 'application/zip' }),
      ),
      '大小与清单不一致',
    )
  })

  it('rejects empty and truncated archives', async () => {
    await expectBackupError(
      readBackupArchive(new File([], 'empty.zip')),
      '备份文件为空',
    )
    await expectBackupError(
      readBackupArchive(
        new File([new Uint8Array([1, 2, 3, 4])], 'broken.zip', {
          type: 'application/zip',
        }),
      ),
      '无法解压',
    )
  })
})
