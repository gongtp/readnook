import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { THEME_STORAGE_KEY } from '@/config/app'
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
} from '@/domain/readerSettings'
import {
  getReaderSettings,
  saveReaderSettings,
} from '@/db/settingsRepository'
import type { ReaderSettings } from '@/types/models'

const THEME_COLORS: Record<ReaderSettings['theme'], string> = {
  paper: '#f6efe3',
  sepia: '#eaf0e2',
  dark: '#171916',
}

export const useReaderSettingsStore = defineStore('readerSettings', () => {
  const settings = reactive<ReaderSettings>({ ...DEFAULT_READER_SETTINGS })
  const loaded = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let saveChain: Promise<void> = Promise.resolve()

  const fontSize = computed(() => settings.fontSize)
  const lineHeight = computed(() => settings.lineHeight)
  const pageMargin = computed(() => settings.pageMargin)
  const theme = computed(() => settings.theme)

  function applyTheme(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.style.colorScheme = settings.theme === 'dark' ? 'dark' : 'light'
    try {
      localStorage.setItem(THEME_STORAGE_KEY, settings.theme)
    } catch {
      // 忽略隐私模式下的 localStorage 异常。
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLORS[settings.theme])
  }

  function assign(next: ReaderSettings): void {
    settings.theme = next.theme
    settings.fontSize = next.fontSize
    settings.lineHeight = next.lineHeight
    settings.pageMargin = next.pageMargin
    applyTheme()
  }

  async function load(): Promise<void> {
    const stored = await getReaderSettings()
    assign(normalizeReaderSettings(stored))
    loaded.value = true
  }

  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      const snapshot = { ...settings }
      saveChain = saveChain
        .catch(() => undefined)
        .then(() => saveReaderSettings(snapshot))
        .catch((error: unknown) => {
          console.error('ReadNook: 保存阅读设置失败', error)
        })
    }, 220)
  }

  function update(patch: Partial<ReaderSettings>): void {
    assign(normalizeReaderSettings({ ...settings, ...patch }))
    schedulePersist()
  }

  function reset(): void {
    assign({ ...DEFAULT_READER_SETTINGS })
    schedulePersist()
  }

  async function flush(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    await saveReaderSettings({ ...settings })
    await saveChain
  }

  return {
    settings,
    loaded,
    fontSize,
    lineHeight,
    pageMargin,
    theme,
    load,
    update,
    reset,
    flush,
    applyTheme,
  }
})
