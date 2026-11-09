import { PARSER_VERSION } from '@/config/app'
import { decodeTxt } from '@/domain/txt/encoding'
import { toTxtError, TxtError } from '@/domain/txt/errors'
import { parseTxtChapters } from '@/domain/txt/chapterParser'
import { createId } from '@/utils/id'
import { sha256Hex } from '@/utils/hash'
import type {
  TxtWorkerRequest,
  TxtWorkerResponse,
} from '@/types/importer'

interface Session {
  bytes: Uint8Array
  contentHash: string | null
}

const sessions = new Map<string, Session>()

function post(response: TxtWorkerResponse): void {
  self.postMessage(response)
}

function postFailure(requestId: string, error: unknown): void {
  const txtError = toTxtError(error)
  post({
    type: 'failure',
    requestId,
    code: txtError.code,
    message: txtError.message,
  })
}

function makePreview(text: string): string {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim()
  return normalized.length > 700 ? `${normalized.slice(0, 700)}…` : normalized
}

async function handleAnalyze(
  request: Extract<TxtWorkerRequest, { type: 'analyze' }>,
): Promise<void> {
  let session = request.token ? sessions.get(request.token) : undefined
  if (!session) {
    const fileBytes = new Uint8Array(await request.file.arrayBuffer())
    session = { bytes: fileBytes, contentHash: null }
  }

  if (!session.contentHash) {
    session.contentHash = await sha256Hex(session.bytes)
  }

  const token = request.token ?? createId()
  sessions.set(token, session)

  const decoded = decodeTxt(session.bytes, request.encoding)
  post({
    type: 'analyze-success',
    requestId: request.requestId,
    analysis: {
      token,
      detectedEncoding: decoded.encoding,
      encodingConfidence: Number(decoded.confidence.toFixed(2)),
      encodingUncertain: decoded.uncertain,
      preview: makePreview(decoded.text),
      decodedChars: decoded.text.length,
      contentHash: session.contentHash,
      byteSize: session.bytes.byteLength,
      warnings: decoded.warnings,
    },
  })
}

async function handleParse(
  request: Extract<TxtWorkerRequest, { type: 'parse' }>,
): Promise<void> {
  const session = sessions.get(request.token)
  if (!session) {
    throw new TxtError(
      'UNKNOWN',
      '导入会话已过期，请重新选择文件后再试。',
    )
  }

  const decoded = decodeTxt(session.bytes, request.encoding)
  const parsed = parseTxtChapters(decoded.text)
  if (parsed.chapters.length === 0) {
    throw new TxtError('NO_CHAPTERS', '未从文件中解析出可阅读的章节。')
  }

  post({
    type: 'parse-success',
    requestId: request.requestId,
    token: request.token,
    book: {
      chapters: parsed.chapters,
      totalChars: parsed.totalChars,
      warnings: [...decoded.warnings, ...parsed.warnings],
      parserVersion: PARSER_VERSION,
    },
  })
}

self.addEventListener('message', (event: MessageEvent<TxtWorkerRequest>) => {
  const request = event.data
  void (async () => {
    try {
      switch (request.type) {
        case 'analyze':
          await handleAnalyze(request)
          break
        case 'parse':
          await handleParse(request)
          break
      }
    } catch (error) {
      postFailure(request.requestId, error)
    }
  })()
})
