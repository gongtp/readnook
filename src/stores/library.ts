import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  backfillFrontMatterCounts,
  deleteBookCascade,
  getProgressMap,
  listBooks,
} from '@/db/libraryRepository'
import type { Book, BookshelfEntry } from '@/types/models'
import { toProgressPercent } from '@/domain/progress'
import { getErrorMessage } from '@/utils/errors'

export type ShelfSort = 'recent' | 'imported' | 'title'

export interface ShelfItem extends BookshelfEntry {
  percent: number
}

export const useLibraryStore = defineStore('library', () => {
  const entries = ref<ShelfItem[]>([])
  const loading = ref(false)
  const error = ref('')
  const search = ref('')
  const sort = ref<ShelfSort>('recent')

  const visibleEntries = computed(() => {
    const query = search.value.trim().toLocaleLowerCase('zh-CN')
    const filtered = query
      ? entries.value.filter(
          (entry) =>
            entry.book.title.toLocaleLowerCase('zh-CN').includes(query) ||
            entry.book.sourceFileName
              .toLocaleLowerCase('zh-CN')
              .includes(query),
        )
      : [...entries.value]

    return filtered.sort((a, b) => {
      if (sort.value === 'title') {
        return a.book.title.localeCompare(b.book.title, 'zh-CN')
      }
      if (sort.value === 'imported') {
        return b.book.importedAt - a.book.importedAt
      }
      return (b.book.lastReadAt || b.book.importedAt) -
        (a.book.lastReadAt || a.book.importedAt)
    })
  })

  const hasBooks = computed(() => entries.value.length > 0)
  const hasSearchResults = computed(() => visibleEntries.value.length > 0)

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const books = await listBooks()
      await backfillFrontMatterCounts(books)
      const progressMap = await getProgressMap(books.map((book) => book.id))
      const next = books.map((book) => {
        const progress = progressMap.get(book.id) ?? null
        return {
          book,
          progress,
          percent: progress ? toProgressPercent(progress.bookProgress) : 0,
        }
      })
      entries.value = next.sort(
        (a, b) => (b.book.lastReadAt || b.book.importedAt) - (a.book.lastReadAt || a.book.importedAt),
      )
    } catch (loadError) {
      error.value = getErrorMessage(
        loadError,
        '无法读取本地书架，请检查浏览器存储权限后重试。',
      )
    } finally {
      loading.value = false
    }
  }

  async function remove(book: Book): Promise<void> {
    await deleteBookCascade(book.id)
    entries.value = entries.value.filter((entry) => entry.book.id !== book.id)
  }

  function readerPath(bookId: string): string {
    return `/reader/${encodeURIComponent(bookId)}`
  }

  return {
    entries,
    loading,
    error,
    search,
    sort,
    visibleEntries,
    hasBooks,
    hasSearchResults,
    load,
    remove,
    readerPath,
  }
})
