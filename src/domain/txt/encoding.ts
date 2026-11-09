import type {
  EncodingChoice,
  TextEncoding,
} from '@/types/models'
import { TxtError } from '@/domain/txt/errors'

export interface DecodeResult {
  text: string
  encoding: TextEncoding
  confidence: number
  uncertain: boolean
  warnings: string[]
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const
const BOM_UTF16_LE = [0xff, 0xfe] as const
const BOM_UTF16_BE = [0xfe, 0xff] as const

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function decodeWith(
  bytes: Uint8Array,
  encoding: TextEncoding,
  fatal: boolean,
): string {
  return new TextDecoder(encoding, { fatal }).decode(bytes)
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern)
  return matches?.length ?? 0
}

function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  )
}

export function scoreDecodedText(text: string): number {
  const total = Math.max(text.length, 1)
  const controls = countMatches(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g)
  const replacements = countMatches(text, /\uFFFD/g)
  const mojibake = countMatches(
    text,
    /(?:锟斤拷|ï»¿|Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â€[\u0080-\u00ff])/g,
  )
  const cjk = Array.from(text).reduce(
    (count, char) => count + (isCjkCodePoint(char.codePointAt(0) ?? 0) ? 1 : 0),
    0,
  )

  let score = 1
  score -= Math.min(0.65, (controls / total) * 18)
  score -= Math.min(0.5, (replacements / total) * 80)
  score -= Math.min(0.4, (mojibake / total) * 250)

  if (cjk / total > 0.06) {
    score += 0.02
  }

  return Math.max(0, Math.min(1, score))
}

function assertReadable(text: string, encoding: TextEncoding): void {
  if (text.trim().length === 0) {
    throw new TxtError('EMPTY_FILE', '文件为空，未找到可导入的正文。')
  }

  const controls = countMatches(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g)
  if (controls / text.length > 0.02) {
    throw new TxtError(
      'BINARY_FILE',
      '这个文件包含大量不可读字符，看起来不是纯文本。请确认文件为 UTF-8、GBK 或 GB18030 编码的 .txt。',
    )
  }

  const replacements = countMatches(text, /\uFFFD/g)
  if (replacements / text.length > 0.003) {
    throw new TxtError(
      'DECODE_FAILED',
      `使用 ${encoding.toUpperCase()} 解码后出现大量乱码，请尝试其他编码。`,
    )
  }
}

function hasNulBytes(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true
  }
  return false
}

function tryFatalDecode(
  bytes: Uint8Array,
  encoding: TextEncoding,
): string | null {
  try {
    return decodeWith(bytes, encoding, true)
  } catch {
    return null
  }
}

export function decodeTxt(
  bytes: Uint8Array,
  choice: EncodingChoice = 'auto',
): DecodeResult {
  if (bytes.length === 0) {
    throw new TxtError('EMPTY_FILE', '文件为空，未找到可导入的正文。')
  }

  if (startsWithBytes(bytes, BOM_UTF16_LE) || startsWithBytes(bytes, BOM_UTF16_BE)) {
    throw new TxtError(
      'UNSUPPORTED_UTF16',
      '暂不支持 UTF-16 文本，请先转换为 UTF-8、GBK 或 GB18030 后再导入。',
    )
  }

  if (hasNulBytes(bytes)) {
    throw new TxtError(
      'BINARY_FILE',
      '这个文件包含二进制数据，看起来不是可阅读的 TXT 文本。',
    )
  }

  const hasUtf8Bom = startsWithBytes(bytes, BOM_UTF8)
  const contentBytes = hasUtf8Bom ? bytes.subarray(BOM_UTF8.length) : bytes

  // A UTF-8 BOM is an unambiguous signal, so it wins over a manual choice.
  if (hasUtf8Bom) {
    const text = normalizeNewlines(decodeWith(contentBytes, 'utf-8', true))
    assertReadable(text, 'utf-8')
    return {
      text,
      encoding: 'utf-8',
      confidence: 1,
      uncertain: false,
      warnings: [],
    }
  }

  if (choice !== 'auto') {
    const decoded = tryFatalDecode(contentBytes, choice)
    if (decoded === null) {
      throw new TxtError(
        'DECODE_FAILED',
        `使用 ${choice.toUpperCase()} 无法解码此文件，请尝试其他编码。`,
      )
    }
    const text = normalizeNewlines(decoded)
    assertReadable(text, choice)
    return {
      text,
      encoding: choice,
      confidence: 1,
      uncertain: false,
      warnings: [],
    }
  }

  const utf8 = tryFatalDecode(contentBytes, 'utf-8')
  if (utf8 !== null) {
    const text = normalizeNewlines(utf8)
    assertReadable(text, 'utf-8')
    const score = scoreDecodedText(text)
    const uncertain = score < 0.8
    return {
      text,
      encoding: 'utf-8',
      confidence: score,
      uncertain,
      warnings: uncertain
        ? ['检测为 UTF-8，但文本中可能存在异常字符，请核对预览。']
        : [],
    }
  }

  const gb18030 = tryFatalDecode(contentBytes, 'gb18030')
  if (gb18030 === null) {
    throw new TxtError(
      'DECODE_FAILED',
      '无法将文件识别为 UTF-8、GBK 或 GB18030 文本。请核对文件来源或在其他编辑器中另存为 UTF-8 后重试。',
    )
  }

  const text = normalizeNewlines(gb18030)
  assertReadable(text, 'gb18030')
  const score = scoreDecodedText(text)
  const confidence = Math.min(0.9, 0.64 + score * 0.25)
  const uncertain = confidence < 0.82 || score < 0.72

  return {
    text,
    encoding: 'gb18030',
    confidence,
    uncertain,
    warnings: uncertain
      ? ['文件不是有效的 UTF-8，已按 GB18030/GBK 解码。请核对预览，必要时手动切换编码。']
      : ['文件不是有效的 UTF-8，已按 GB18030/GBK 解码。'],
  }
}
