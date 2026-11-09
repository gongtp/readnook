import Dexie, { type Table } from 'dexie'
import { DB_NAME, DB_VERSION } from '@/config/app'
import type {
  Book,
  BookFile,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ReaderSettingsRow,
  ReadingProgress,
} from '@/types/models'

export class ReadNookDatabase extends Dexie {
  books!: Table<Book, string>
  files!: Table<BookFile, string>
  chapters!: Table<ChapterMeta, string>
  chapterContents!: Table<ChapterContent, string>
  progress!: Table<ReadingProgress, string>
  bookmarks!: Table<Bookmark, string>
  settings!: Table<ReaderSettingsRow, string>

  constructor(name = DB_NAME) {
    super(name)

    // 只追加版本和 upgrade，不删除旧表。升级必须保留书库。
    this.version(DB_VERSION).stores({
      books: 'id, &contentHash, lastReadAt, importedAt',
      files: 'bookId',
      chapters: 'id, bookId, &[bookId+chapterKey], [bookId+order]',
      chapterContents: 'chapterId',
      progress: 'bookId',
      bookmarks: 'id, bookId, [bookId+chapterKey], createdAt',
      settings: 'key',
    })
  }
}

export const db = new ReadNookDatabase()
