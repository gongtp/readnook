import { AUTO_SEGMENT_CHARS, MAX_CHAPTER_CHARS, PARSER_VERSION } from '@/config/app'
import type { ParsedBook, ParsedChapter } from '@/types/importer'
import type { AutoSplitReason } from '@/types/models'

const CHINESE_NUMBER = '0-9零〇○一二三四五六七八九十百千万亿两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟'
const CHAPTER_UNIT = '章回节節卷集部篇'
const TITLE_SEPARATOR = '[\\s:：·.、,，\\-—_]+'
const NUMBER = `[${CHINESE_NUMBER}]{1,12}`

// 带明确章节单位的标题允许直接接标题，如“第一章起源”。
const NUMBERED_CHAPTER = new RegExp(
  `^第\\s*${NUMBER}\\s*[${CHAPTER_UNIT}].*$`,
  'u',
)
const UNIT_FIRST_CHAPTER = new RegExp(
  `^[卷部篇章回节節集]\\s*${NUMBER}(?:${TITLE_SEPARATOR}.*|[^${CHINESE_NUMBER}\\s].*)?$`,
  'u',
)
const SPECIAL_CHAPTER = new RegExp(
  `^(?:序|前言|前记|前記|序章|序言|序幕|序曲|序篇|楔子|引子|引言|尾声|尾聲|终章|終章|终卷|終卷|终幕|終幕|结语|結語|后记|後記|后序|後序|跋|附录|附錄|番外(?:篇|章|卷)?(?:\\s*${NUMBER})?|外传|外傳)(?:${TITLE_SEPARATOR}.*)?$`,
  'u',
)
const ENGLISH_CHAPTER = /^(?:chapter|chap\.?|ch\.?|part|book|volume|vol\.?|section)\s+(?:\d{1,6}|[ivxlcdm]{1,12})(?=$|[\s:：.、,，\-—_])(?:[\s:：.、,，\-—_]+.*)?$/iu
const ENGLISH_SPECIAL_CHAPTER = /^(?:prologue|epilogue|preface|foreword|afterword|introduction)(?:[\s:：.\-—]+.*)?$/iu
// 纯编号缺少“章”等标记，要求有明确分隔符，句点后不能紧接数字，避免误认小数。
const NUMBER_ONLY_CHAPTER = new RegExp(
  `^(?:(?:[0-9]{1,6}|[${CHINESE_NUMBER.replace('0-9', '')}]{1,8})(?:[、:：]\\s*|[.](?![0-9])\\s*|\\s+[-—]\\s*)|[0-9]{1,6}\\s+)(?=\\S).+$`,
  'u',
)
const BRACKETED_NUMBER_CHAPTER = new RegExp(
  `^(?:【${NUMBER}】|\\[${NUMBER}\\]|\\(${NUMBER}\\))(?:${TITLE_SEPARATOR})?\\S.*$`,
  'u',
)

const MAX_TITLE_CHARS = 80

export function isChapterTitle(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_TITLE_CHARS) return false
  // 仅规范化用于匹配的副本，目录标题仍保留原文。
  let candidate = trimmed.normalize('NFKC')
  const wrappers = [['【', '】'], ['[', ']'], ['(', ')'], ['〔', '〕'], ['〈', '〉']]
  for (const [open, close] of wrappers) {
    if (open && close && candidate.startsWith(open) && candidate.endsWith(close)) {
      candidate = candidate.slice(open.length, -close.length).trim()
      break
    }
  }
  candidate = candidate.replace(/^正文(?:[\s:：\-—]+|(?=第))/, '')
  // 完整叙述句通常不是标题；宽松编号规则尤其容易误认正文。
  if (/[。；;]$/u.test(candidate)) return false
  return NUMBERED_CHAPTER.test(candidate)
    || UNIT_FIRST_CHAPTER.test(candidate)
    || SPECIAL_CHAPTER.test(candidate)
    || ENGLISH_CHAPTER.test(candidate)
    || ENGLISH_SPECIAL_CHAPTER.test(candidate)
    || NUMBER_ONLY_CHAPTER.test(candidate)
    || BRACKETED_NUMBER_CHAPTER.test(candidate)
}

function trimBoundaryNewlines(value: string): string {
  return value
    .replace(/^(?:[ \t]*\n)+/u, '')
    .replace(/(?:\n[ \t]*)+$/u, '')
}

function safeCutIndex(text: string, limit: number): number {
  let cut = Math.min(limit, text.length)
  const lastNewline = text.lastIndexOf('\n', cut - 1)
  if (lastNewline >= Math.floor(limit * 0.55)) {
    cut = lastNewline + 1
  }

  if (cut > 0 && cut < text.length) {
    const previous = text.charCodeAt(cut - 1)
    if (previous >= 0xd800 && previous <= 0xdbff) {
      cut -= 1
    }
  }

  return Math.max(cut, 1)
}

export function splitLongText(
  text: string,
  limit = AUTO_SEGMENT_CHARS,
): string[] {
  if (text.length <= limit) return [text]

  const parts: string[] = []
  let remaining = text
  while (remaining.length > limit) {
    const cut = safeCutIndex(remaining, limit)
    parts.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut)
  }
  if (remaining.length > 0) parts.push(remaining)
  return parts
}

interface Heading {
  start: number
  lineEnd: number
  contentStart: number
  title: string
}

interface ChapterDraft {
  title: string
  content: string
  autoSplitReason: AutoSplitReason | null
}

function scanHeadings(text: string): Heading[] {
  const headings: Heading[] = []
  const lines = text.split('\n')
  let cursor = 0

  for (const line of lines) {
    const lineStart = cursor
    const lineEnd = lineStart + line.length
    cursor = lineEnd + 1
    const title = line.trim()

    if (isChapterTitle(title)) {
      headings.push({
        start: lineStart,
        lineEnd,
        contentStart: Math.min(lineEnd + 1, text.length),
        title,
      })
    }
  }

  return headings
}

export function parseTxtChapters(
  rawText: string,
  autoSegmentChars = AUTO_SEGMENT_CHARS,
  maxChapterChars = MAX_CHAPTER_CHARS,
): ParsedBook {
  const text = rawText.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const warnings: string[] = []
  const drafts: ChapterDraft[] = []
  const headings = scanHeadings(text)
  let splitChapterCount = 0

  if (headings.length === 0) {
    const body = trimBoundaryNewlines(text)
    if (body.trim().length > 0) {
      const parts = splitLongText(body, autoSegmentChars)
      drafts.push(
        ...parts.map(
          (content, index): ChapterDraft => ({
            title: `正文 ${index + 1}`,
            content,
            autoSplitReason: 'no-headings',
          }),
        ),
      )
      warnings.push(
        `未识别到章节标题，已将正文按约 ${autoSegmentChars} 字自动分段。`,
      )
    }
  } else {
    const firstHeading = headings[0]
    if (firstHeading) {
      const frontMatter = trimBoundaryNewlines(text.slice(0, firstHeading.start))
      if (frontMatter.trim().length > 0) {
        const parts = splitLongText(frontMatter, maxChapterChars)
        drafts.push(
          ...parts.map(
            (content, index): ChapterDraft => ({
              title: index === 0 ? '开篇' : `开篇（续 ${index + 1}）`,
              content,
              autoSplitReason: parts.length > 1 ? 'front-matter' : null,
            }),
          ),
        )
        warnings.push('章节标题前的正文已保留为“开篇”。')
        if (parts.length > 1) {
          warnings.push('“开篇”内容过长，已自动分段。')
        }
      }
    }

    headings.forEach((heading, index) => {
      const nextHeading = headings[index + 1]
      const contentEnd = nextHeading ? nextHeading.start : text.length
      const content = trimBoundaryNewlines(
        text.slice(heading.contentStart, contentEnd),
      )
      const parts = splitLongText(content, maxChapterChars)
      if (parts.length > 1) splitChapterCount += 1

      drafts.push(
        ...parts.map(
          (part, partIndex): ChapterDraft => ({
            title:
              partIndex === 0
                ? heading.title
                : `${heading.title}（续 ${partIndex + 1}）`,
            content: part,
            autoSplitReason: parts.length > 1 ? 'long-chapter' : null,
          }),
        ),
      )
    })

    if (splitChapterCount > 0) {
      warnings.push(`有 ${splitChapterCount} 个超长章节已自动分段。`)
    }
  }

  let startChar = 0
  const chapters: ParsedChapter[] = drafts.map((draft, index) => {
    const chapter: ParsedChapter = {
      chapterKey: `ch_${String(index).padStart(4, '0')}`,
      order: index,
      title: draft.title,
      content: draft.content,
      startChar,
      charCount: draft.content.length,
      autoSplit: draft.autoSplitReason !== null,
      autoSplitReason: draft.autoSplitReason,
    }
    startChar += chapter.charCount
    return chapter
  })

  return {
    chapters,
    totalChars: startChar,
    warnings,
    parserVersion: PARSER_VERSION,
  }
}
