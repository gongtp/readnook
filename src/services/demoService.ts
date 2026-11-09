import {
  deleteBookCascade,
  getBookByContentHash,
  listBooks,
  saveProgress,
} from '@/db/libraryRepository'
import { buildReadingProgress } from '@/domain/progress'
import { parseTxtChapters } from '@/domain/txt/chapterParser'
import { saveImportedBook } from '@/services/import/importBook'
import { sha256Hex } from '@/utils/hash'

const DEMO_SOURCE_PREFIX = 'demo-'

const DEMO_TITLES = [
  '雾港来信',
  '北窗夜航',
  '山海食堂',
  '星图旧梦',
  '纸上潮汐',
  '灯塔与鲸',
  '长街灯火',
  '风从旧巷来',
  '云上邮局',
  '第七个夏天',
  '月落青瓦',
  '河岸书店',
  '雪落无声',
  '南方慢车',
  '深山有灯',
  '时间的褶皱',
  '候鸟旅馆',
  '半城烟雨',
  '旧唱片',
  '海边的房间',
  '夜行列车',
  '花园与钟',
  '远方来客',
  '微光之城',
  '沉默的河',
  '白昼梦游',
  '风铃小镇',
  '岛屿书简',
  '落日之前',
  '春夜未眠',
] as const

const PLACES = [
  '雾港',
  '北岸',
  '山谷',
  '旧城',
  '海边',
  '河湾',
  '南站',
  '小镇',
] as const

const OPENERS = [
  '那天清晨，潮水退得很远，露出了一条平时看不见的石板路。',
  '风从窗缝里钻进来，把桌上的纸吹得沙沙作响。',
  '街角的灯比往常亮得早，像是有人提前点亮了夜色。',
  '雨停之后，空气里有一股潮湿的木头味。',
  '她沿着河岸慢慢走，脚下的石子发出细小的声响。',
  '午后的阳光落在旧墙上，把影子拉得很长。',
] as const

const MIDDLES = [
  '没有人知道这条路通向哪里，但每个人都愿意往前走一段。',
  '他忽然想起很多年前的一个下午，那时一切都还没有发生。',
  '远处传来钟声，隔着雾，听起来像另一个人的心跳。',
  '店门半掩着，里面亮着一盏昏黄的灯，桌上放着两只杯子。',
  '他们谁也没有先开口，只是安静地听着窗外的水声。',
  '有些答案并不会立刻出现，它们藏在更慢的时间里。',
] as const

const ENDINGS = [
  '等到灯熄的时候，她终于明白，有些告别其实早有预兆。',
  '他把信折好放进口袋，转身走进还没有散尽的晨雾。',
  '第二天，河面恢复了平静，像什么都没有发生过一样。',
  '故事到这里并没有结束，只是换了一个地方继续。',
  '很多年后，他仍然记得那盏灯和灯下的人。',
  '她抬起头，看见云层裂开一道缝，光正好落在回家的路上。',
] as const

function buildDemoText(title: string, index: number): string {
  const place = PLACES[index % PLACES.length] ?? '小镇'
  const opener = OPENERS[index % OPENERS.length] ?? OPENERS[0]
  const middle = MIDDLES[index % MIDDLES.length] ?? MIDDLES[0]
  const ending = ENDINGS[index % ENDINGS.length] ?? ENDINGS[0]

  return [
    '第一章 出发',
    `${opener}这是${place}最普通的一天，也是${title}开始的地方。`,
    '',
    `${middle}街边的人来来往往，谁也没有注意到，有一封信正被风推着，慢慢滑向门槛。`,
    '',
    '第二章 途中',
    `去${place}的路比想象中更长。车窗外的景色一段一段向后退，像被人翻动的旧照片。`,
    '',
    `他想起${title}里的那些句子，忽然觉得它们并不只是写给别人的。${middle}`,
    `傍晚时，车停在一个没有名字的小站。站台上只有一盏灯，灯下站着一个等了很久的人。`,
    '',
    '第三章 归处',
    `${ending}这是${title}的结尾，也是下一次出发的起点。`,
    '',
    `后来，${place}的人偶尔还会提起那段时间。说不上传奇，却足够让每个听见的人安静一会儿。`,
  ].join('\n')
}

export interface DemoSeedResult {
  added: number
  skipped: number
  total: number
}

export async function seedDemoLibrary(
  onProgress?: (done: number, total: number) => void,
): Promise<DemoSeedResult> {
  let added = 0
  let skipped = 0

  for (const [index, title] of DEMO_TITLES.entries()) {
    const text = buildDemoText(title, index)
    const bytes = new TextEncoder().encode(text)
    const contentHash = await sha256Hex(bytes)
    if (await getBookByContentHash(contentHash)) {
      skipped += 1
      onProgress?.(index + 1, DEMO_TITLES.length)
      continue
    }

    const file = new File(
      [text],
      `${DEMO_SOURCE_PREFIX}${String(index + 1).padStart(2, '0')}.txt`,
      { type: 'text/plain' },
    )
    const parsed = parseTxtChapters(text)
    const book = await saveImportedBook({
      file,
      title,
      parsed,
      contentHash,
      encoding: 'utf-8',
    })

    if (index % 5 === 4) {
      const lastIndex = parsed.chapters.length - 1
      const lastChapter = parsed.chapters[lastIndex]
      if (lastChapter) {
        await saveProgress(
          buildReadingProgress(
            book.id,
            parsed.chapters,
            lastIndex,
            lastChapter.charCount,
            parsed.totalChars,
          ),
        )
      }
    } else if (index % 3 === 0) {
      const chapterIndex = parsed.chapters.length > 1 ? 1 : 0
      const chapter = parsed.chapters[chapterIndex]
      if (chapter) {
        await saveProgress(
          buildReadingProgress(
            book.id,
            parsed.chapters,
            chapterIndex,
            Math.floor(chapter.charCount * 0.46),
            parsed.totalChars,
          ),
        )
      }
    }

    added += 1
    onProgress?.(index + 1, DEMO_TITLES.length)
  }

  return { added, skipped, total: DEMO_TITLES.length }
}

export async function clearDemoLibrary(): Promise<number> {
  const books = await listBooks()
  const demoBooks = books.filter((book) =>
    book.sourceFileName.startsWith(DEMO_SOURCE_PREFIX),
  )
  for (const book of demoBooks) {
    await deleteBookCascade(book.id)
  }
  return demoBooks.length
}
