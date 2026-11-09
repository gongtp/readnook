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
import { flushReadingProgress, scheduleProgress } from '@/services/readingProgress'
import { useReaderSettingsStore } from '@/stores/readerSettings'
import { useToastStore } from '@/stores/toast'
import type {
  Book,
  Bookmark,
  ChapterMeta,
  ReadingProgress,
} from '@/types/models'
import { findVisibleTextOffset, scrollToTextOffset } from '@/utils/domPosition'
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
const atChapterEnd = ref(false)
const tocOpen = ref(false)
const bookmarksOpen = ref(false)
const settingsOpen = ref(false)

const scrollRef = ref<HTMLElement | null>(null)
const chapterTextRef = ref<HTMLElement | null>(null)
const tocListRef = ref<HTMLElement | null>(null)

let suppressScroll = false
let scrollRaf = 0
let reflowTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
let loadSerial = 0

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

function syncOffsetFromScroll(): void {
  const scroll = scrollRef.value
  const text = chapterTextRef.value
  const chapter = currentChapter.value
  if (!scroll || !text || !chapter || suppressScroll) return

  const scrollRect = scroll.getBoundingClientRect()
  let offset = findVisibleTextOffset(text, scrollRect.top + 10)
  const nearBottom =
    scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 12
  atChapterEnd.value = nearBottom
  if (nearBottom) {
    offset = chapter.charCount
  }
  updateIndicators(offset)
}

function onScroll(): void {
  if (suppressScroll || scrollRaf !== 0) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    syncOffsetFromScroll()
  })
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

async function restoreOffset(offset: number): Promise<void> {
  await nextTick()
  await waitForPaint()
  const scroll = scrollRef.value
  const text = chapterTextRef.value
  if (!scroll || !text) return

  suppressScroll = true
  scrollToTextOffset(text, scroll, offset)
  await waitForPaint()
  suppressScroll = false
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
    currentChapter.value = chapter
    currentContent.value = content
    atChapterEnd.value = false

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
    const scrollElement = scrollRef.value
    const textElement = chapterTextRef.value
    if (scrollElement && textElement) {
      suppressScroll = true
      scrollToTextOffset(textElement, scrollElement, offset)
      await waitForPaint()
      suppressScroll = false
    }
    updateIndicators(offset)
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

function scheduleReflowRestore(): void {
  if (reflowTimer) clearTimeout(reflowTimer)
  const offset = lastKnownOffset.value
  reflowTimer = setTimeout(() => {
    reflowTimer = null
    void restoreOffset(offset).then(() => updateIndicators(offset))
  }, 100)
}

function onViewportResize(): void {
  if (loading.value || !currentChapter.value) return
  scheduleReflowRestore()
}

watch(
  [
    () => settingsStore.settings.fontSize,
    () => settingsStore.settings.lineHeight,
    () => settingsStore.settings.pageMargin,
  ],
  () => {
    if (!currentChapter.value || suppressScroll) return
    syncOffsetFromScroll()
    scheduleReflowRestore()
  },
  { flush: 'pre' },
)

watch(tocOpen, async (open) => {
  if (!open) return
  await nextTick()
  const active = tocListRef.value?.querySelector<HTMLElement>('[aria-current="location"]')
  active?.scrollIntoView({ block: 'center' })
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
  void loadReader()
})

onBeforeUnmount(() => {
  disposed = true
  loadSerial += 1
  if (scrollRaf !== 0) cancelAnimationFrame(scrollRaf)
  if (reflowTimer) clearTimeout(reflowTimer)
  window.removeEventListener('resize', onViewportResize)
  window.visualViewport?.removeEventListener('resize', onViewportResize)
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
        ref="scrollRef"
        class="reader-scroll"
        @scroll.passive="onScroll"
      >
        <article class="reader-article">
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

          <footer class="chapter-end">
            <p v-if="isAutoSplit" class="auto-note">
              <AppIcon name="alert" :size="15" />
              此段由 ReadNook 自动分段，原文仍然完整保存。
            </p>
            <div class="chapter-end__actions">
              <button
                type="button"
                class="button"
                :disabled="!canGoPrevious"
                @click="goToAdjacent(-1)"
              >
                <AppIcon name="chevron-left" :size="16" />
                上一章
              </button>
              <button
                type="button"
                class="button button--primary"
                :disabled="!canGoNext"
                @click="goToAdjacent(1)"
              >
                下一章
                <AppIcon name="chevron-right" :size="16" />
              </button>
            </div>
          </footer>
        </article>
      </div>

      <footer class="reader-bottombar">
        <button
          type="button"
          class="reader-tool"
          :disabled="!canGoPrevious"
          @click="goToAdjacent(-1)"
        >
          <AppIcon name="chevron-left" :size="21" />
          <span>上一章</span>
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
          :disabled="!canGoNext"
          @click="goToAdjacent(1)"
        >
          <AppIcon name="chevron-right" :size="21" />
          <span>下一章</span>
        </button>
      </footer>

      <BaseDialog v-model:open="tocOpen" title="目录" variant="sheet">
        <div ref="tocListRef" class="toc-list">
          <button
            v-for="chapter in chapters"
            :key="chapter.chapterKey"
            type="button"
            class="toc-item"
            :class="{
              'is-active': chapter.chapterKey === currentChapter.chapterKey,
            }"
            :aria-current="
              chapter.chapterKey === currentChapter.chapterKey ? 'location' : undefined
            "
            @click="jumpToChapter(chapter.chapterKey)"
          >
            <span class="toc-item__order">{{ chapter.order + 1 }}</span>
            <span class="toc-item__title">{{ chapter.title }}</span>
            <span v-if="chapter.autoSplit" class="toc-item__badge">自动</span>
          </button>
        </div>
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
