<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/AppIcon.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import BookCover from '@/components/BookCover.vue'
import InstallHint from '@/components/InstallHint.vue'
import { useLibraryStore, type ShelfItem } from '@/stores/library'
import { useToastStore } from '@/stores/toast'
import type { Book } from '@/types/models'
import {
  formatChapterLocation,
  formatRelativeTime,
} from '@/utils/format'
import { getErrorMessage } from '@/utils/errors'

type ShelfFilter = 'all' | 'reading' | 'unread' | 'finished'
type ShelfView = 'grid' | 'list'

const library = useLibraryStore()
const toast = useToastStore()
const {
  entries,
  visibleEntries,
  loading,
  error,
  search,
  sort,
  hasBooks,
  hasSearchResults,
} = storeToRefs(library)

const deleteDialogOpen = ref(false)
const deleteTarget = ref<Book | null>(null)
const deleting = ref(false)
const shelfFilter = ref<ShelfFilter>('all')
const viewMode = ref<ShelfView>('grid')
const manageMode = ref(false)
const pageSize = 12
const visibleLimit = ref(pageSize)
const loadMoreSentinel = ref<HTMLElement | null>(null)
const autoLoadMargin = 320
let autoLoadAllowed = false
let lastScrollY = 0
const loadMoreObserver =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entries) => {
          if (
            autoLoadAllowed &&
            entries.some((entry) => entry.isIntersecting)
          ) {
            loadMore()
          }
        },
        { rootMargin: `${autoLoadMargin}px 0px` },
      )

const readingCount = computed(
  () =>
    entries.value.filter(
      (entry) => entry.status === 'reading',
    ).length,
)

const finishedCount = computed(
  () => entries.value.filter((entry) => entry.status === 'finished').length,
)

const unreadCount = computed(
  () => entries.value.filter((entry) => entry.status === 'unread').length,
)

const totalCharsLabel = computed(() => {
  const chars = entries.value.reduce(
    (sum, entry) => sum + entry.book.totalChars,
    0,
  )
  if (chars >= 10000) {
    const value = chars / 10000
    return `${value.toFixed(value >= 100 ? 0 : 1)} 万字`
  }
  return `${chars.toLocaleString('zh-CN')} 字`
})

const continueEntry = computed(() => {
  let latest: ShelfItem | null = null
  let latestTime = 0
  for (const entry of entries.value) {
    const openedAt = entry.book.lastOpenedAt ??
      (entry.status === 'unread' ? 0 : entry.book.lastReadAt)
    if (openedAt > latestTime) {
      latestTime = openedAt
      latest = entry
    }
  }
  return latest ?? entries.value[0] ?? null
})

const filterOptions = computed(
  () =>
    [
      { value: 'all' as const, label: '全部', count: entries.value.length },
      { value: 'reading' as const, label: '在读', count: readingCount.value },
      { value: 'unread' as const, label: '未读', count: unreadCount.value },
      {
        value: 'finished' as const,
        label: '已读完',
        count: finishedCount.value,
      },
    ] satisfies Array<{ value: ShelfFilter; label: string; count: number }>,
)

const activeFilterLabel = computed(
  () =>
    filterOptions.value.find((option) => option.value === shelfFilter.value)
      ?.label ?? '全部',
)

const filteredEntries = computed(() => {
  const list = visibleEntries.value
  const filter = shelfFilter.value
  return filter === 'all' ? list : list.filter(entry => entry.status === filter)
})

const displayedEntries = computed(() =>
  filteredEntries.value.slice(0, visibleLimit.value),
)

const hasMoreEntries = computed(
  () => visibleLimit.value < filteredEntries.value.length,
)

const remainingEntries = computed(
  () => filteredEntries.value.length - visibleLimit.value,
)

const resumeLabel = computed(() => {
  const status = continueEntry.value?.status
  return status === 'unread' ? '从第一本开始' : '继续阅读'
})

const resumeActionLabel = computed(() => {
  const status = continueEntry.value?.status
  return status === 'unread' ? '打开这本书' : '接着上次读'
})

watch([search, sort, shelfFilter], () => {
  autoLoadAllowed = false
  manageMode.value = false
  visibleLimit.value = pageSize
})

watch(
  loadMoreSentinel,
  (element, previous) => {
    if (previous) loadMoreObserver?.unobserve(previous)
    if (element) loadMoreObserver?.observe(element)
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleShelfScroll)
  loadMoreObserver?.disconnect()
})

function loadMore(): void {
  if (!hasMoreEntries.value) return
  autoLoadAllowed = false
  visibleLimit.value += pageSize
}

function handleShelfScroll(): void {
  const currentScrollY = window.scrollY
  if (currentScrollY <= lastScrollY) {
    lastScrollY = currentScrollY
    return
  }
  lastScrollY = currentScrollY
  if (autoLoadAllowed) return

  autoLoadAllowed = true
  const sentinel = loadMoreSentinel.value
  if (
    sentinel &&
    sentinel.getBoundingClientRect().top <=
      window.innerHeight + autoLoadMargin
  ) {
    loadMore()
  }
}

function requestDelete(book: Book): void {
  deleteTarget.value = book
  deleteDialogOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const book = deleteTarget.value
  if (!book || deleting.value) return
  deleting.value = true
  try {
    await library.remove(book)
    toast.success(`已删除《${book.title}》及其章节、进度与书签。`)
    deleteDialogOpen.value = false
    deleteTarget.value = null
  } catch (deleteError) {
    toast.error(
      getErrorMessage(
        deleteError,
        '删除失败，本地书库未发生变化，请稍后重试。',
      ),
    )
  } finally {
    deleting.value = false
  }
}

function clearSearch(): void {
  search.value = ''
}

function numberedChapterCount(book: Book): number {
  return Math.max(book.chapterCount - (book.frontMatterCount ?? 0), 0)
}

function bookLocation(entry: ShelfItem): string {
  return formatChapterLocation(
    entry.progress?.chapterIndex ?? 0,
    entry.book.chapterCount,
    entry.book.frontMatterCount ?? 0,
  )
}

function chapterLabel(entry: ShelfItem): string {
  if (entry.status === 'unread') {
    const total = numberedChapterCount(entry.book)
    return total > 0 ? `共 ${total} 章` : '暂无章节'
  }
  return bookLocation(entry)
}

function progressLabel(entry: ShelfItem): string {
  if (entry.status === 'finished') return '已读完'
  if (entry.status === 'reading' && entry.percent === 0) return '在读'
  if (entry.status === 'reading') return `已读 ${entry.percent}%`
  return '未开始'
}

onMounted(() => {
  lastScrollY = window.scrollY
  window.addEventListener('scroll', handleShelfScroll, { passive: true })
  void library.load()
})
</script>

<template>
  <main id="main-content" class="page bookshelf-page">
    <header class="shelf-header">
      <div class="shelf-header__copy">
        <h1 class="shelf-title">书架</h1>
        <p class="shelf-subtitle">
          {{ entries.length }} 本
          <span aria-hidden="true">·</span>
          在读 {{ readingCount }}
          <span aria-hidden="true">·</span>
          共 {{ totalCharsLabel }}
        </p>
      </div>
      <div class="topbar__actions shelf-header__actions">
        <span class="local-badge">
          <AppIcon name="shield" :size="13" />
          仅本机
        </span>
        <RouterLink
          to="/settings"
          class="icon-button"
          aria-label="打开设置与备份"
          title="设置与备份"
        >
          <AppIcon name="settings" :size="21" />
        </RouterLink>
      </div>
    </header>

    <InstallHint />

    <div v-if="loading" class="shelf-loading" aria-busy="true" aria-label="正在加载书架">
      <div class="shelf-skeleton-hero" />
      <div class="shelf-skeleton-grid">
        <div v-for="index in 6" :key="index" class="book-tile book-card book-card--skeleton">
          <div class="skeleton skeleton--tile" />
          <div class="skeleton skeleton--title" />
          <div class="skeleton skeleton--meta" />
        </div>
      </div>
    </div>

    <div v-else-if="error" class="state-panel state-panel--error" role="alert">
      <AppIcon name="alert" :size="26" />
      <h2>书架读取失败</h2>
      <p>{{ error }}</p>
      <button type="button" class="button" @click="library.load()">重试</button>
    </div>

    <div v-else-if="!hasBooks" class="state-panel state-panel--empty">
      <div class="empty-mark" aria-hidden="true">
        <AppIcon name="book" :size="38" />
      </div>
      <h2>把第一本小说带进来</h2>
      <p>
        从“文件”中选择一本 TXT 小说。ReadNook 会在本机解析章节并保存原文，之后可以离线阅读。
      </p>
      <RouterLink to="/import" class="button button--primary">
        <AppIcon name="upload" :size="18" />
        导入第一本小说
      </RouterLink>
      <div class="empty-features" aria-label="应用特点">
        <span><AppIcon name="shield" :size="14" /> 不上传</span>
        <span><AppIcon name="clock" :size="14" /> 自动续读</span>
        <span><AppIcon name="bookmark" :size="14" /> 本地书签</span>
      </div>
    </div>

    <template v-else>
      <section
        v-if="continueEntry"
        class="resume-card"
        :aria-label="resumeLabel"
      >
        <RouterLink
          :to="library.readerPath(continueEntry.book.id)"
          class="resume-card__link"
        >
          <div class="resume-card__head">
            <span class="resume-card__eyebrow">
              <span class="resume-card__dot" aria-hidden="true" />
              {{ resumeLabel }}
            </span>
            <span class="resume-card__percent">
              {{ continueEntry.percent }}%
            </span>
          </div>

          <div class="resume-card__body">
            <BookCover
              :title="continueEntry.book.title"
              :seed="continueEntry.book.id"
              class="resume-card__cover"
            />
            <div class="resume-card__copy">
              <h2>{{ continueEntry.book.title }}</h2>
              <p>
                {{ bookLocation(continueEntry) }}
                <span aria-hidden="true">·</span>
                {{ formatRelativeTime(continueEntry.book.lastReadAt || continueEntry.book.importedAt) }}
              </p>
              <div
                class="resume-card__track"
                role="progressbar"
                :aria-label="`《${continueEntry.book.title}》阅读进度`"
                :aria-valuenow="continueEntry.percent"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span :style="{ width: `${continueEntry.percent}%` }" />
              </div>
              <span class="resume-card__cta">
                {{ resumeActionLabel }}
                <AppIcon name="chevron-right" :size="15" />
              </span>
            </div>
            <span class="resume-card__arrow" aria-hidden="true">
              <AppIcon name="chevron-right" :size="18" />
            </span>
          </div>
        </RouterLink>
      </section>

      <section class="library-toolbar" aria-label="书架筛选">
        <div class="search-field">
          <AppIcon name="search" :size="18" class="search-field__icon" />
          <label class="sr-only" for="shelf-search">搜索书名</label>
          <input
            id="shelf-search"
            v-model="search"
            type="search"
            placeholder="搜索书名或文件名"
            autocomplete="off"
            enterkeyhint="search"
          />
          <button
            v-if="search"
            type="button"
            class="search-field__clear"
            aria-label="清除搜索"
            @click="clearSearch"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <label class="sr-only" for="shelf-sort">排序方式</label>
        <select id="shelf-sort" v-model="sort" class="select-control">
          <option value="recent">最近阅读</option>
          <option value="imported">最近导入</option>
          <option value="title">书名</option>
        </select>
      </section>

      <div class="shelf-filterbar">
        <div class="filter-chips" role="group" aria-label="按阅读状态筛选">
          <button
            v-for="option in filterOptions"
            :key="option.value"
            type="button"
            class="filter-chip"
            :class="{ 'is-active': shelfFilter === option.value }"
            :aria-pressed="shelfFilter === option.value"
            @click="shelfFilter = option.value"
          >
            {{ option.label }}
            <span>{{ option.count }}</span>
          </button>
        </div>

        <div class="view-toggle" role="group" aria-label="书架布局">
          <button
            type="button"
            class="view-toggle__button"
            :class="{ 'is-active': viewMode === 'grid' }"
            :aria-pressed="viewMode === 'grid'"
            aria-label="封面网格视图"
            title="封面网格"
            @click="viewMode = 'grid'"
          >
            <AppIcon name="grid" :size="17" />
          </button>
          <button
            type="button"
            class="view-toggle__button"
            :class="{ 'is-active': viewMode === 'list' }"
            :aria-pressed="viewMode === 'list'"
            aria-label="列表视图"
            title="列表"
            @click="viewMode = 'list'"
          >
            <AppIcon name="rows" :size="17" />
          </button>
        </div>
      </div>

      <div class="shelf-section-head">
        <div>
          <h2>{{ activeFilterLabel }}书籍</h2>
          <p>
            <template v-if="hasMoreEntries">
              已显示 {{ displayedEntries.length }} /
              {{ filteredEntries.length }} 本
            </template>
            <template v-else>{{ filteredEntries.length }} 本</template>
            <span v-if="search" aria-hidden="true">· 匹配“{{ search }}”</span>
          </p>
        </div>
        <div class="shelf-section-actions">
          <RouterLink
            to="/import"
            class="shelf-action"
            aria-label="添加书籍"
          >
            <AppIcon name="plus" :size="15" />
            添加
          </RouterLink>
          <button
            v-if="filteredEntries.length > 0"
            type="button"
            class="shelf-manage"
            :class="{ 'is-active': manageMode }"
            :aria-pressed="manageMode"
            @click="manageMode = !manageMode"
          >
            {{ manageMode ? '完成' : '管理' }}
          </button>
        </div>
      </div>

      <div
        v-if="!hasSearchResults || filteredEntries.length === 0"
        class="state-panel state-panel--compact"
        role="status"
      >
        <h2>{{ search ? '没有找到匹配的书' : '这个分类还没有书' }}</h2>
        <p v-if="search">换个关键词，或清除当前搜索。</p>
        <p v-else>切换“全部”看看，或导入一本新的 TXT 小说。</p>
        <button
          v-if="search"
          type="button"
          class="button"
          @click="clearSearch"
        >
          清除搜索
        </button>
        <button
          v-else
          type="button"
          class="button"
          @click="shelfFilter = 'all'"
        >
          查看全部
        </button>
      </div>

      <div
        v-else-if="viewMode === 'grid'"
        class="book-grid"
        :class="{ 'is-managing': manageMode }"
        aria-label="小说列表"
      >
        <article
          v-for="entry in displayedEntries"
          :key="entry.book.id"
          class="book-tile book-card"
        >
          <div class="book-tile__visual">
            <RouterLink
              :to="library.readerPath(entry.book.id)"
              class="book-tile__cover-link"
              :aria-label="`打开《${entry.book.title}》`"
            >
              <BookCover
                :title="entry.book.title"
                :seed="entry.book.id"
                class="book-tile__cover"
              />
            </RouterLink>
            <button
              v-if="manageMode"
              type="button"
              class="book-tile__delete"
              :aria-label="`删除《${entry.book.title}》`"
              @click="requestDelete(entry.book)"
            >
              <AppIcon name="trash" :size="14" />
            </button>
            <span v-if="entry.status === 'finished'" class="book-tile__state">读完</span>
          </div>

          <h2 class="book-card__title book-tile__title">
            <RouterLink :to="library.readerPath(entry.book.id)">
              {{ entry.book.title }}
            </RouterLink>
          </h2>
          <p class="book-tile__meta">{{ chapterLabel(entry) }}</p>
          <div
            v-if="entry.status !== 'unread'"
            class="progress-track book-tile__track"
            role="progressbar"
            :aria-label="`《${entry.book.title}》阅读进度`"
            :aria-valuenow="entry.percent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span :style="{ width: `${entry.percent}%` }" />
          </div>
          <div
            class="book-tile__foot"
            :class="{ 'book-tile__foot--empty': entry.status === 'unread' }"
          >
            <span
              class="book-card__percent"
              :class="{ 'book-card__percent--done': entry.status === 'finished' }"
            >
              {{ progressLabel(entry) }}
            </span>
          </div>
        </article>
      </div>

      <ul v-else class="book-list" aria-label="小说列表">
        <li v-for="entry in displayedEntries" :key="entry.book.id" class="book-card">
          <BookCover :title="entry.book.title" :seed="entry.book.id" />
          <div class="book-card__body">
            <div class="book-card__head">
              <div class="book-card__titles">
                <h2 class="book-card__title">
                  <RouterLink :to="library.readerPath(entry.book.id)">
                    {{ entry.book.title }}
                  </RouterLink>
                </h2>
                <p class="book-card__meta">
                  <span>{{ formatRelativeTime(entry.book.lastReadAt || entry.book.importedAt) }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ chapterLabel(entry) }}</span>
                </p>
              </div>
              <button
                v-if="manageMode"
                type="button"
                class="icon-button icon-button--quiet book-card__delete"
                :aria-label="`删除《${entry.book.title}》`"
                @click="requestDelete(entry.book)"
              >
                <AppIcon name="trash" :size="18" />
              </button>
            </div>

            <div
              v-if="entry.status !== 'unread'"
              class="progress-track"
              role="progressbar"
              :aria-label="`《${entry.book.title}》阅读进度`"
              :aria-valuenow="entry.percent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :style="{ width: `${entry.percent}%` }" />
            </div>

            <div class="book-card__foot">
              <span
                class="book-card__percent"
                :class="{ 'book-card__percent--done': entry.status === 'finished' }"
              >
                {{ progressLabel(entry) }}
              </span>
              <RouterLink
                :to="library.readerPath(entry.book.id)"
                class="book-card__continue"
              >
                {{ entry.status !== 'unread' ? '继续阅读' : '开始阅读' }}
                <AppIcon name="chevron-right" :size="15" />
              </RouterLink>
            </div>
          </div>
        </li>
      </ul>

      <div
        v-if="hasMoreEntries"
        ref="loadMoreSentinel"
        class="shelf-loadmore"
        aria-live="polite"
      >
        <button
          type="button"
          class="button"
          @click="loadMore"
        >
          显示更多
          <span class="shelf-loadmore__count">
            还有 {{ remainingEntries }} 本
          </span>
        </button>
        <p class="shelf-loadmore__hint">继续下滑会自动加载</p>
      </div>
    </template>

    <BaseDialog
      v-model:open="deleteDialogOpen"
      title="删除这本书？"
      aria-label="删除书籍确认"
    >
      <p>
        将永久删除<strong>《{{ deleteTarget?.title }}》</strong
        >的原始文件、章节、阅读进度和全部书签。
      </p>
      <p class="muted">这个操作无法撤销，建议先在设置页导出备份。</p>
      <template #footer>
        <button type="button" class="button" @click="deleteDialogOpen = false">
          取消
        </button>
        <button
          type="button"
          class="button button--danger"
          :disabled="deleting"
          @click="confirmDelete"
        >
          {{ deleting ? '正在删除…' : '删除' }}
        </button>
      </template>
    </BaseDialog>
  </main>
</template>
