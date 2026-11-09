import { AUTO_SEGMENT_CHARS, PARSER_VERSION } from '@/config/app'
import type { ParsedBook, ParsedChapter } from '@/types/importer'
import type { AutoSplitReason } from '@/types/models'

const CHINESE_NUMBER = '0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟'
const CHAPTER_UNIT = '章回节卷集部篇'
const TITLE_SEPARATOR = '[\\s:：·.、\\-—]+'

const NUMBERED_CHAPTER = new RegExp(
  `^第\\s*[${CHINESE_NUMBER}]{1,12}\\s*[${CHAPTER_UNIT}](?:${TITLE_SEPARATOR}.*)?$`,
  'u',
)
const SPECIAL_CHAPTER = new RegExp(
  `^(?:序章|序言|楔子|引子|尾声|终章|后记|番外(?:篇)?(?:\\s*[${CHINESE_NUMBER}]{1,8})?)(?:${TITLE_SEPARATOR}.*)?$`,
  'u',
)

const MAX_TITLE_CHARS = 80

export function isChapterTitle(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_TITLE_CHARS) return false
  return NUMBERED_CHAPTER.test(trimmed) || SPECIAL_CHAPTER.test(trimmed)
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
        const parts = splitLongText(frontMatter, autoSegmentChars)
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
      }
    }

    headings.forEach((heading, index) => {
      const nextHeading = headings[index + 1]
      const contentEnd = nextHeading ? nextHeading.start : text.length
      const content = trimBoundaryNewlines(
        text.slice(heading.contentStart, contentEnd),
      )
      const parts = splitLongText(content, autoSegmentChars)
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
