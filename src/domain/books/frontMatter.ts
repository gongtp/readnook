import type { AutoSplitReason } from '@/types/models'

interface FrontMatterCandidate {
  title: string
  autoSplitReason?: AutoSplitReason | null
}

const FRONT_MATTER_TITLE = /^开篇(?:（续 \d+）)?$/

/**
 * 「开篇」是解析器把首个章节标题之前的内容收拢成的前置章节，
 * 它属于书籍信息（书名、作者、简介），不该占用章节序号。
 */
export function isFrontMatterChapter(chapter: FrontMatterCandidate): boolean {
  if (chapter.autoSplitReason === 'front-matter') return true
  return FRONT_MATTER_TITLE.test(chapter.title.trim())
}

/** 前置章节总是排在最前面，这里只数连续的一段。 */
export function countFrontMatterChapters(
  chapters: readonly FrontMatterCandidate[],
): number {
  let count = 0
  for (const chapter of chapters) {
    if (!isFrontMatterChapter(chapter)) break
    count += 1
  }
  return count
}

/** 章节在正文中的显示序号（从 1 开始）；前置章节返回 null。 */
export function displayChapterNumber(
  order: number,
  frontMatterCount: number,
): number | null {
  const number = order - frontMatterCount + 1
  return number >= 1 ? number : null
}
