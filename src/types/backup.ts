import type {
  BookFormat,
  Bookmark,
  ReaderSettings,
  ReadingProgress,
  TextEncoding,
} from '@/types/models'

export interface BackupBook {
  id: string
  title: string
  format: BookFormat
  sourceFileName: string
  contentHash: string
  byteSize: number
  encoding: TextEncoding
  totalChars: number
  chapterCount: number
  parserVersion: number
  parseWarnings: string[]
  importedAt: number
  lastReadAt: number
  originalPath: string
  originalSize: number
  progress: ReadingProgress | null
  bookmarks: Bookmark[]
}

export interface BackupManifest {
  format: 'readnook-backup'
  version: number
  createdAt: string
  appVersion: string
  parserVersion: number
  bookCount: number
  settings: ReaderSettings | null
  books: BackupBook[]
}

export interface RestoreSkippedBook {
  bookId: string
  title: string
  reason: 'duplicate' | 'duplicate-in-backup'
}

export interface RestoreAcceptedBook {
  book: BackupBook
  assignedBookId: string
}

export interface RestorePlan {
  accepted: RestoreAcceptedBook[]
  skipped: RestoreSkippedBook[]
}

export interface RestoreSummary {
  restoredBooks: number
  skippedDuplicates: number
  skippedBookmarks: number
  warnings: string[]
  failures: string[]
  settingsRestored: boolean
}

export interface PreparedBackup {
  manifest: BackupManifest
  files: Map<string, Uint8Array>
  plan: RestorePlan
  summary: {
    createdAt: string
    totalBooks: number
    restorableBooks: number
    duplicateBooks: number
    settingsIncluded: boolean
  }
}
