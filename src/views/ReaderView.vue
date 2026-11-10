<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import ChapterPageContent from '@/components/ChapterPageContent.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import ReaderSettingsPanel from '@/components/ReaderSettingsPanel.vue'
import {
  addBookmark,
  deleteBookmark,
  getBook,
  getChapterContent,
  getProgress,
  listBookmarks,
  listChapters,
  touchBookReadTime,
} from '@/db/libraryRepository'
import {
  calculateBookProgress,
  calculateChapterProgress,
  clampCharOffset,
  resolveResumeLocation,
  toProgressPercent,
} from '@/domain/progress'
import {
  countFrontMatterChapters,
  displayChapterNumber,
  isFrontMatterChapter,
} from '@/domain/books/frontMatter'
import { flushReadingProgress, scheduleProgress } from '@/services/readingProgress'
import { useReaderSettingsStore } from '@/stores/readerSettings'
import { useToastStore } from '@/stores/toast'
import type {
  Book,
  Bookmark,
  ChapterMeta,
  ReadingProgress,
} from '@/types/models'
import { countPages, offsetOfPage, pageOfOffset } from '@/utils/domPosition'
import { createId } from '@/utils/id'
import { formatRelativeTime } from '@/utils/format'
import { getErrorMessage } from '@/utils/errors'
import { pageTurnDuration, resistPageBoundary, resolvePageTurn } from '@/domain/pageTurn'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const settingsStore = useReaderSettingsStore()

const book = ref<Book | null>(null)
const chapters = ref<ChapterMeta[]>([])
const currentChapter = ref<ChapterMeta | null>(null)
const currentContent = ref('')
const bookmarks = ref<Bookmark[]>([])
const savedProgress = ref<ReadingProgress | null>(null)
const loading = ref(true)
const chapterLoading = ref(false)
const error = ref('')
const lastKnownOffset = ref(0)
const currentChapterProgress = ref(0)
const currentBookProgress = ref(0)
const tocOpen = ref(false)
const tocQuery = ref('')
const bookmarksOpen = ref(false)
const settingsOpen = ref(false)

const pagesRef = ref<HTMLElement | null>(null)
const articleRef = ref<HTMLElement | null>(null)
const chapterTextRef = computed(() => articleRef.value?.querySelector<HTMLElement>('.chapter-text'))
const tocListRef = ref<HTMLElement | null>(null)

const pageIndex = ref(0)
const pageCount = ref(1)
const pageWidth = ref(0)
const snapping = ref(true)
const layoutReady = ref(false)
const chapterSwapping = ref(false)
/** 跟手翻页时手指带来的额外位移（px，左负右正）。 */
const dragOffset = ref(0)
const motionDuration = ref(240)

/**
 * 相邻两页之间留一条空白，跟手翻页时两页不会贴成一行字。
 * 取两倍的页边距，正好等于“两页各自的内边距”。
 */
const pageGutter = computed(() => Math.max(0, settingsStore.settings.pageMargin * 2))
/** 一页占的横向距离 = 页宽 + 页间留白。 */
const pageStride = computed(() => pageWidth.value + pageGutter.value)

let reflowTimer: ReturnType<typeof setTimeout> | null = null
let chapterSwapTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
let loadSerial = 0
let touchStartX = 0
let touchStartY = 0
let touchStartAt = 0
let pagesTouchActive = false
let touchDuringChapterLoad = false
let lastFlipAt = 0
let dragAxis: 'none' | 'horizontal' | 'vertical' = 'none'
let dragLastX = 0
let dragLastAt = 0
let dragVelocity = 0
let dragPeak = 0
let dragOriginOffset = 0
let pageSettling = false
let settleTimer: ReturnType<typeof setTimeout> | null = null
let queuedTurn: -1 | 1 | null = null

const articleStyle = computed(() => ({
  transform: `translateX(${-pageIndex.value * pageStride.value + dragOffset.value}px)`,
  columnWidth: pageWidth.value > 0 ? `${pageWidth.value}px` : undefined,
  columnGap: `${pageGutter.value}px`,
}))

const currentBookPercent = computed(() => toProgressPercent(currentBookProgress.value))
const currentChapterPercent = computed(() =>
  toProgressPercent(currentChapterProgress.value),
)
const canGoPrevious = computed(() => {
  const order = currentChapter.value?.order ?? 0
  return order > 0
})
const canGoNext = computed(() => {
  const order = currentChapter.value?.order ?? 0
  return order < chapters.value.length - 1
})
function adjacentPage(direction: -1 | 1) {
  const target = computed(() => {
    const chapter = currentChapter.value
    const nearEdge = direction < 0 ? pageIndex.value <= 1 : pageIndex.value >= pageCount.value - 2
    return chapter && nearEdge ? chapters.value[chapter.order + direction] : undefined
  })
  const preview = ref<{ chapter: ChapterMeta; content: string; direction: -1 | 1; offset: number }>()
  let ready: Promise<void> = Promise.resolve()
  watch(target, (chapter, _, onCleanup) => {
    preview.value = undefined
    if (!chapter) return
    let active = true
    onCleanup(() => { active = false })
    ready = getChapterContent(chapter.id).then(content => {
      if (active) preview.value = {
        chapter, content, direction,
        offset: direction > 0 ? 0 : Math.max(0, chapter.charCount - 1),
      }
    }).catch(() => { /* 实际翻页时由 loadChapter 重试并处理读取错误。 */ })
  }, { immediate: true })
  return { preview, wait: () => ready }
}
const previousPage = adjacentPage(-1)
const nextPage = adjacentPage(1)
const neighbors = computed(() => [
  pageIndex.value === 0 ? previousPage.preview.value : undefined,
  pageIndex.value === pageCount.value - 1 ? nextPage.preview.value : undefined,
].filter(page => !!page))

function positionNeighbor(element: unknown, direction: -1 | 1): void {
  if (direction < 0 && element instanceof HTMLElement) element.scrollLeft = element.scrollWidth
}
const frontMatterCount = computed(() => countFrontMatterChapters(chapters.value))
const numberedChapterCount = computed(() =>
  Math.max(chapters.value.length - frontMatterCount.value, 0),
)

function chapterNumber(chapter: ChapterMeta): number | null {
  return displayChapterNumber(chapter.order, frontMatterCount.value)
}

const filteredChapters = computed(() => {
  const query = tocQuery.value.trim().toLowerCase()
  if (!query) return chapters.value
  const digits = /^\d+$/.test(query) ? Number(query) : null
  return chapters.value.filter((chapter) => {
    if (chapter.title.toLowerCase().includes(query)) return true
    return digits !== null && chapterNumber(chapter) === digits
  })
})
const tocSummary = computed(() =>
  tocQuery.value.trim()
    ? `找到 ${filteredChapters.value.length} 章`
    : `共 ${numberedChapterCount.value} 章`,
)
const canTurnPreviousPage = computed(
  () => canGoPrevious.value || pageIndex.value > 0,
)
const canTurnNextPage = computed(
  () => canGoNext.value || pageIndex.value < pageCount.value - 1,
)

const readerStyle = computed(() => ({
  '--reader-font-size': `${settingsStore.settings.fontSize}px`,
  '--reader-line-height': String(settingsStore.settings.lineHeight),
  '--reader-inline-padding': `${settingsStore.settings.pageMargin}px`,
  '--reader-turn-duration': `${motionDuration.value}ms`,
}))

function snapshotProgress(): void {
  const activeBook = book.value
  const chapter = currentChapter.value
  if (!activeBook || !chapter) return

  scheduleProgress({
    bookId: activeBook.id,
    chapters: chapters.value,
    chapterIndex: chapter.order,
    charOffset: lastKnownOffset.value,
    totalChars: activeBook.totalChars,
  })
}

function updateIndicators(offset: number): void {
  const chapter = currentChapter.value
  const activeBook = book.value
  if (!chapter || !activeBook) return

  const atBookEnd = pageWidth.value > 0 && chapter.order === chapters.value.length - 1 &&
    pageIndex.value === pageCount.value - 1
  const safeOffset = atBookEnd ? chapter.charCount : clampCharOffset(offset, chapter.charCount)
  lastKnownOffset.value = safeOffset
  currentChapterProgress.value = calculateChapterProgress(
    safeOffset,
    chapter.charCount,
  )
  currentBookProgress.value = calculateBookProgress(
    chapter.startChar,
    safeOffset,
    activeBook.totalChars,
  )
  snapshotProgress()
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/** 没有自定义字体时 document.fonts.status 已经是 loaded，这里不会等出一帧空隙。 */
async function waitForFonts(): Promise<void> {
  const fonts = document.fonts
  if (!fonts || fonts.status === 'loaded') return
  try {
    await fonts.ready
  } catch {
    // 字体加载失败时按当前布局测量即可。
  }
}

/**
 * 同步量出当前正文的分页结果，并把页码落到 offset 所在页。
 *
 * 这里刻意不等待绘制：换章时如果先让新章节以第 1 页绘出来、
 * 量完再把 transform 挪到目标页，用户就会看到文字先出现再跳一下。
 * 读布局、定位都放在同一次任务里，浏览器第一次绘制时页码已经是对的。
 */
async function paginateAt(offset: number): Promise<void> {
  const article = articleRef.value
  const text = chapterTextRef.value
  if (!article || !text) return
  const width = article.clientWidth
  if (width > 0 && width !== pageWidth.value) {
    pageWidth.value = width
    // column-width 落到样式上才能量出真实列宽；仍是同一帧内的微任务。
    await nextTick()
  }
  if (width > 0) pageCount.value = countPages(article, pageGutter.value)

  const safeOffset = clampCharOffset(offset, currentChapter.value?.charCount ?? 0)
  const page =
    pageWidth.value > 0
      ? pageOfOffset(text, article, safeOffset, pageStride.value)
      : 0
  pageIndex.value = clampPage(page)
  updateIndicators(safeOffset)
}

function clampPage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.floor(value), pageCount.value - 1))
}

function pageOffsetAt(index: number): number {
  const article = articleRef.value
  const text = chapterTextRef.value
  if (!article || !text) return 0
  return offsetOfPage(text, article, index, pageStride.value)
}

function syncIndicatorsFromPage(): void {
  const chapter = currentChapter.value
  if (!chapter) return
  updateIndicators(
    clampCharOffset(pageOffsetAt(pageIndex.value), chapter.charCount),
  )
}

function goToPage(target: number): void {
  settleDrag(clampPage(target))
}

/** 换章后让新的一页淡入，避免整块文字硬切造成的“跳”。 */
function markChapterSwap(): void {
  chapterSwapping.value = true
  if (chapterSwapTimer) clearTimeout(chapterSwapTimer)
  chapterSwapTimer = setTimeout(() => {
    chapterSwapTimer = null
    chapterSwapping.value = false
  }, 240)
}

async function restoreOffset(offset: number): Promise<void> {
  clearPageMotion()
  dragOffset.value = 0
  layoutReady.value = false
  snapping.value = true
  await nextTick()
  await waitForFonts()
  await paginateAt(offset)
  await nextTick()
  await waitForPaint()
  snapping.value = false
  layoutReady.value = true
}

function routeOffsetValue(): number | null {
  const raw = route.query.offset
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null
}

function routeChapterKey(): string | null {
  const raw = route.query.chapter
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value ? value : null
}

async function loadChapter(
  chapterKey: string,
  requestedOffset: number | null,
  updateRoute = true,
  turnedContent?: string,
): Promise<void> {
  const activeBook = book.value
  if (!activeBook) return
  const chapter = chapters.value.find((item) => item.chapterKey === chapterKey)
  if (!chapter) {
    error.value = '找不到指定章节，可能备份或章节数据不完整。'
    loading.value = false
    return
  }

  if (currentChapter.value?.chapterKey !== chapter.chapterKey) {
    // 记下旧章节位置即可，不等 IndexedDB 写完再换章（写链本身有顺序保证）。
    snapshotProgress()
    void flushReadingProgress().catch(() => undefined)
  }

  chapterLoading.value = true
  clearPageMotion(false)
  try {
    const content = turnedContent ?? await getChapterContent(chapter.id)
    if (disposed) return
    // 等字体时旧页面还留在屏幕上，不会让读者看到半成品。
    await waitForFonts()
    snapping.value = true
    pageIndex.value = 0
    dragOffset.value = 0
    currentChapter.value = chapter
    currentContent.value = content

    // 标题先进入 DOM；正文写入后立刻同步测量分页，
    // 这样新章节第一次被绘出来时就已经停在正确的页码上。
    await nextTick()

    const offset = clampCharOffset(
      requestedOffset ??
        (savedProgress.value?.chapterKey === chapter.chapterKey
          ? savedProgress.value.charOffset
          : 0),
      chapter.charCount,
    )
    await paginateAt(offset)
    if (turnedContent === undefined) markChapterSwap()
    await nextTick()
    await waitForPaint()
    snapping.value = false
    layoutReady.value = true
    if (disposed) return
    chapterLoading.value = false

    document.title = `${chapter.title} · ${activeBook.title} · ReadNook`
    if (updateRoute) {
      await router.replace({
        query: { chapter: chapter.chapterKey },
      })
    }
    runQueuedTurn()
  } catch (loadError) {
    if (disposed) return
    // 换章失败时别把跟手位移留在页面上。
    dragOffset.value = 0
    snapping.value = false
    layoutReady.value = true
    error.value = getErrorMessage(
      loadError,
      '章节读取失败，请返回书架后重试。',
    )
    chapterLoading.value = false
  } finally {
    if (!disposed) loading.value = false
  }
}

async function loadReader(): Promise<void> {
  const serial = ++loadSerial
  const rawBookId = route.params.bookId
  const bookId = Array.isArray(rawBookId) ? rawBookId[0] : rawBookId
  if (!bookId) {
    error.value = '无效的书籍地址。'
    loading.value = false
    return
  }

  loading.value = true
  error.value = ''
  try {
    const [loadedBook, chapterList, progress, bookmarkList] = await Promise.all([
      getBook(bookId),
      listChapters(bookId),
      getProgress(bookId),
      listBookmarks(bookId),
    ])
    if (serial !== loadSerial || disposed) return
    if (!loadedBook) {
      error.value = '这本书已不在本地书架中，可能已被删除。'
      loading.value = false
      return
    }
    if (chapterList.length === 0) {
      error.value = '这本书没有可阅读的章节。'
      loading.value = false
      return
    }

    book.value = loadedBook
    chapters.value = chapterList
    bookmarks.value = bookmarkList
    savedProgress.value = progress ?? null

    const resume = resolveResumeLocation(chapterList, progress)
    if (!resume) {
      error.value = '这本书没有可阅读的章节。'
      loading.value = false
      return
    }

    const queryKey = routeChapterKey()
    const queryChapter = queryKey
      ? chapterList.find((chapter) => chapter.chapterKey === queryKey)
      : undefined
    const targetChapter = queryChapter ?? chapterList[resume.chapterIndex] ?? chapterList[0]
    if (!targetChapter) {
      error.value = '这本书没有可阅读的章节。'
      loading.value = false
      return
    }

    const explicitOffset = routeOffsetValue()
    const fallbackOffset =
      progress?.chapterKey === targetChapter.chapterKey ? progress.charOffset : 0
    const targetOffset = explicitOffset ?? fallbackOffset

    // 先渲染阅读器骨架，loadChapter 才能测量真实文本并恢复位置。
    loading.value = false
    await nextTick()
    await loadChapter(targetChapter.chapterKey, targetOffset, true)
    if (serial !== loadSerial || disposed) return
    if (error.value) return
    await touchBookReadTime(loadedBook.id)
    if (route.query.offset) {
      await router.replace({ query: { chapter: targetChapter.chapterKey } })
    }
  } catch (loadError) {
    if (disposed) return
    error.value = getErrorMessage(
      loadError,
      '无法打开这本书，请检查本地存储后重试。',
    )
    loading.value = false
  }
}

async function saveAndBack(): Promise<void> {
  snapshotProgress()
  await flushReadingProgress().catch(() => undefined)
  await router.push('/')
}

async function goToAdjacent(direction: -1 | 1, velocity = 0): Promise<void> {
  const chapter = currentChapter.value
  if (!chapter) return
  const target = chapters.value[chapter.order + direction]
  if (!target) {
    toast.show(direction > 0 ? '已经是最后一章。' : '已经是第一章。', 'info', 2_000)
    return
  }
  chapterLoading.value = true
  const adjacent = direction > 0 ? nextPage : previousPage
  await adjacent.wait()
  if (disposed || currentChapter.value !== chapter) return
  const preview = adjacent.preview.value
  if (preview && preview.chapter.id === target.id) {
    await nextTick()
    const article = articleRef.value
    article?.getBoundingClientRect()
    motionDuration.value = pageTurnDuration(
      Math.abs(-direction * pageStride.value - dragOffset.value), pageStride.value, velocity,
    )
    snapping.value = false
    dragOffset.value = -direction * pageStride.value
    await nextTick()
    await Promise.allSettled((article?.getAnimations() ?? []).map(animation => animation.finished))
    if (disposed || currentChapter.value !== chapter) return
    await loadChapter(target.chapterKey, preview.offset, true, preview.content)
  } else {
    await loadChapter(target.chapterKey, direction > 0 ? 0 : Math.max(0, target.charCount - 1))
  }
}

async function jumpToChapter(chapterKey: string, offset = 0): Promise<void> {
  clearPageMotion()
  tocOpen.value = false
  if (currentChapter.value?.chapterKey === chapterKey) {
    await restoreOffset(offset)
    return
  }
  await loadChapter(chapterKey, offset, true)
}

async function jumpToBookmark(bookmark: Bookmark): Promise<void> {
  clearPageMotion()
  bookmarksOpen.value = false
  if (currentChapter.value?.chapterKey === bookmark.chapterKey) {
    await restoreOffset(bookmark.charOffset)
    return
  }
  await loadChapter(bookmark.chapterKey, bookmark.charOffset, true)
}

function makeExcerpt(chapter: ChapterMeta, offset: number): string {
  const content = currentContent.value
  if (!content) return chapter.title
  const start = Math.max(0, offset - 30)
  const end = Math.min(content.length, offset + 90)
  const excerpt = content
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim()
  if (!excerpt) return chapter.title
  return `${start > 0 ? '…' : ''}${excerpt}${end < content.length ? '…' : ''}`
}

async function addCurrentBookmark(): Promise<void> {
  const chapter = currentChapter.value
  const activeBook = book.value
  if (!chapter || !activeBook) return

  const offset = clampCharOffset(lastKnownOffset.value, chapter.charCount)
  const existing = bookmarks.value.find(
    (bookmark) =>
      bookmark.chapterKey === chapter.chapterKey &&
      Math.abs(bookmark.charOffset - offset) <= 2,
  )
  if (existing) {
    toast.show('这个位置已经有书签了。', 'info', 2_200)
    return
  }

  const bookmark: Bookmark = {
    id: createId(),
    bookId: activeBook.id,
    chapterKey: chapter.chapterKey,
    chapterIndex: chapter.order,
    charOffset: offset,
    chapterTitle: chapter.title,
    excerpt: makeExcerpt(chapter, offset),
    createdAt: Date.now(),
  }

  try {
    await addBookmark(bookmark)
    bookmarks.value = [bookmark, ...bookmarks.value]
    toast.success('已添加书签。')
  } catch (bookmarkError) {
    toast.error(
      getErrorMessage(bookmarkError, '添加书签失败，请稍后重试。'),
    )
  }
}

async function removeBookmarkItem(bookmark: Bookmark): Promise<void> {
  try {
    await deleteBookmark(bookmark.id)
    bookmarks.value = bookmarks.value.filter((item) => item.id !== bookmark.id)
    toast.success('已删除书签。')
  } catch (bookmarkError) {
    toast.error(
      getErrorMessage(bookmarkError, '删除书签失败，请稍后重试。'),
    )
  }
}

async function turnPage(direction: -1 | 1): Promise<void> {
  if (loading.value || !layoutReady.value) return
  if (pageSettling || chapterLoading.value) {
    // 连点只预留下一次翻页，避免把目标累加成跨过好几页的长动画。
    queuedTurn = direction
    return
  }
  const chapter = currentChapter.value
  if (!chapter) return

  if (direction > 0) {
    if (pageIndex.value < pageCount.value - 1) {
      goToPage(pageIndex.value + 1)
      return
    }
    await goToAdjacent(1)
    return
  }

  if (pageIndex.value > 0) {
    goToPage(pageIndex.value - 1)
    return
  }
  await goToAdjacent(-1)
}

const DRAG_START_THRESHOLD = 8
/** Safari 的边缘历史导航必须在 touchstart 阶段阻止。 */
const HISTORY_SWIPE_EDGE = 32
/** 手指位移一直没超过这个距离，就仍然算“点按”，交给 click 翻页。 */
const TAP_SLOP = 20
const DRAG_MAX_RATIO = 0.94

function canDragToPreviousPage(): boolean {
  return pageIndex.value > 0
}

function canDragToNextPage(): boolean {
  return pageIndex.value < pageCount.value - 1
}

/** 没有相邻页时给出阻尼，让手指有“到头了”的反馈而不是硬停。 */
function rubberBand(value: number): number {
  return resistPageBoundary(value, pageWidth.value)
}

function constrainDrag(delta: number): number {
  let value = delta
  if (value < 0 && !canTurnNextPage.value) value = rubberBand(value)
  if (value > 0 && !canTurnPreviousPage.value) value = rubberBand(value)
  const limit = pageWidth.value * DRAG_MAX_RATIO
  return Math.max(-limit, Math.min(limit, value))
}

function onPagesTouchStart(event: TouchEvent): void {
  pagesTouchActive = false
  if (event.touches.length !== 1) {
    onPagesTouchCancel()
    return
  }
  const touch = event.touches[0]
  if (!touch) return
  if (event.cancelable &&
    (touch.clientX <= HISTORY_SWIPE_EDGE || touch.clientX >= window.innerWidth - HISTORY_SWIPE_EDGE)) {
    event.preventDefault()
  }
  touchDuringChapterLoad = chapterLoading.value
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return
  dragOriginOffset = 0
  if (!touchDuringChapterLoad && pageSettling && articleRef.value && pageStride.value > 0) {
    // 从屏幕上实际停留的位置接住页面，不能跳到动画的终点再开始拖。
    const x = new DOMMatrixReadOnly(getComputedStyle(articleRef.value).transform).m41
    clearPageMotion()
    const anchor = clampPage(Math.round(-x / pageStride.value))
    pageIndex.value = anchor
    dragOriginOffset = x + anchor * pageStride.value
    snapping.value = true
    syncIndicatorsFromPage()
  }
  touchStartX = touch.clientX
  touchStartY = touch.clientY
  touchStartAt = Date.now()
  dragLastX = touch.clientX
  dragLastAt = performance.now()
  dragVelocity = 0
  dragPeak = 0
  dragAxis = 'none'
  if (!touchDuringChapterLoad) dragOffset.value = dragOriginOffset
  pagesTouchActive = true
}

/**
 * 跟手翻页：手指横向拖动时，整条分栏页面跟着位移，
 * 屏幕上自然同时露出当前页和相邻页（和纸质书一样）。
 */
function onPagesTouchMove(event: TouchEvent): void {
  if (!pagesTouchActive) return
  if (event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return
  if (loading.value || chapterLoading.value || !layoutReady.value) return

  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  dragPeak = Math.max(dragPeak, Math.abs(dx))
  if (dragAxis === 'none') {
    if (Math.abs(dy) >= DRAG_START_THRESHOLD && Math.abs(dy) > Math.abs(dx) * 1.2) {
      dragAxis = 'vertical'
      return
    }
    if (Math.abs(dx) < DRAG_START_THRESHOLD) return
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return
    dragAxis = 'horizontal'
    // 拖动期间关掉过渡，位移必须严格跟手。
    snapping.value = true
  }
  if (dragAxis !== 'horizontal') return

  const now = performance.now()
  const elapsed = now - dragLastAt
  if (elapsed > 0) {
    const instantaneous = Math.max(-3, Math.min(3, (touch.clientX - dragLastX) / elapsed))
    dragVelocity = dragVelocity * 0.35 + instantaneous * 0.65
  }
  dragLastX = touch.clientX
  dragLastAt = now
  dragOffset.value = constrainDrag(dragOriginOffset + dx)
}

function clearPageMotion(clearQueue = true): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = null
  pageSettling = false
  if (clearQueue) queuedTurn = null
}

function runQueuedTurn(): void {
  const direction = queuedTurn
  queuedTurn = null
  if (direction !== null && !disposed) void turnPage(direction)
}

function settleDrag(target: number, velocity = 0): void {
  clearPageMotion()
  const next = clampPage(target)
  const distance = Math.abs((next - pageIndex.value) * pageStride.value + dragOffset.value)
  const duration = pageTurnDuration(distance, pageStride.value, velocity)
  motionDuration.value = duration
  snapping.value = false
  dragOffset.value = 0
  if (next !== pageIndex.value) {
    pageIndex.value = next
    syncIndicatorsFromPage()
  }
  if (duration > 0) {
    pageSettling = true
    settleTimer = setTimeout(() => {
      settleTimer = null
      pageSettling = false
      runQueuedTurn()
    }, duration)
  }
}

function onPagesTouchEnd(event: TouchEvent): void {
  if (!pagesTouchActive) return
  pagesTouchActive = false
  const touch = event.changedTouches[0]
  if (!touch) return
  const wasDragging = dragAxis === 'horizontal'
  const wasVertical = dragAxis === 'vertical'
  dragAxis = 'none'
  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  const elapsed = Date.now() - touchStartAt

  if (touchDuringChapterLoad || chapterLoading.value) {
    if (event.touches.length === 0 && Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP && elapsed < 500) {
      turnPageAtClientX(touch.clientX)
    }
    lastFlipAt = Date.now()
    return
  }

  if (event.touches.length > 0) {
    // 多指落下，放弃这次拖动。
    if (wasDragging) settleDrag(pageIndex.value)
    return
  }

  if (wasVertical) {
    lastFlipAt = Date.now()
    settleDrag(pageIndex.value)
    return
  }

  // 触摸轻点统一处理，再屏蔽合成 click；连续轻点无需等待上次的抑制时间。
  if (dragPeak < TAP_SLOP &&
    Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP && elapsed < 500) {
    const turned = turnPageAtClientX(touch.clientX)
    if (!turned && (wasDragging || dragOriginOffset !== 0)) settleDrag(pageIndex.value)
    lastFlipAt = Date.now()
    return
  }

  if (!wasDragging) {
    // 没有 touchmove 的合成手势（或极快的轻扫）仍按位移兜底。
    if (elapsed > 900 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) {
      lastFlipAt = Date.now()
      if (dragOriginOffset !== 0) settleDrag(pageIndex.value)
      return
    }
    lastFlipAt = Date.now()
    void turnPage(dx < 0 ? 1 : -1)
    return
  }

  // 手指一直没真正拖动：按点按处理，交给 click 决定左右翻页。
  if (dragPeak < TAP_SLOP) {
    lastFlipAt = Date.now()
    settleDrag(pageIndex.value)
    return
  }

  lastFlipAt = Date.now()
  const width = pageWidth.value
  if (width <= 0) {
    settleDrag(pageIndex.value)
    return
  }

  const offset = dragOffset.value
  // 手指停住再松开不算轻扫，否则慢慢拖一下也会被当成快速滑动。
  const velocity = performance.now() - dragLastAt > 100 ? 0 : dragVelocity
  const direction = resolvePageTurn(offset, velocity, width)

  if (direction > 0) {
    if (canDragToNextPage()) {
      settleDrag(pageIndex.value + 1, velocity)
      return
    }
    if (canGoNext.value) {
      void goToAdjacent(1, velocity)
      return
    }
  } else if (direction < 0) {
    if (canDragToPreviousPage()) {
      settleDrag(pageIndex.value - 1, velocity)
      return
    }
    if (canGoPrevious.value) {
      void goToAdjacent(-1, velocity)
      return
    }
  }

  settleDrag(pageIndex.value, velocity)
}

function onPagesTouchCancel(): void {
  pagesTouchActive = false
  if (dragAxis !== 'horizontal' && dragOriginOffset === 0) return
  dragAxis = 'none'
  lastFlipAt = Date.now()
  settleDrag(pageIndex.value)
}

function onPagesClick(event: MouseEvent): void {
  if (Date.now() - lastFlipAt < 500) return
  const target = event.target
  if (target instanceof HTMLElement && target.closest('a, button')) return
  turnPageAtClientX(event.clientX)
}

function turnPageAtClientX(clientX: number): boolean {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return false
  const pages = pagesRef.value
  if (!pages) return false
  const rect = pages.getBoundingClientRect()
  if (rect.width === 0) return false
  const ratio = (clientX - rect.left) / rect.width
  if (ratio <= 0.3) {
    void turnPage(-1)
    return true
  } else if (ratio >= 0.7) {
    void turnPage(1)
    return true
  }
  return false
}

function onReaderKeydown(event: KeyboardEvent): void {
  if (tocOpen.value || bookmarksOpen.value || settingsOpen.value) return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  ) {
    return
  }
  if (
    event.key === 'ArrowRight' ||
    event.key === 'PageDown' ||
    event.key === ' '
  ) {
    event.preventDefault()
    void turnPage(1)
  } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault()
    void turnPage(-1)
  }
}

function scheduleReflowRestore(): void {
  if (!layoutReady.value || loading.value || chapterLoading.value) return
  if (reflowTimer) clearTimeout(reflowTimer)
  reflowTimer = setTimeout(() => {
    reflowTimer = null
    void restoreOffset(lastKnownOffset.value)
  }, 100)
}

function onViewportResize(): void {
  if (loading.value || chapterLoading.value || !currentChapter.value) return
  scheduleReflowRestore()
}

watch(
  [
    () => settingsStore.settings.fontSize,
    () => settingsStore.settings.lineHeight,
    () => settingsStore.settings.pageMargin,
  ],
  () => {
    if (!currentChapter.value) return
    scheduleReflowRestore()
  },
  { flush: 'pre' },
)

/** 把当前章节滚动到目录可视区域中间。 */
function scrollTocToCurrentChapter(): void {
  const list = tocListRef.value
  const active = list?.querySelector<HTMLElement>('[aria-current="location"]')
  const body = list?.closest<HTMLElement>('.app-dialog__body')
  if (!active || !body) return

  const bodyRect = body.getBoundingClientRect()
  const activeRect = active.getBoundingClientRect()
  const target =
    body.scrollTop +
    (activeRect.top - bodyRect.top) -
    (body.clientHeight - activeRect.height) / 2
  body.scrollTop = Math.max(0, target)
}

/**
 * 目录弹层由 BaseDialog 异步 showModal，打开瞬间内容还没有布局，
 * 这里等滚动容器真正有了高度再定位，否则 scrollTop 会被重置为 0。
 */
function scrollTocWhenReady(attempt = 0): void {
  const body = tocListRef.value?.closest<HTMLElement>('.app-dialog__body')
  if (body && body.clientHeight > 0) {
    if (!tocQuery.value) scrollTocToCurrentChapter()
    return
  }
  if (attempt >= 24) return
  requestAnimationFrame(() => scrollTocWhenReady(attempt + 1))
}

watch(tocOpen, (open) => {
  if (!open) {
    tocQuery.value = ''
    return
  }
  requestAnimationFrame(() => scrollTocWhenReady())
})

watch(tocQuery, async () => {
  await nextTick()
  tocListRef.value?.closest<HTMLElement>('.app-dialog__body')?.scrollTo({ top: 0 })
})

watch(
  () => route.query.chapter,
  (value) => {
    if (loading.value) return
    const key = typeof value === 'string' ? value : null
    if (!key || key === currentChapter.value?.chapterKey) return
    void loadChapter(key, null, false)
  },
)

onMounted(() => {
  document.documentElement.classList.add('reader-open')
  window.addEventListener('resize', onViewportResize)
  window.visualViewport?.addEventListener('resize', onViewportResize)
  window.addEventListener('keydown', onReaderKeydown)
  void loadReader()
})

onBeforeUnmount(() => {
  clearPageMotion()
  document.documentElement.classList.remove('reader-open')
  disposed = true
  loadSerial += 1
  if (reflowTimer) clearTimeout(reflowTimer)
  if (chapterSwapTimer) clearTimeout(chapterSwapTimer)
  window.removeEventListener('resize', onViewportResize)
  window.visualViewport?.removeEventListener('resize', onViewportResize)
  window.removeEventListener('keydown', onReaderKeydown)
  snapshotProgress()
  void flushReadingProgress().catch(() => undefined)
})
</script>

<template>
  <div
    class="reader-shell"
    :style="readerStyle"
    :aria-busy="loading || chapterLoading"
  >
    <div v-if="loading" class="reader-state">
      <span class="spinner spinner--large" aria-hidden="true" />
      <p>正在打开书页…</p>
    </div>

    <div v-else-if="error" class="reader-state">
      <AppIcon name="alert" :size="30" />
      <h1>无法打开阅读页</h1>
      <p>{{ error }}</p>
      <div class="reader-state__actions">
        <button type="button" class="button" @click="saveAndBack">返回书架</button>
        <button type="button" class="button button--primary" @click="loadReader">
          重试
        </button>
      </div>
    </div>

    <template v-else-if="book && currentChapter">
      <header class="reader-topbar">
        <button
          type="button"
          class="reader-icon-button"
          aria-label="返回书架"
          @click="saveAndBack"
        >
          <AppIcon name="arrow-left" :size="22" />
        </button>
        <div class="reader-topbar__title">
          <span :title="book.author ? `${book.title} · 作者：${book.author}` : book.title">
            {{ book.title }}<template v-if="book.author"> · 作者：{{ book.author }}</template>
          </span>
          <h1>{{ currentChapter.title }}</h1>
        </div>
        <div class="reader-topbar__actions">
          <button
            type="button"
            class="reader-icon-button"
            aria-label="打开目录"
            @click="tocOpen = true"
          >
            <AppIcon name="list" :size="21" />
          </button>
          <button
            type="button"
            class="reader-icon-button"
            aria-label="查看书签"
            @click="bookmarksOpen = true"
          >
            <AppIcon name="bookmark" :size="20" />
          </button>
        </div>
      </header>

      <div
        class="reader-meter"
        role="progressbar"
        :aria-valuenow="currentBookPercent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`全书阅读进度 ${currentBookPercent}%`"
      >
        <span :style="{ width: `${currentBookPercent}%` }" />
      </div>

      <div
        ref="pagesRef"
        class="reader-pages"
        @touchstart="onPagesTouchStart"
        @touchmove.passive="onPagesTouchMove"
        @touchend="onPagesTouchEnd"
        @touchcancel="onPagesTouchCancel"
        @click="onPagesClick"
      >
        <div
          class="reader-pages__viewport"
          :class="{ 'is-chapter-swap': chapterSwapping }"
        >
          <article
            ref="articleRef"
            class="reader-article"
            :class="{ 'is-snapping': snapping }"
            :style="articleStyle"
          >
            <ChapterPageContent :book-title="book.title" :chapter="currentChapter"
              :chapter-percent="currentChapterPercent" :book-percent="currentBookPercent"
              :content="currentContent" />
          </article>
          <div v-for="neighbor in neighbors" :key="neighbor.chapter.id"
            :ref="element => positionNeighbor(element, neighbor.direction)"
            class="reader-neighbor" :class="{ 'is-snapping': snapping }" aria-hidden="true" inert
            :style="{ transform: `translateX(${neighbor.direction * pageStride + dragOffset}px)` }">
            <article class="reader-article" :style="{ columnWidth: articleStyle.columnWidth, columnGap: articleStyle.columnGap }">
              <ChapterPageContent :book-title="book.title" :chapter="neighbor.chapter"
                :chapter-percent="toProgressPercent(calculateChapterProgress(neighbor.offset, neighbor.chapter.charCount))"
                :book-percent="toProgressPercent(calculateBookProgress(neighbor.chapter.startChar, neighbor.offset, book.totalChars))"
                :content="neighbor.content" />
            </article>
          </div>
        </div>

        <p v-if="pageWidth > 0" class="reader-page-indicator" aria-hidden="true">
          {{ pageIndex + 1 }} / {{ pageCount }}
        </p>
      </div>

      <footer class="reader-bottombar">
        <button
          type="button"
          class="reader-tool"
          :disabled="!canTurnPreviousPage"
          @click="turnPage(-1)"
        >
          <AppIcon name="chevron-left" :size="21" />
          <span>上一页</span>
        </button>
        <button type="button" class="reader-tool" @click="addCurrentBookmark">
          <AppIcon name="bookmark" :size="20" />
          <span>加书签</span>
        </button>
        <button type="button" class="reader-tool" @click="settingsOpen = true">
          <AppIcon name="type" :size="21" />
          <span>阅读设置</span>
        </button>
        <button
          type="button"
          class="reader-tool"
          :disabled="!canTurnNextPage"
          @click="turnPage(1)"
        >
          <AppIcon name="chevron-right" :size="21" />
          <span>下一页</span>
        </button>
      </footer>

      <BaseDialog
        v-model:open="tocOpen"
        title="目录"
        variant="sheet"
        fixed-height
      >
        <template #subheader>
          <div class="toc-toolbar">
            <label class="toc-search">
              <AppIcon name="search" :size="16" />
              <input
                v-model="tocQuery"
                type="search"
                class="toc-search__input"
                placeholder="搜索章节名或序号"
                aria-label="搜索章节"
                autocomplete="off"
              />
              <button
                v-if="tocQuery"
                type="button"
                class="toc-search__clear"
                aria-label="清除搜索"
                @click="tocQuery = ''"
              >
                <AppIcon name="close" :size="14" />
              </button>
            </label>
            <p class="toc-summary" role="status">{{ tocSummary }}</p>
          </div>
        </template>
        <div ref="tocListRef" class="toc-list">
          <button
            v-for="chapter in filteredChapters"
            :key="chapter.chapterKey"
            type="button"
            class="toc-item"
            :class="{
              'is-active': chapter.chapterKey === currentChapter.chapterKey,
              'is-front-matter': isFrontMatterChapter(chapter),
              'is-front-matter-last':
                isFrontMatterChapter(chapter) &&
                chapter.order === frontMatterCount - 1,
            }"
            :aria-current="
              chapter.chapterKey === currentChapter.chapterKey ? 'location' : undefined
            "
            @click="jumpToChapter(chapter.chapterKey)"
          >
            <span class="toc-item__order" aria-hidden="true">{{
              chapterNumber(chapter) ?? ''
            }}</span>
            <span class="toc-item__title">{{ chapter.title }}</span>
            <span v-if="isFrontMatterChapter(chapter)" class="toc-item__badge">
              前置
            </span>
            <span v-else-if="chapter.autoSplit" class="toc-item__badge">自动</span>
          </button>
        </div>
        <p v-if="filteredChapters.length === 0" class="toc-empty">
          没有找到匹配的章节
        </p>
      </BaseDialog>

      <BaseDialog v-model:open="bookmarksOpen" title="书签" variant="sheet">
        <div v-if="bookmarks.length === 0" class="sheet-empty">
          <AppIcon name="bookmark" :size="28" />
          <p>还没有书签。阅读时点底部“加书签”即可记录当前位置。</p>
        </div>
        <ul v-else class="bookmark-list">
          <li v-for="bookmark in bookmarks" :key="bookmark.id" class="bookmark-entry">
            <button
              type="button"
              class="bookmark-entry__main"
              @click="jumpToBookmark(bookmark)"
            >
              <span class="bookmark-entry__chapter">{{ bookmark.chapterTitle }}</span>
              <span class="bookmark-entry__excerpt">{{ bookmark.excerpt }}</span>
              <span class="bookmark-entry__time">
                {{ formatRelativeTime(bookmark.createdAt) }}
              </span>
            </button>
            <button
              type="button"
              class="icon-button icon-button--quiet"
              :aria-label="`删除书签：${bookmark.chapterTitle}`"
              @click="removeBookmarkItem(bookmark)"
            >
              <AppIcon name="trash" :size="17" />
            </button>
          </li>
        </ul>
        <template #footer>
          <button type="button" class="button button--primary" @click="addCurrentBookmark">
            <AppIcon name="bookmark" :size="17" />
            在当前位置添加书签
          </button>
        </template>
      </BaseDialog>

      <BaseDialog v-model:open="settingsOpen" title="阅读设置" variant="sheet">
        <ReaderSettingsPanel />
      </BaseDialog>
    </template>
  </div>
</template>
