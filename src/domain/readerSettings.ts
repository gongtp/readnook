import {
  READER_FONT_MAX,
  READER_FONT_MIN,
  READER_LINE_HEIGHT_MAX,
  READER_LINE_HEIGHT_MIN,
  READER_MARGIN_MAX,
  READER_MARGIN_MIN,
} from '@/config/app'
import type { ReaderSettings, ReaderTheme } from '@/types/models'

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'paper',
  fontSize: 19,
  lineHeight: 1.85,
  pageMargin: 22,
}

const ALLOWED_THEMES: readonly ReaderTheme[] = ['paper', 'sepia', 'dark']

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  precision = 0,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const clamped = Math.max(min, Math.min(value, max))
  const factor = 10 ** precision
  return Math.round(clamped * factor) / factor
}

export function normalizeReaderSettings(value: unknown): ReaderSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_READER_SETTINGS }
  const candidate = value as Partial<ReaderSettings>
  const theme = ALLOWED_THEMES.includes(candidate.theme as ReaderTheme)
    ? (candidate.theme as ReaderTheme)
    : DEFAULT_READER_SETTINGS.theme

  return {
    theme,
    fontSize: clampNumber(
      candidate.fontSize,
      DEFAULT_READER_SETTINGS.fontSize,
      READER_FONT_MIN,
      READER_FONT_MAX,
    ),
    lineHeight: clampNumber(
      candidate.lineHeight,
      DEFAULT_READER_SETTINGS.lineHeight,
      READER_LINE_HEIGHT_MIN,
      READER_LINE_HEIGHT_MAX,
      2,
    ),
    pageMargin: clampNumber(
      candidate.pageMargin,
      DEFAULT_READER_SETTINGS.pageMargin,
      READER_MARGIN_MIN,
      READER_MARGIN_MAX,
    ),
  }
}

export function isReaderTheme(value: unknown): value is ReaderTheme {
  return ALLOWED_THEMES.includes(value as ReaderTheme)
}
