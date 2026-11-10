import { describe, expect, it } from 'vitest'
import {
  isChapterTitle,
  parseTxtChapters,
  splitLongText,
} from '@/domain/txt/chapterParser'

describe('isChapterTitle', () => {
  it('recognizes common Chinese chapter headings', () => {
    const headings = [
      '第一章 山雨',
      '第1章 开始',
      '第十二回 风起',
      '第三节：归途',
      '第两百零五章',
      '序章',
      '楔子',
      '番外一',
      '后记 写于雨夜',
    ]
    for (const heading of headings) {
      expect(isChapterTitle(heading), heading).toBe(true)
    }
  })

  it('ignores normal prose, long lines and headings inside sentences', () => {
    const nonHeadings = [
      '他翻开第一章，看到一句话。',
      '今天天气很好。',
      `第一章 ${'很长的标题'.repeat(30)}`,
      '',
      '第',
      '番外篇外传故事',
    ]
    for (const line of nonHeadings) {
      expect(isChapterTitle(line), line).toBe(false)
    }
  })

  it.each([
    '　　第一章起源', '第 １２ 章　起源', '第壹佰零壹章重逢',
    '第兩百節 歸途', '卷一 起源', '卷一重逢', '第二卷 第一章 起源',
    '正文 第一章起源', '正文：第1章 起源', '正文第一章起源',
    '【第一章 起源】', '（第一章起源）', '[Chapter 1: Origin]',
    '1. 起源', '１．起源', '001 起源', '1、起源', '一、起源', '十二：归途',
    '1 — 起源', '【001】起源', '（一）起源', '[12] 起源',
    'Chapter 1', 'CHAPTER 12: Origin', 'Chapter IV The Beginning',
    'Ch. 3 - Return', 'Part II', 'Book 1: Origin', 'Volume 2 Return', 'Vol. III',
    'Section 1: Origin', 'Prologue', 'Epilogue: Home', 'Preface', 'Afterword',
    '前言', '序幕 起源', '序', '後記', '尾聲', '附录：人物表',
    '番外篇二 重逢', '外传 起源', '番外1', '　　番外2', '番外１', '番外1 重逢',
  ])('recognizes additional heading format: %s', (heading) => {
    expect(isChapterTitle(heading)).toBe(true)
  })

  it.each([
    '第一章讲述了他的经历。', '他读到了 Chapter 1', 'Chapter One day',
    'Chapter introduction', 'Chapter 1st encounter', '1.23', '3.14159 圆周率',
    '一 个普通人', '2026年11月10日', '123', '后记得关门', '序幕拉开了。',
    '【普通正文】', '正文只是一个普通句子',
  ])('does not treat prose or numeric values as headings: %s', (line) => {
    expect(isChapterTitle(line)).toBe(false)
  })
})

describe('parseTxtChapters', () => {
  it('keeps numbered extras separate from the main chapters', () => {
    const parsed = parseTxtChapters([
      '第一章起源', '正文内容',
      '第二章恶魔', '正文结尾',
      '　　番外1', '番外第一段', '番外第二段',
      '番外2', '另一篇番外',
    ].join('\n'))

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章起源', '第二章恶魔', '番外1', '番外2',
    ])
    expect(parsed.chapters.map((chapter) => chapter.content)).toEqual([
      '正文内容', '正文结尾', '番外第一段\n番外第二段', '另一篇番外',
    ])
    expect(new Set(parsed.chapters.map((chapter) => chapter.chapterKey)).size).toBe(4)
    expect(parsed.chapters.every((chapter) => !chapter.autoSplit)).toBe(true)
  })

  it('splits mixed heading styles and preserves the original titles', () => {
    const titles = ['　　第一章起源', '【第二章 重逢】', '3. 归途', 'Chapter IV: Home', '後記']
    const text = titles.map((title, index) => `${title}\n内容${index}`).join('\n\n')
    const parsed = parseTxtChapters(text)
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(titles.map((title) => title.trim()))
    expect(parsed.chapters.map((chapter) => chapter.content)).toEqual(titles.map((_, index) => `内容${index}`))
    expect(parsed.chapters.every((chapter) => !chapter.autoSplit)).toBe(true)
  })

  it('keeps front matter and splits at chapter headings', () => {
    const text = [
      '书名：山雨',
      '作者：某人',
      '',
      '第一章 山雨',
      '夜色像浸了水的纸。',
      '',
      '第二章 灯火',
      '他推开窗。',
      '看见了灯。',
    ].join('\n')

    const parsed = parseTxtChapters(text, 8_000)
    expect(parsed.chapters).toHaveLength(3)
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '开篇',
      '第一章 山雨',
      '第二章 灯火',
    ])
    expect(parsed.chapters[0]?.content).toBe('书名：山雨\n作者：某人')
    expect(parsed.chapters[1]?.content).toBe('夜色像浸了水的纸。')
    expect(parsed.chapters[2]?.content).toBe('他推开窗。\n看见了灯。')
    expect(parsed.chapters.map((chapter) => chapter.chapterKey)).toEqual([
      'ch_0000',
      'ch_0001',
      'ch_0002',
    ])
    expect(parsed.chapters.map((chapter) => chapter.order)).toEqual([0, 1, 2])
    expect(parsed.chapters.map((chapter) => chapter.startChar)).toEqual([
      0,
      parsed.chapters[0]?.charCount,
      (parsed.chapters[0]?.charCount ?? 0) +
        (parsed.chapters[1]?.charCount ?? 0),
    ])
    expect(parsed.totalChars).toBe(
      parsed.chapters.reduce((sum, chapter) => sum + chapter.charCount, 0),
    )
    expect(parsed.warnings).toContain('章节标题前的正文已保留为“开篇”。')
    expect(parsed.parserVersion).toBeGreaterThan(0)
  })

  it('creates auto-split chapters when no headings exist', () => {
    const text = '甲'.repeat(25)
    const parsed = parseTxtChapters(text, 10)
    expect(parsed.chapters).toHaveLength(3)
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '正文 1',
      '正文 2',
      '正文 3',
    ])
    expect(parsed.chapters.map((chapter) => chapter.content.length)).toEqual([
      10, 10, 5,
    ])
    expect(
      parsed.chapters.every(
        (chapter) =>
          chapter.autoSplit && chapter.autoSplitReason === 'no-headings',
      ),
    ).toBe(true)
    expect(parsed.warnings[0]).toContain('自动分段')
  })

  it('keeps a long chapter intact when headings exist', () => {
    const body = `${'甲'.repeat(12)}\n${'乙'.repeat(12)}\n${'丙'.repeat(6)}`
    const parsed = parseTxtChapters(`第一章 长夜\n${body}\n第二章 天明\n短`, 10)
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 长夜',
      '第二章 天明',
    ])
    expect(parsed.chapters[0]?.content).toBe(body)
    expect(parsed.chapters[1]?.content).toBe('短')
    expect(parsed.chapters.every((chapter) => !chapter.autoSplit)).toBe(true)
    expect(parsed.chapters[0]?.autoSplitReason).toBeNull()
    expect(parsed.warnings.join('')).not.toContain('超长章节')
    expect(parsed.chapters.map((chapter) => chapter.content).join('')).toBe(
      `${body}短`,
    )
  })

  it('only splits a chapter beyond the safety cap', () => {
    const body = '甲'.repeat(25)
    const parsed = parseTxtChapters(`第一章 长夜\n${body}`, 8_000, 10)
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '第一章 长夜',
      '第一章 长夜（续 2）',
      '第一章 长夜（续 3）',
    ])
    expect(parsed.chapters[0]?.autoSplitReason).toBe('long-chapter')
    expect(parsed.chapters.every((chapter) => chapter.autoSplit)).toBe(true)
    expect(parsed.warnings.join('')).toContain('1 个超长章节')
    expect(parsed.chapters.map((chapter) => chapter.content).join('')).toBe(body)
  })

  it('keeps long front matter as a single opening chapter', () => {
    const parsed = parseTxtChapters(
      `${'序'.repeat(15)}\n第一章 开始\n正文`,
      10,
    )
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      '开篇',
      '第一章 开始',
    ])
    expect(parsed.chapters[0]?.content).toBe('序'.repeat(15))
    expect(parsed.chapters[0]?.autoSplitReason).toBeNull()
  })

  it('normalizes CRLF and a leading BOM before parsing', () => {
    const parsed = parseTxtChapters(
      '\uFEFF第一章 雨\r\n第一行\r\n\r\n第二章 晴\r\n第二行',
    )
    expect(parsed.chapters).toHaveLength(2)
    expect(parsed.chapters[0]?.title).toBe('第一章 雨')
    expect(parsed.chapters[0]?.content).toBe('第一行')
    expect(parsed.chapters[1]?.content).toBe('第二行')
  })

  it('returns no chapters for blank input', () => {
    const parsed = parseTxtChapters(' \n\n\t\n')
    expect(parsed.chapters).toEqual([])
    expect(parsed.totalChars).toBe(0)
    expect(parsed.warnings).toEqual([])
  })
})

describe('splitLongText', () => {
  it('returns the original value at or below the limit', () => {
    expect(splitLongText('abc', 3)).toEqual(['abc'])
    expect(splitLongText('', 3)).toEqual([''])
  })

  it('prefers a newline near the limit', () => {
    const text = `${'甲'.repeat(8)}\n${'乙'.repeat(8)}`
    const parts = splitLongText(text, 10)
    expect(parts[0]).toBe(`${'甲'.repeat(8)}\n`)
    expect(parts.join('')).toBe(text)
  })

  it('never splits a surrogate pair', () => {
    const text = '😀'.repeat(10)
    const parts = splitLongText(text, 5)
    for (const part of parts) {
      expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false)
      expect(/^[\uDC00-\uDFFF]/.test(part)).toBe(false)
    }
    expect(parts.join('')).toBe(text)
  })
})
