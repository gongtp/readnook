import { createId } from '@/utils/id'
import type {
  AnalyzeRequest,
  ParseRequest,
  ParsedBook,
  TxtAnalysis,
  TxtWorkerResponse,
} from '@/types/importer'
import type { EncodingChoice, TextEncoding } from '@/types/models'

type OutgoingRequest =
  | Omit<AnalyzeRequest, 'requestId'>
  | Omit<ParseRequest, 'requestId'>

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export class ImportWorkerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ImportWorkerError'
    this.code = code
  }
}

export class TxtWorkerClient {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingRequest>()

  private ensureWorker(): Worker {
    if (this.worker) return this.worker

    const worker = new Worker(
      new URL('../../workers/txt.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.addEventListener('message', (event: MessageEvent<TxtWorkerResponse>) => {
      this.handleMessage(event.data)
    })
    worker.addEventListener('error', (event) => {
      this.rejectAll(
        new ImportWorkerError(
          'WORKER_ERROR',
          event.message || '文本处理线程异常退出，请重试。',
        ),
      )
    })
    this.worker = worker
    return worker
  }

  private handleMessage(response: TxtWorkerResponse): void {
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)

    if (response.type === 'failure') {
      pending.reject(new ImportWorkerError(response.code, response.message))
      return
    }
    if (response.type === 'analyze-success') {
      pending.resolve(response.analysis)
      return
    }
    if (response.type === 'parse-success') {
      pending.resolve(response.book)
      return
    }
    pending.resolve(undefined)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }

  private send<T>(request: OutgoingRequest): Promise<T> {
    const worker = this.ensureWorker()
    const requestId = createId()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      worker.postMessage({ ...request, requestId })
    })
  }

  analyze(
    file: File,
    encoding: EncodingChoice = 'auto',
    token?: string,
  ): Promise<TxtAnalysis> {
    return this.send<TxtAnalysis>({
      type: 'analyze',
      file,
      encoding,
      ...(token ? { token } : {}),
    })
  }

  parse(token: string, encoding: TextEncoding): Promise<ParsedBook> {
    return this.send<ParsedBook>({
      type: 'parse',
      token,
      encoding,
    })
  }

  dispose(): void {
    if (!this.worker) return
    this.worker.terminate()
    this.worker = null
    this.rejectAll(new ImportWorkerError('WORKER_DISPOSED', '导入已取消。'))
  }
}
