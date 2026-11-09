<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/AppIcon.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import BookCover from '@/components/BookCover.vue'
import InstallHint from '@/components/InstallHint.vue'
import { useLibraryStore } from '@/stores/library'
import { useToastStore } from '@/stores/toast'
import type { Book } from '@/types/models'
import {
  formatChapterLocation,
  formatRelativeTime,
} from '@/utils/format'
import { toProgressPercent } from '@/domain/progress'
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
const pageSize = 12
const visibleLimit = ref(pageSize)

const readingCount = computed(
  () =>
    entries.value.filter(
      (entry) => entry.percent > 0 && entry.percent < 100,
    ).length,
)

const finishedCount = computed(
  () => entries.value.filter((entry) => entry.percent >= 100).length,
)

const unreadCount = computed(
  () => entries.value.filter((entry) => entry.percent <= 0).length,
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
  const reading = entries.value.find(
    (entry) => entry.percent > 0 && entry.percent < 100,
  )
  return reading ?? entries.value[0] ?? null
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
  if (shelfFilter.value === 'reading') {
    return list.filter(
      (entry) => entry.percent > 0 && entry.percent < 100,
    )
  }
  if (shelfFilter.value === 'unread') {
    return list.filter((entry) => entry.percent <= 0)
  }
  if (shelfFilter.value === 'finished') {
    return list.filter((entry) => entry.percent >= 100)
  }
  return list
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
  const percent = continueEntry.value?.percent ?? 0
  if (percent >= 100) return '再读一遍'
  return percent > 0 ? '继续阅读' : '从第一本开始'
})

const resumeActionLabel = computed(() => {
  const percent = continueEntry.value?.percent ?? 0
  if (percent >= 100) return '重新打开'
  return percent > 0 ? '接着上次读' : '打开这本书'
})

watch([search, sort, shelfFilter], () => {
  visibleLimit.value = pageSize
})

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

onMounted(() => {
  void library.load()
})
</script>

<template>
  <main id="main-content" class="page bookshelf-page">
    <header class="shelf-header">
      <div class="shelf-header__brand">
        <div class="brand-mark" aria-hidden="true">R</div>
        <div>
          <p class="eyebrow">私人书房</p>
          <h1 class="shelf-title">书架</h1>
        </div>
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
      <div class="shelf-skeleton-stats" />
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
                {{ formatChapterLocation(continueEntry.progress?.chapterIndex ?? 0, continueEntry.book.chapterCount) }}
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

      <section class="shelf-stats" aria-label="书架概览">
        <div class="shelf-stat">
          <span class="shelf-stat__label">藏书</span>
          <strong>{{ entries.length }}</strong>
          <span class="shelf-stat__unit">本</span>
        </div>
        <div class="shelf-stat">
          <span class="shelf-stat__label">在读</span>
          <strong>{{ readingCount }}</strong>
          <span class="shelf-stat__unit">本</span>
        </div>
        <div class="shelf-stat">
          <span class="shelf-stat__label">已读完</span>
          <strong>{{ finishedCount }}</strong>
          <span class="shelf-stat__unit">本</span>
        </div>
        <div class="shelf-stats__caption">
          共 {{ totalCharsLabel }} · 全部保存在本机
        </div>
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
            {{ filteredEntries.length }} 本
            <span v-if="search" aria-hidden="true">· 匹配“{{ search }}”</span>
          </p>
        </div>
        <RouterLink to="/import" class="text-button shelf-add">
          <AppIcon name="plus" :size="16" />
          添加
        </RouterLink>
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
              type="button"
              class="book-tile__delete"
              :aria-label="`删除《${entry.book.title}》`"
              @click="requestDelete(entry.book)"
            >
              <AppIcon name="trash" :size="14" />
            </button>
            <span v-if="entry.percent >= 100" class="book-tile__state">读完</span>
          </div>

          <h2 class="book-card__title book-tile__title">
            <RouterLink :to="library.readerPath(entry.book.id)">
              {{ entry.book.title }}
            </RouterLink>
          </h2>
          <p class="book-tile__meta">
            {{ formatChapterLocation(entry.progress?.chapterIndex ?? 0, entry.book.chapterCount) }}
          </p>
          <div
            class="progress-track book-tile__track"
            role="progressbar"
            :aria-label="`《${entry.book.title}》阅读进度`"
            :aria-valuenow="toProgressPercent(entry.progress?.bookProgress ?? 0)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span :style="{ width: `${entry.percent}%` }" />
          </div>
          <div class="book-tile__foot">
            <span class="book-card__percent">
              {{ entry.percent > 0 ? `已读 ${entry.percent}%` : '尚未开始' }}
            </span>
            <span class="book-tile__time">
              {{ formatRelativeTime(entry.book.lastReadAt || entry.book.importedAt) }}
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
                  <span>{{ formatChapterLocation(entry.progress?.chapterIndex ?? 0, entry.book.chapterCount) }}</span>
                </p>
              </div>
              <button
                type="button"
                class="icon-button icon-button--quiet book-card__delete"
                :aria-label="`删除《${entry.book.title}》`"
                @click="requestDelete(entry.book)"
              >
                <AppIcon name="trash" :size="18" />
              </button>
            </div>

            <div
              class="progress-track"
              role="progressbar"
              :aria-label="`《${entry.book.title}》阅读进度`"
              :aria-valuenow="toProgressPercent(entry.progress?.bookProgress ?? 0)"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :style="{ width: `${entry.percent}%` }" />
            </div>

            <div class="book-card__foot">
              <span class="book-card__percent">
                {{ entry.percent > 0 ? `已读 ${entry.percent}%` : '尚未开始' }}
              </span>
              <RouterLink
                :to="library.readerPath(entry.book.id)"
                class="book-card__continue"
              >
                {{ entry.percent > 0 ? '继续阅读' : '开始阅读' }}
                <AppIcon name="chevron-right" :size="15" />
              </RouterLink>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="hasMoreEntries" class="shelf-loadmore">
        <button
          type="button"
          class="button"
          @click="visibleLimit += pageSize"
        >
          显示更多
          <span class="shelf-loadmore__count">
            还有 {{ remainingEntries }} 本
          </span>
        </button>
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
