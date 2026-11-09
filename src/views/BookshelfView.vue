<script setup lang="ts">
import { onMounted, ref } from 'vue'
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

const library = useLibraryStore()
const toast = useToastStore()
const {
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
    <header class="topbar">
      <div>
        <p class="eyebrow">私人书架</p>
        <h1 class="brand-title">ReadNook</h1>
      </div>
      <div class="topbar__actions">
        <RouterLink
          to="/settings"
          class="icon-button"
          aria-label="打开设置与备份"
          title="设置与备份"
        >
          <AppIcon name="settings" :size="21" />
        </RouterLink>
        <RouterLink to="/import" class="button button--primary">
          <AppIcon name="plus" :size="18" />
          <span>导入</span>
        </RouterLink>
      </div>
    </header>

    <p class="privacy-note">
      <AppIcon name="shield" :size="15" />
      书架、原文和阅读进度只保存在这台设备，不会上传。
    </p>

    <InstallHint />

    <section class="library-toolbar" aria-label="书架筛选">
      <div class="search-field">
        <AppIcon name="search" :size="18" class="search-field__icon" />
        <label class="sr-only" for="shelf-search">搜索书名</label>
        <input
          id="shelf-search"
          v-model="search"
          type="search"
          placeholder="搜索书名"
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

    <div v-if="loading" class="shelf-loading" aria-busy="true" aria-label="正在加载书架">
      <div v-for="index in 4" :key="index" class="book-card book-card--skeleton">
        <div class="skeleton skeleton--cover" />
        <div class="book-card__body">
          <div class="skeleton skeleton--title" />
          <div class="skeleton skeleton--meta" />
          <div class="skeleton skeleton--line" />
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
      <h2>书架还是空的</h2>
      <p>
        从“文件”中选择一本 TXT 小说。ReadNook 会在本机解析章节并保存原文，之后可以离线阅读。
      </p>
      <RouterLink to="/import" class="button button--primary">
        <AppIcon name="upload" :size="18" />
        导入第一本小说
      </RouterLink>
    </div>

    <div
      v-else-if="!hasSearchResults"
      class="state-panel state-panel--compact"
      role="status"
    >
      <h2>没有找到匹配的书</h2>
      <p v-if="search">换个关键词，或清除当前搜索。</p>
      <button v-if="search" type="button" class="button" @click="clearSearch">
        清除搜索
      </button>
    </div>

    <ul v-else class="book-list" aria-label="小说列表">
      <li v-for="entry in visibleEntries" :key="entry.book.id" class="book-card">
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
