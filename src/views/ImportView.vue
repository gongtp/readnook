<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { getBookByContentHash } from '@/db/libraryRepository'
import {
  txtFormatAdapter,
  type ImportFormatSession,
} from '@/services/import/txtFormatAdapter'
import { saveImportedBook } from '@/services/import/importBook'
import { useToastStore } from '@/stores/toast'
import type { TxtAnalysis } from '@/types/importer'
import type { Book, EncodingChoice } from '@/types/models'
import { formatBytes } from '@/utils/format'
import { getErrorMessage } from '@/utils/errors'

const router = useRouter()
const toast = useToastStore()

const selectedFile = shallowRef<File | null>(null)
const analysis = ref<TxtAnalysis | null>(null)
const duplicate = ref<Book | null>(null)
const title = ref('')
const author = ref('')
const customTitle = ref(false)
const selectedEncoding = ref<EncodingChoice>('auto')
const busy = ref(false)
const stage = ref('')
const error = ref('')
const dragActive = ref(false)

let session: ImportFormatSession | null = null
let analysisSerial = 0

const canImport = computed(
  () =>
    Boolean(analysis.value) &&
    !duplicate.value &&
    title.value.trim().length > 0 &&
    !busy.value,
)

const encodingLabel = computed(() => {
  const value = selectedEncoding.value
  if (value === 'auto') return '自动检测'
  return value.toUpperCase()
})

const detectedEncodingLabel = computed(() => {
  const detected = analysis.value?.detectedEncoding
  if (!detected) return ''
  return detected.toUpperCase()
})

function defaultTitle(fileName: string): string {
  return fileName.replace(/\.txt$/i, '').trim().slice(0, 120)
}

function resetSession(): void {
  session?.dispose()
  session = null
}

function resetResult(): void {
  analysis.value = null
  duplicate.value = null
  error.value = ''
}

function disposeAndClearFile(): void {
  resetSession()
  selectedFile.value = null
  resetResult()
  title.value = ''
  author.value = ''
  customTitle.value = false
  selectedEncoding.value = 'auto'
  busy.value = false
  stage.value = ''
}

async function runAnalysis(choice: EncodingChoice): Promise<void> {
  if (!session) return
  const serial = ++analysisSerial
  busy.value = true
  stage.value = '读取文件并检测编码'
  error.value = ''
  duplicate.value = null

  try {
    const result = await session.analyze(choice)
    if (serial !== analysisSerial) return
    analysis.value = result
    selectedEncoding.value = choice
    if (!customTitle.value) {
      title.value = defaultTitle(selectedFile.value?.name ?? '')
    }
    duplicate.value = (await getBookByContentHash(result.contentHash)) ?? null
  } catch (analysisError) {
    if (serial !== analysisSerial) return
    resetResult()
    error.value = getErrorMessage(
      analysisError,
      '读取文本失败，请确认文件编码或重新选择文件。',
    )
  } finally {
    if (serial === analysisSerial) {
      busy.value = false
      stage.value = ''
    }
  }
}

async function prepareFile(file: File): Promise<void> {
  resetSession()
  ++analysisSerial
  selectedFile.value = file
  analysis.value = null
  duplicate.value = null
  error.value = ''
  title.value = defaultTitle(file.name)
  author.value = ''
  customTitle.value = false
  selectedEncoding.value = 'auto'

  try {
    session = txtFormatAdapter.createSession(file)
  } catch (fileError) {
    error.value = getErrorMessage(fileError, '无法读取这个文件。')
    return
  }
  await runAnalysis('auto')
}

function handleFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void prepareFile(file)
}

function handleDrop(event: DragEvent): void {
  dragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void prepareFile(file)
}

function handleEncodingChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as EncodingChoice
  if (value === selectedEncoding.value) return
  selectedEncoding.value = value
  void runAnalysis(value)
}

function markTitleCustom(): void {
  customTitle.value = true
}

async function confirmImport(): Promise<void> {
  if (!session || !analysis.value || !selectedFile.value || !canImport.value) {
    return
  }

  busy.value = true
  stage.value = '解析章节并识别分段'
  error.value = ''
  try {
    const parsed = await session.parse(
      analysis.value.token,
      analysis.value.detectedEncoding,
    )
    stage.value = '写入本地书库'
    const book = await saveImportedBook({
      file: selectedFile.value,
      title: title.value,
      author: author.value,
      parsed,
      contentHash: analysis.value.contentHash,
      encoding: analysis.value.detectedEncoding,
    })
    resetSession()
    toast.success(`《${book.title}》已导入，原文与阅读进度都保存在本机。`)
    await router.replace(`/reader/${encodeURIComponent(book.id)}`)
  } catch (importError) {
    error.value = getErrorMessage(
      importError,
      '导入未完成。本地书库未留下不完整的书籍记录，请重试。',
    )
    stage.value = ''
    busy.value = false
  }
}

function cancel(): void {
  resetSession()
  void router.push('/')
}

onBeforeUnmount(() => {
  ++analysisSerial
  resetSession()
})
</script>

<template>
  <main id="main-content" class="page import-page">
    <header class="topbar topbar--sub">
      <button
        type="button"
        class="icon-button"
        aria-label="返回书架"
        @click="cancel"
      >
        <AppIcon name="arrow-left" :size="21" />
      </button>
      <div class="topbar__center">
        <p class="eyebrow">本地导入</p>
        <h1>导入小说</h1>
      </div>
      <span class="topbar__spacer" aria-hidden="true" />
    </header>

    <section
      class="import-dropzone"
      :class="{ 'is-dragging': dragActive }"
      aria-labelledby="import-heading"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <div class="import-dropzone__icon">
        <AppIcon name="upload" :size="30" />
      </div>
      <h2 id="import-heading">选择一份 TXT 小说</h2>
      <p>
        支持 UTF-8、UTF-8 BOM、GBK 和 GB18030。文件上限 30 MB，原始文件会完整保存在本机。
      </p>
      <label class="button button--primary" for="txt-file-input">
        <AppIcon name="book" :size="18" />
        从“文件”选择
      </label>
      <input
        id="txt-file-input"
        class="sr-only"
        type="file"
        accept=".txt,text/plain"
        @change="handleFileInput"
      />
      <small>iPhone 上请使用“文件”App 中的 .txt 文件。暂不支持 EPUB。</small>
    </section>

    <p v-if="error" class="notice notice--error" role="alert">
      <AppIcon name="alert" :size="20" />
      <span>{{ error }}</span>
    </p>

    <div v-if="selectedFile" class="import-workspace">
      <section class="panel file-panel" aria-labelledby="file-summary-heading">
        <div class="file-panel__top">
          <div class="file-panel__glyph">
            <AppIcon name="book" :size="24" />
          </div>
          <div>
            <h2 id="file-summary-heading">{{ selectedFile.name }}</h2>
            <p>{{ formatBytes(selectedFile.size) }} · 本地 TXT</p>
          </div>
          <label class="text-button" for="txt-file-input">重新选择</label>
        </div>

        <div v-if="busy && !analysis" class="inline-loader" role="status">
          <span class="spinner" aria-hidden="true" />
          {{ stage || '正在处理…' }}
        </div>
      </section>

      <section v-if="analysis" class="panel preview-panel" aria-labelledby="encoding-heading">
        <div class="panel__head">
          <div>
            <p class="eyebrow">第 2 步</p>
            <h2 id="encoding-heading">核对编码与正文</h2>
          </div>
          <span
            class="status-pill"
            :class="{ 'status-pill--warn': analysis.encodingUncertain }"
          >
            {{ detectedEncodingLabel }} · {{ Math.round(analysis.encodingConfidence * 100) }}%
          </span>
        </div>

        <p v-if="analysis.encodingUncertain" class="notice notice--warn">
          <AppIcon name="alert" :size="19" />
          <span>编码检测结果不确定。如果预览中出现乱码，请手动切换编码。</span>
        </p>

        <div class="field">
          <label for="encoding-select">文本编码</label>
          <select
            id="encoding-select"
            class="select-control"
            :value="selectedEncoding"
            :disabled="busy"
            @change="handleEncodingChange"
          >
            <option value="auto">自动检测</option>
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
            <option value="gb18030">GB18030</option>
          </select>
          <p class="field__hint">
            当前选择：{{ encodingLabel }} · 共 {{ analysis.decodedChars.toLocaleString('zh-CN') }} 字
          </p>
        </div>

        <div
          v-if="busy"
          class="inline-loader inline-loader--overlay"
          role="status"
        >
          <span class="spinner" aria-hidden="true" />
          {{ stage || '重新解码中…' }}
        </div>

        <div class="text-preview" tabindex="0" aria-label="正文编码预览">
          <pre>{{ analysis.preview }}</pre>
        </div>

        <ul v-if="analysis.warnings.length" class="warning-list">
          <li v-for="warning in analysis.warnings" :key="warning">
            {{ warning }}
          </li>
        </ul>

        <div v-if="duplicate" class="notice notice--warn">
          <AppIcon name="alert" :size="19" />
          <div>
            这本书已经导入过，不会重复添加。
            <RouterLink :to="`/reader/${encodeURIComponent(duplicate.id)}`">
              打开《{{ duplicate.title }}》
            </RouterLink>
          </div>
        </div>

        <div class="field">
          <label for="book-title">书名</label>
          <input
            id="book-title"
            v-model="title"
            type="text"
            maxlength="120"
            autocomplete="off"
            @input="markTitleCustom"
          />
          <p class="field__hint">默认使用文件名，可在导入前修改。</p>
        </div>

        <div class="field">
          <label for="book-author">作者（选填）</label>
          <input
            id="book-author"
            v-model="author"
            type="text"
            maxlength="80"
            autocomplete="off"
            :disabled="busy"
            placeholder="输入作者或笔名"
          />
          <p class="field__hint">填写后会显示在书架和阅读页。</p>
        </div>

        <ol class="import-steps" aria-label="导入说明">
          <li>识别不到章节标题时，会按约 8000 字自动分段并在阅读器中标记；认得出标题的书严格按标题分章。</li>
          <li>确认后会解析章节、保存原文，并在一个事务中写入本地书库。</li>
          <li>失败不会留下不完整的书籍记录。</li>
        </ol>

        <div class="import-actions">
          <button
            type="button"
            class="button"
            :disabled="busy"
            @click="disposeAndClearFile"
          >
            取消选择
          </button>
          <button
            type="button"
            class="button button--primary"
            :disabled="!canImport"
            @click="confirmImport"
          >
            {{ busy ? stage || '正在导入…' : '导入并开始阅读' }}
          </button>
        </div>
      </section>

      <div
        v-else-if="busy"
        class="panel import-waiting"
        role="status"
        aria-live="polite"
      >
        <span class="spinner spinner--large" aria-hidden="true" />
        <p>{{ stage || '正在读取文件…' }}</p>
        <small>大文件可能需要几秒钟，请保持页面打开。</small>
      </div>
    </div>
  </main>
</template>
