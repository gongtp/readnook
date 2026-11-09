import type {
  AutoSplitReason,
  EncodingChoice,
  TextEncoding,
} from '@/types/models'

export interface ParsedChapter {
  chapterKey: string
  order: number
  title: string
  content: string
  startChar: number
  charCount: number
  autoSplit: boolean
  autoSplitReason: AutoSplitReason | null
}

export interface ParsedBook {
  chapters: ParsedChapter[]
  totalChars: number
  warnings: string[]
  parserVersion: number
}

export interface TxtAnalysis {
  token: string
  detectedEncoding: TextEncoding
  encodingConfidence: number
  encodingUncertain: boolean
  preview: string
  decodedChars: number
  contentHash: string
  byteSize: number
  warnings: string[]
}

export interface AnalyzeRequest {
  type: 'analyze'
  requestId: string
  file: File
  encoding: EncodingChoice
  token?: string
}

export interface ParseRequest {
  type: 'parse'
  requestId: string
  token: string
  encoding: TextEncoding
}

export type TxtWorkerRequest = AnalyzeRequest | ParseRequest

export interface TxtAnalyzeSuccess {
  type: 'analyze-success'
  requestId: string
  analysis: TxtAnalysis
}

export interface TxtParseSuccess {
  type: 'parse-success'
  requestId: string
  token: string
  book: ParsedBook
}

export interface TxtWorkerFailure {
  type: 'failure'
  requestId: string
  code: string
  message: string
}

export type TxtWorkerResponse =
  | TxtAnalyzeSuccess
  | TxtParseSuccess
  | TxtWorkerFailure
