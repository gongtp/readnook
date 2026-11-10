export type BookFormat = 'txt'
export type TextEncoding = 'utf-8' | 'gbk' | 'gb18030'
export type EncodingChoice = 'auto' | TextEncoding
export type ReaderTheme = 'paper' | 'sepia' | 'dark'
export type AutoSplitReason = 'no-headings' | 'long-chapter' | 'front-matter'

export interface ReaderSettings {
  theme: ReaderTheme
  fontSize: number
  lineHeight: number
  pageMargin: number
}

export interface Book {
  id: string
  title: string
  author?: string
  format: BookFormat
  sourceFileName: string
  contentHash: string
  byteSize: number
  encoding: TextEncoding
  totalChars: number
  chapterCount: number
  /** 排在最前面、不参与章节编号的前置章节数量（“开篇”）。旧书可能没有该字段。 */
  frontMatterCount?: number
  parserVersion: number
  parseWarnings: string[]
  importedAt: number
  lastReadAt: number
  lastOpenedAt?: number
  updatedAt: number
}

export interface BookFile {
  bookId: string
  blob: Blob
  byteLength: number
  mimeType: string
}

export interface ChapterMeta {
  id: string
  bookId: string
  chapterKey: string
  order: number
  title: string
  startChar: number
  charCount: number
  autoSplit: boolean
  autoSplitReason: AutoSplitReason | null
}

export interface ChapterContent {
  chapterId: string
  content: string
}

export interface ReadingProgress {
  bookId: string
  chapterKey: string
  chapterIndex: number
  charOffset: number
  chapterProgress: number
  bookProgress: number
  updatedAt: number
}

export interface Bookmark {
  id: string
  bookId: string
  chapterKey: string
  chapterIndex: number
  charOffset: number
  chapterTitle: string
  excerpt: string
  createdAt: number
}

export interface ReaderSettingsRow {
  key: 'reader'
  value: ReaderSettings
  updatedAt: number
}

export interface BookshelfEntry {
  book: Book
  progress: ReadingProgress | null
}
