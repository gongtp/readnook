export const APP_NAME = 'ReadNook'
export const APP_VERSION = __APP_VERSION__
export const APP_BUILD_TIME = __APP_BUILD_TIME__
export const DB_NAME = 'ReadNookDB'
export const DB_VERSION = 1
export const PARSER_VERSION = 2

export const MAX_TXT_BYTES = 30 * 1024 * 1024
export const MAX_BACKUP_ARCHIVE_BYTES = 200 * 1024 * 1024
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024
export const AUTO_SEGMENT_CHARS = 8_000
// 识别到章节标题时不再按字数拆章；只有单章大到会影响滚动时才兜底分段。
export const MAX_CHAPTER_CHARS = 100_000
export const MAX_BOOKMARKS_PER_BOOK = 5_000
export const MAX_BOOKMARK_NOTE_CHARS = 300

export const BACKUP_FORMAT = 'readnook-backup'
export const BACKUP_VERSION = 1

export const THEME_STORAGE_KEY = 'readnook.theme'
export const INSTALL_HINT_KEY = 'readnook.install-hint-dismissed'
export const PERSIST_STORAGE_KEY = 'readnook.storage-persisted'

export const READER_FONT_MIN = 17
export const READER_FONT_MAX = 26
export const READER_LINE_HEIGHT_MIN = 1.5
export const READER_LINE_HEIGHT_MAX = 2.2
export const READER_MARGIN_MIN = 16
export const READER_MARGIN_MAX = 32
