import { db, type ReadNookDatabase } from '@/db/database'
import type {
  Book,
  BookFile,
  Bookmark,
  ReaderSettings,
  ReadingProgress,
} from '@/types/models'
import { getReaderSettings } from '@/db/settingsRepository'
import {
  getBookByContentHash,
  saveBookBundle,
  type BookBundle,
} from '@/db/libraryRepository'

export interface BackupSnapshot {
  books: Book[]
  files: BookFile[]
  progress: ReadingProgress[]
  bookmarks: Bookmark[]
  settings: ReaderSettings
}

export async function readBackupSnapshot(
  database: ReadNookDatabase = db,
): Promise<BackupSnapshot> {
  const [books, files, progress, bookmarks, settings] = await Promise.all([
    database.books.toArray(),
    database.files.toArray(),
    database.progress.toArray(),
    database.bookmarks.toArray(),
    getReaderSettings(database),
  ])
  return { books, files, progress, bookmarks, settings }
}

export async function findExistingHashes(
  hashes: readonly string[],
  database: ReadNookDatabase = db,
): Promise<Set<string>> {
  const found = new Set<string>()
  await Promise.all(
    hashes.map(async (hash) => {
      const book = await getBookByContentHash(hash, database)
      if (book) found.add(hash)
    }),
  )
  return found
}

export async function restoreBookBundle(
  bundle: BookBundle,
  database: ReadNookDatabase = db,
): Promise<void> {
  await saveBookBundle(bundle, database)
}
