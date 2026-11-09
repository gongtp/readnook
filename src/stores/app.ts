import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db/database'
import { useReaderSettingsStore } from '@/stores/readerSettings'
import { getErrorMessage } from '@/utils/errors'

export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const fatalError = ref('')
  const initializing = ref(false)

  async function initialize(): Promise<void> {
    if (ready.value || initializing.value) return
    initializing.value = true
    fatalError.value = ''
    try {
      await db.open()
      await useReaderSettingsStore().load()
      ready.value = true
    } catch (error) {
      fatalError.value = getErrorMessage(
        error,
        '无法打开本地阅读数据库。请确认未禁用网站存储，并尝试重新加载。',
      )
    } finally {
      initializing.value = false
    }
  }

  return { ready, initializing, fatalError, initialize }
})
