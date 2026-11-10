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
const chapterTextRef = ref<HTMLElement | null>(null)
const tocListRef = ref<HTMLElement | null>(null)

const pageIndex = ref(0)
const pageCount = ref(1)
const pageWidth = ref(0)
const snapping = ref(true)
const layoutReady = ref(false)

let reflowTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
let loadSerial = 0
let touchStartX = 0
let touchStartY = 0
let touchStartAt = 0
let lastFlipAt = 0

const articleStyle = computed(() => ({
  transform: `translateX(${-pageIndex.value * pageWidth.value}px)`,
  columnWidth: pageWidth.value > 0 ? `${pageWidth.value}px` : undefined,
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
const hasContent = computed(() => currentContent.value.length > 0)
const isAutoSplit = computed(() => currentChapter.value?.autoSplit ?? false)
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

  const safeOffset = clampCharOffset(offset, chapter.charCount)
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

async function layoutPages(): Promise<void> {
  const article = articleRef.value
  if (!article) return
  const width = article.clientWidth
  if (width <= 0) return
  pageWidth.value = width
  await nextTick()
  await waitForPaint()
  pageCount.value = countPages(article)
  if (pageIndex.value > pageCount.value - 1) {
    goToPage(pageCount.value - 1, false)
  }
}

function pageOffsetAt(index: number): number {
  const article = articleRef.value
  const text = chapterTextRef.value
  if (!article || !text) return 0
  return offsetOfPage(text, article, index, pageWidth.value)
}

function syncIndicatorsFromPage(): void {
  const chapter = currentChapter.value
  if (!chapter) return
  updateIndicators(
    clampCharOffset(pageOffsetAt(pageIndex.value), chapter.charCount),
  )
}

function goToPage(target: number, animate = true): void {
  const next = Math.max(0, Math.min(target, pageCount.value - 1))
  if (next === pageIndex.value) {
    syncIndicatorsFromPage()
    return
  }
  if (!animate) snapping.value = true
  pageIndex.value = next
  syncIndicatorsFromPage()
  if (!animate) {
    void nextTick(() => {
      requestAnimationFrame(() => {
        snapping.value = false
      })
    })
  }
}

async function restoreOffset(offset: number): Promise<void> {
  layoutReady.value = false
  await nextTick()
  await waitForPaint()
  try {
    await document.fonts?.ready
  } catch {
    // 字体加载失败时按当前布局测量即可。
  }
  await layoutPages()
  const article = articleRef.value
  const text = chapterTextRef.value
  if (!article || !text) {
    layoutReady.value = true
    return
  }
  const page = pageOfOffset(text, article, offset, pageWidth.value)
  goToPage(page, false)
  await waitForPaint()
  snapping.value = false
  updateIndicators(offset)
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
    snapshotProgress()
    await flushReadingProgress().catch(() => undefined)
  }

  chapterLoading.value = true
  try {
    const content = await getChapterContent(chapter.id)
    if (disposed) return
    snapping.value = true
    pageIndex.value = 0
    currentChapter.value = chapter
    currentContent.value = content

    await nextTick()
    if (chapterTextRef.value) {
      chapterTextRef.value.textContent = content
    }
    await waitForPaint()

    const offset = clampCharOffset(
      requestedOffset ??
        (savedProgress.value?.chapterKey === chapter.chapterKey
          ? savedProgress.value.charOffset
          : 0),
      chapter.charCount,
    )
    await restoreOffset(offset)
    if (disposed) return
    chapterLoading.value = false

    document.title = `${chapter.title} · ${activeBook.title} · ReadNook`
    if (updateRoute) {
      await router.replace({
        query: { chapter: chapter.chapterKey },
      })
    }
  } catch (loadError) {
    if (disposed) return
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

async function goToAdjacent(direction: -1 | 1): Promise<void> {
  const chapter = currentChapter.value
  if (!chapter) return
  const target = chapters.value[chapter.order + direction]
  if (!target) {
    toast.show(direction > 0 ? '已经是最后一章。' : '已经是第一章。', 'info', 2_000)
    return
  }
  await loadChapter(target.chapterKey, 0, true)
}

async function jumpToChapter(chapterKey: string, offset = 0): Promise<void> {
  tocOpen.value = false
  if (currentChapter.value?.chapterKey === chapterKey) {
    await restoreOffset(offset)
    updateIndicators(offset)
    return
  }
  await loadChapter(chapterKey, offset, true)
}

async function jumpToBookmark(bookmark: Bookmark): Promise<void> {
  bookmarksOpen.value = false
  if (currentChapter.value?.chapterKey === bookmark.chapterKey) {
    await restoreOffset(bookmark.charOffset)
    updateIndicators(bookmark.charOffset)
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
  if (loading.value || chapterLoading.value || !layoutReady.value) return
  const chapter = currentChapter.value
  if (!chapter) return

  if (direction > 0) {
    if (pageIndex.value < pageCount.value - 1) {
      goToPage(pageIndex.value + 1)
      return
    }
    if (!canGoNext.value) {
      toast.show('已经是最后一章。', 'info', 2_000)
      return
    }
    await goToAdjacent(1)
    return
  }

  if (pageIndex.value > 0) {
    goToPage(pageIndex.value - 1)
    return
  }
  const previous = chapters.value[chapter.order - 1]
  if (!previous) {
    toast.show('已经是第一章。', 'info', 2_000)
    return
  }
  await loadChapter(previous.chapterKey, Math.max(previous.charCount - 1, 0), true)
}

function onPagesTouchStart(event: TouchEvent): void {
  if (event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return
  touchStartX = touch.clientX
  touchStartY = touch.clientY
  touchStartAt = Date.now()
}

function onPagesTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  if (!touch) return
  if (event.touches.length > 0 || Date.now() - touchStartAt > 900) return
  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return
  lastFlipAt = Date.now()
  void turnPage(dx < 0 ? 1 : -1)
}

function onPagesClick(event: MouseEvent): void {
  if (Date.now() - lastFlipAt < 500) return
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return
  const target = event.target
  if (target instanceof HTMLElement && target.closest('a, button')) return
  const pages = pagesRef.value
  if (!pages) return
  const rect = pages.getBoundingClientRect()
  if (rect.width === 0) return
  const ratio = (event.clientX - rect.left) / rect.width
  if (ratio <= 0.22) {
    void turnPage(-1)
  } else if (ratio >= 0.78) {
    void turnPage(1)
  }
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

watch(tocOpen, async (open) => {
  if (!open) {
    tocQuery.value = ''
    return
  }
  await nextTick()
  if (tocQuery.value) return
  const active = tocListRef.value?.querySelector<HTMLElement>('[aria-current="location"]')
  active?.scrollIntoView({ block: 'center' })
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
  window.addEventListener('resize', onViewportResize)
  window.visualViewport?.addEventListener('resize', onViewportResize)
  window.addEventListener('keydown', onReaderKeydown)
  void loadReader()
})

onBeforeUnmount(() => {
  disposed = true
  loadSerial += 1
  if (reflowTimer) clearTimeout(reflowTimer)
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
          <span>{{ book.title }}</span>
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
        @touchstart.passive="onPagesTouchStart"
        @touchend="onPagesTouchEnd"
        @click="onPagesClick"
      >
        <div class="reader-pages__viewport">
          <article
            ref="articleRef"
            class="reader-article"
            :class="{ 'is-snapping': snapping }"
            :style="articleStyle"
          >
            <header class="chapter-heading">
              <p class="chapter-heading__book">{{ book.title }}</p>
              <h2>
                {{ currentChapter.title }}
                <span v-if="isAutoSplit" class="auto-badge">自动分段</span>
              </h2>
              <p class="chapter-heading__meta">
                本章 {{ currentChapterPercent }}% · 全书 {{ currentBookPercent }}%
              </p>
            </header>

            <div ref="chapterTextRef" class="chapter-text" />
            <p v-if="!hasContent" class="empty-chapter">（本章无正文）</p>
          </article>
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
