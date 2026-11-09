import { MAX_TXT_BYTES } from '@/config/app'
import { TxtError } from '@/domain/txt/errors'
import { TxtWorkerClient } from '@/services/import/txtWorkerClient'
import type { ParsedBook, TxtAnalysis } from '@/types/importer'
import type {
  BookFormat,
  EncodingChoice,
  TextEncoding,
} from '@/types/models'

export interface ImportFormatSession {
  analyze(encoding?: EncodingChoice): Promise<TxtAnalysis>
  parse(token: string, encoding: TextEncoding): Promise<ParsedBook>
  dispose(): void
}

export interface BookFormatAdapter {
  readonly format: BookFormat
  readonly extensions: readonly string[]
  readonly maxBytes: number
  matches(file: File): boolean
  createSession(file: File): ImportFormatSession
}

class TxtImportSession implements ImportFormatSession {
  private readonly client = new TxtWorkerClient()
  private readonly file: File
  private token: string | null = null

  constructor(file: File) {
    this.file = file
  }

  async analyze(encoding: EncodingChoice = 'auto'): Promise<TxtAnalysis> {
    const analysis = await this.client.analyze(
      this.file,
      encoding,
      this.token ?? undefined,
    )
    this.token = analysis.token
    return analysis
  }

  parse(token: string, encoding: TextEncoding): Promise<ParsedBook> {
    return this.client.parse(token, encoding)
  }

  dispose(): void {
    this.client.dispose()
  }
}

export const txtFormatAdapter: BookFormatAdapter = {
  format: 'txt',
  extensions: ['.txt'],
  maxBytes: MAX_TXT_BYTES,
  matches(file: File): boolean {
    return file.name.toLowerCase().endsWith('.txt')
  },
  createSession(file: File): ImportFormatSession {
    if (!this.matches(file)) {
      throw new TxtError('UNKNOWN', '目前仅支持 .txt 格式的小说。')
    }
    if (file.size > this.maxBytes) {
      throw new TxtError(
        'FILE_TOO_LARGE',
        `文件超过 ${Math.floor(this.maxBytes / 1024 / 1024)} MB 上限。请先拆分小说或转换为更小的 TXT 文件。`,
      )
    }
    return new TxtImportSession(file)
  },
}
