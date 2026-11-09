import { db, type ReadNookDatabase } from '@/db/database'
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
} from '@/domain/readerSettings'
import type { ReaderSettings, ReaderSettingsRow } from '@/types/models'

export async function getReaderSettings(
  database: ReadNookDatabase = db,
): Promise<ReaderSettings> {
  const row = await database.settings.get('reader')
  if (!row) return { ...DEFAULT_READER_SETTINGS }
  return normalizeReaderSettings(row.value)
}

export async function saveReaderSettings(
  settings: ReaderSettings,
  database: ReadNookDatabase = db,
): Promise<void> {
  const row: ReaderSettingsRow = {
    key: 'reader',
    value: normalizeReaderSettings(settings),
    updatedAt: Date.now(),
  }
  await database.settings.put(row)
}
