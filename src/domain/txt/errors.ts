export type TxtErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_UTF16'
  | 'BINARY_FILE'
  | 'DECODE_FAILED'
  | 'NO_CHAPTERS'
  | 'UNKNOWN'

export class TxtError extends Error {
  readonly code: TxtErrorCode

  constructor(code: TxtErrorCode, message: string) {
    super(message)
    this.name = 'TxtError'
    this.code = code
  }
}

export function toTxtError(error: unknown): TxtError {
  if (error instanceof TxtError) return error
  if (error instanceof Error) {
    return new TxtError('UNKNOWN', error.message || '处理文本时发生未知错误。')
  }
  return new TxtError('UNKNOWN', '处理文本时发生未知错误。')
}
