import { describe, expect, it } from 'vitest'
import {
  decodeTxt,
  scoreDecodedText,
} from '@/domain/txt/encoding'
import { TxtError } from '@/domain/txt/errors'

const SAMPLE = '第一章 山雨\n夜色像浸了水的纸。\n\n第二章 灯火\n他推开窗，看见远处的灯。\n'

// Node's TextDecoder produces GBK bytes for this fixture; base64 keeps the
// repository free of binary files and avoids encoding surprises on Windows.
const GBK_BASE64 =
  'tdrSu9XCIMm90+oK0rnJq8/xvf7By8uutcTWvaGjCgq12rb+1cIgtca78ArL+83Gv6q0sKOsv7S8+9S2tKa1xLXGoaMK'

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function expectTxtError(run: () => unknown, code: string): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(TxtError)
    expect((error as TxtError).code).toBe(code)
    return
  }
  throw new Error(`expected TxtError ${code}`)
}

describe('decodeTxt', () => {
  it('decodes UTF-8 without BOM and normalizes CRLF', () => {
    const result = decodeTxt(utf8(SAMPLE.replace(/\n/g, '\r\n')))
    expect(result.encoding).toBe('utf-8')
    expect(result.text).toBe(SAMPLE)
    expect(result.uncertain).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('strips a UTF-8 BOM and forces UTF-8 when present', () => {
    const result = decodeTxt(
      concat(Uint8Array.from([0xef, 0xbb, 0xbf]), utf8('第一章')),
      'gb18030',
    )
    expect(result.encoding).toBe('utf-8')
    expect(result.text).toBe('第一章')
    expect(result.text.includes('\uFEFF')).toBe(false)
  })

  it('auto-detects GBK content as GB18030', () => {
    const result = decodeTxt(fromBase64(GBK_BASE64))
    expect(result.encoding).toBe('gb18030')
    expect(result.text).toBe(SAMPLE)
    expect(result.confidence).toBeGreaterThan(0.6)
    expect(result.warnings.join('').includes('GB18030')).toBe(true)
  })

  it('honors an explicit GBK choice', () => {
    const result = decodeTxt(fromBase64(GBK_BASE64), 'gbk')
    expect(result.encoding).toBe('gbk')
    expect(result.text).toBe(SAMPLE)
    expect(result.confidence).toBe(1)
    expect(result.uncertain).toBe(false)
  })

  it('rejects GBK bytes when UTF-8 is explicitly selected', () => {
    expectTxtError(
      () => decodeTxt(fromBase64(GBK_BASE64), 'utf-8'),
      'DECODE_FAILED',
    )
  })

  it('rejects UTF-16 BOMs instead of importing unreadable text', () => {
    expectTxtError(
      () => decodeTxt(Uint8Array.from([0xff, 0xfe, 0x41, 0x00])),
      'UNSUPPORTED_UTF16',
    )
    expectTxtError(
      () => decodeTxt(Uint8Array.from([0xfe, 0xff, 0x00, 0x41])),
      'UNSUPPORTED_UTF16',
    )
  })

  it('rejects binary data and empty files', () => {
    expectTxtError(() => decodeTxt(new Uint8Array()), 'EMPTY_FILE')
    expectTxtError(
      () => decodeTxt(Uint8Array.from([0x00, 0x01, 0x02, 0x03])),
      'BINARY_FILE',
    )
  })

  it('rejects whitespace-only files', () => {
    expectTxtError(() => decodeTxt(utf8('  \n\t\n  ')), 'EMPTY_FILE')
  })
})

describe('scoreDecodedText', () => {
  it('scores readable Chinese higher than replacement-filled text', () => {
    const readable = scoreDecodedText(SAMPLE)
    const broken = scoreDecodedText('\uFFFD'.repeat(40) + 'abc')
    expect(readable).toBeGreaterThan(0.8)
    expect(broken).toBeLessThan(readable)
  })

  it('penalizes control characters and mojibake', () => {
    expect(scoreDecodedText('\u0001'.repeat(50))).toBeLessThan(0.5)
    expect(scoreDecodedText('ï»¿锟斤拷'.repeat(10))).toBeLessThan(0.8)
  })
})
