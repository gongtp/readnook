<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BaseDialog from '@/components/BaseDialog.vue'
import BrandMark from '@/components/BrandMark.vue'
import ReaderSettingsPanel from '@/components/ReaderSettingsPanel.vue'
import { APP_VERSION } from '@/config/app'
import {
  createBackup,
  executeBackupRestore,
  readBackupArchive,
  type BackupBuildResult,
} from '@/services/backupService'
import {
  getStorageStatus,
  requestPersistentStorage,
  type StorageStatus,
} from '@/services/storageService'
import { clearDemoLibrary, seedDemoLibrary } from '@/services/demoService'
import { useReaderSettingsStore } from '@/stores/readerSettings'
import { useToastStore } from '@/stores/toast'
import type { PreparedBackup, RestoreSummary } from '@/types/backup'
import { getErrorMessage } from '@/utils/errors'
import {
  formatBytes,
  formatDateTime,
} from '@/utils/format'

const toast = useToastStore()
const settingsStore = useReaderSettingsStore()

const storageStatus = ref<StorageStatus | null>(null)
const storageLoading = ref(false)
const requestingPersistence = ref(false)

const exportBusy = ref(false)
const exportStage = ref('')
const exportError = ref('')
const exportResult = ref<BackupBuildResult | null>(null)
const downloadUrl = ref('')
const shareSupported = ref(false)

const restoreBusy = ref(false)
const restoreStage = ref('')
const restoreError = ref('')
const preparedBackup = ref<PreparedBackup | null>(null)
const restoreDialogOpen = ref(false)
const restoreSettings = ref(true)
const restoreSummary = ref<RestoreSummary | null>(null)

const demoBusy = ref(false)
const demoStage = ref('')
const demoClearDialogOpen = ref(false)

const usagePercent = computed(() => {
  const usage = storageStatus.value?.usage
  const quota = storageStatus.value?.quota
  if (usage === null || usage === undefined || !quota) return null
  return Math.min(100, Math.round((usage / quota) * 100))
})

const persistenceLabel = computed(() => {
  const status = storageStatus.value
  if (!status) return '正在读取…'
  if (!status.persistenceSupported) return '浏览器不支持持久存储申请'
  if (status.persisted === true) return '已获得持久存储'
  if (status.persisted === false) return '尚未获得持久存储'
  return '状态未知'
})

const backupSummaryTime = computed(() => {
  const createdAt = preparedBackup.value?.summary.createdAt
  if (!createdAt) return ''
  const timestamp = Date.parse(createdAt)
  return Number.isNaN(timestamp) ? createdAt : formatDateTime(timestamp)
})

const themeNames = {
  paper: '米白',
  sepia: '护眼',
  dark: '深色',
} as const

const appearanceSummary = computed(
  () =>
    `${themeNames[settingsStore.settings.theme]} · ${settingsStore.settings.fontSize} px`,
)

const storageSummary = computed(() => {
  const status = storageStatus.value
  if (!status) return '读取中'
  if (!status.supported) return '不可用'
  if (status.usage === null || status.usage === undefined) return '已启用'
  return `${formatBytes(status.usage)} 已用`
})

async function refreshStorage(): Promise<void> {
  storageLoading.value = true
  try {
    storageStatus.value = await getStorageStatus()
  } finally {
    storageLoading.value = false
  }
}

async function requestPersistence(): Promise<void> {
  if (requestingPersistence.value) return
  requestingPersistence.value = true
  try {
    const granted = await requestPersistentStorage()
    if (granted === null) {
      toast.error('当前浏览器不支持申请持久存储，本地数据仍可正常使用。')
    } else if (granted) {
      toast.success('已获得持久存储，浏览器会尽量保留 ReadNook 的本地数据。')
    } else {
      toast.show(
        '浏览器未授予持久存储。数据仍保存在本机，但系统在空间紧张时可能回收，请定期导出备份。',
        'info',
        5_500,
      )
    }
    await refreshStorage()
  } finally {
    requestingPersistence.value = false
  }
}

function revokeDownloadUrl(): void {
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = ''
  }
}

async function exportBackup(): Promise<void> {
  if (exportBusy.value) return
  exportBusy.value = true
  exportError.value = ''
  restoreSummary.value = null
  revokeDownloadUrl()
  exportResult.value = null

  try {
    const result = await createBackup((stage) => {
      exportStage.value = stage
    })
    exportResult.value = result
    downloadUrl.value = URL.createObjectURL(result.blob)
    toast.success('完整备份已生成，请保存到“文件”或其他安全位置。')
  } catch (error) {
    exportError.value = getErrorMessage(
      error,
      '生成备份失败。本地书库没有受到影响。',
    )
  } finally {
    exportBusy.value = false
    exportStage.value = ''
  }
}

function downloadBackup(): void {
  const link = document.createElement('a')
  link.href = downloadUrl.value
  link.download = exportResult.value?.fileName ?? 'ReadNook-backup.zip'
  document.body.append(link)
  link.click()
  link.remove()
}

async function shareBackup(): Promise<void> {
  const result = exportResult.value
  if (!result) return
  const file = new File([result.blob], result.fileName, {
    type: 'application/zip',
  })
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    downloadBackup()
    return
  }

  try {
    await navigator.share({
      files: [file],
      title: 'ReadNook 备份',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    toast.error('分享没有完成，可以改用下载按钮保存备份。')
  }
}

function handleRestoreInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void openRestore(file)
}

async function openRestore(file: File): Promise<void> {
  if (restoreBusy.value) return
  restoreBusy.value = true
  restoreError.value = ''
  restoreSummary.value = null
  restoreStage.value = '读取备份文件'
  try {
    const prepared = await readBackupArchive(file, (stage) => {
      restoreStage.value = stage
    })
    preparedBackup.value = prepared
    restoreSettings.value = prepared.summary.settingsIncluded
    restoreDialogOpen.value = true
  } catch (error) {
    const message = getErrorMessage(
      error,
      '备份校验失败。现有书库没有被修改。',
    )
    restoreError.value = message
    toast.error(message)
  } finally {
    restoreBusy.value = false
    restoreStage.value = ''
  }
}

async function confirmRestore(): Promise<void> {
  const prepared = preparedBackup.value
  if (!prepared || restoreBusy.value) return
  restoreBusy.value = true
  restoreError.value = ''
  try {
    const summary = await executeBackupRestore(prepared, {
      restoreSettings: restoreSettings.value,
      onProgress: (stage) => {
        restoreStage.value = stage
      },
    })
    restoreSummary.value = summary
    restoreDialogOpen.value = false
    preparedBackup.value = null
    await refreshStorage()
    if (summary.settingsRestored) {
      await settingsStore.load()
    }
    if (summary.failures.length > 0) {
      toast.error('部分书籍未能恢复，请查看下方结果。已有书库未被破坏。')
    } else {
      toast.success(
        `恢复完成：新增 ${summary.restoredBooks} 本，跳过重复 ${summary.skippedDuplicates} 本。`,
      )
    }
  } catch (error) {
    restoreError.value = getErrorMessage(
      error,
      '恢复失败。现有书库没有被修改。',
    )
  } finally {
    restoreBusy.value = false
    restoreStage.value = ''
  }
}

async function addDemoBooks(): Promise<void> {
  if (demoBusy.value) return
  demoBusy.value = true
  demoStage.value = '正在准备示例书籍…'
  try {
    const result = await seedDemoLibrary((done, total) => {
      demoStage.value = `正在生成 ${done} / ${total} 本…`
    })
    if (result.added > 0) {
      toast.success(
        `已加入 ${result.added} 本示例书，回到书架即可查看分页。`,
      )
    } else {
      toast.show('示例书籍已经全部存在，可直接回到书架查看。', 'info')
    }
  } catch (error) {
    toast.error(
      getErrorMessage(
        error,
        '生成示例书籍失败。原有书库没有受到影响。',
      ),
    )
  } finally {
    demoBusy.value = false
    demoStage.value = ''
  }
}

async function confirmClearDemoBooks(): Promise<void> {
  if (demoBusy.value) return
  demoBusy.value = true
  demoStage.value = '正在清除示例书籍…'
  try {
    const count = await clearDemoLibrary()
    demoClearDialogOpen.value = false
    toast.success(
      count > 0 ? `已清除 ${count} 本示例书。` : '没有找到可清除的示例书。',
    )
  } catch (error) {
    toast.error(
      getErrorMessage(
        error,
        '清除示例书失败，已有书籍没有被修改。',
      ),
    )
  } finally {
    demoBusy.value = false
    demoStage.value = ''
  }
}

onMounted(() => {
  void refreshStorage()
  if (typeof navigator.canShare === 'function') {
    try {
      const probe = new File(['readnook'], 'probe.txt', { type: 'text/plain' })
      shareSupported.value = navigator.canShare({ files: [probe] })
    } catch {
      shareSupported.value = false
    }
  }
})

onBeforeUnmount(() => {
  revokeDownloadUrl()
})
</script>

<template>
  <main id="main-content" class="page settings-page">
    <header class="profile-header">
      <BrandMark :size="46" />
      <div class="profile-header__copy">
        <h1>设置</h1>
        <p>ReadNook · 离线阅读程序</p>
      </div>
      <span class="local-badge">
        <AppIcon name="shield" :size="13" />
        本地模式
      </span>
    </header>

    <div class="settings-groups">
      <details class="settings-group" aria-labelledby="appearance-heading">
        <summary class="settings-group__summary">
          <span class="settings-group__icon" aria-hidden="true">
            <AppIcon name="type" :size="18" />
          </span>
          <span class="settings-group__copy">
            <span
              id="appearance-heading"
              class="settings-group__title"
              role="heading"
              aria-level="2"
            >
              外观
            </span>
            <span class="settings-group__hint">主题、字号、行距、页边距</span>
          </span>
          <span class="settings-group__value">{{ appearanceSummary }}</span>
          <AppIcon
            class="settings-group__chevron"
            name="chevron-right"
            :size="16"
          />
        </summary>
        <div class="settings-group__body">
          <ReaderSettingsPanel />
        </div>
      </details>

      <details class="settings-group" aria-labelledby="demo-heading">
        <summary class="settings-group__summary">
          <span class="settings-group__icon" aria-hidden="true">
            <AppIcon name="book" :size="18" />
          </span>
          <span class="settings-group__copy">
            <span
              id="demo-heading"
              class="settings-group__title"
              role="heading"
              aria-level="2"
            >
              演示书籍
            </span>
            <span class="settings-group__hint">生成示例书，预览书架效果</span>
          </span>
          <span class="settings-group__value">30 本</span>
          <AppIcon
            class="settings-group__chevron"
            name="chevron-right"
            :size="16"
          />
        </summary>
        <div class="settings-group__body">
          <p class="settings-body-text">
            生成 30 本带不同阅读进度的短篇示例书，用来查看书架筛选、分页和继续阅读效果。示例书只写入当前浏览器，可随时清除。
          </p>
          <div class="button-row">
            <button
              type="button"
              class="button button--primary"
              :disabled="demoBusy || restoreBusy || exportBusy"
              @click="addDemoBooks"
            >
              <AppIcon name="plus" :size="18" />
              {{ demoBusy ? demoStage || '正在生成…' : '生成 30 本示例书' }}
            </button>
            <button
              type="button"
              class="button"
              :disabled="demoBusy || restoreBusy || exportBusy"
              @click="demoClearDialogOpen = true"
            >
              <AppIcon name="trash" :size="17" />
              清除示例书
            </button>
          </div>
          <p class="field__hint">
            示例书按 12 本一批显示，回到书架后继续下滑会自动加载下一页。
          </p>
        </div>
      </details>

      <details class="settings-group" aria-labelledby="storage-heading">
        <summary class="settings-group__summary">
          <span class="settings-group__icon" aria-hidden="true">
            <AppIcon name="shield" :size="18" />
          </span>
          <span class="settings-group__copy">
            <span
              id="storage-heading"
              class="settings-group__title"
              role="heading"
              aria-level="2"
            >
              存储空间
            </span>
            <span class="settings-group__hint">用量、持久存储与数据说明</span>
          </span>
          <span class="settings-group__value">{{ storageSummary }}</span>
          <AppIcon
            class="settings-group__chevron"
            name="chevron-right"
            :size="16"
          />
        </summary>
        <div class="settings-group__body">
          <div class="settings-inline-actions">
            <button
              type="button"
              class="settings-refresh"
              :disabled="storageLoading"
              @click="refreshStorage"
            >
              <AppIcon name="refresh" :size="15" />
              {{ storageLoading ? '刷新中…' : '刷新' }}
            </button>
          </div>

          <div v-if="storageLoading && !storageStatus" class="inline-loader">
            <span class="spinner" aria-hidden="true" />
            正在读取用量…
          </div>
          <template v-else-if="storageStatus">
            <template v-if="storageStatus.supported">
              <dl class="data-list">
                <div>
                  <dt>已使用</dt>
                  <dd>{{ storageStatus.usage !== null ? formatBytes(storageStatus.usage) : '未知' }}</dd>
                </div>
                <div>
                  <dt>浏览器配额</dt>
                  <dd>{{ storageStatus.quota !== null ? formatBytes(storageStatus.quota) : '未知' }}</dd>
                </div>
                <div>
                  <dt>持久存储</dt>
                  <dd>{{ persistenceLabel }}</dd>
                </div>
              </dl>
              <div v-if="usagePercent !== null" class="storage-meter" aria-hidden="true">
                <span :style="{ width: `${usagePercent}%` }" />
              </div>
              <button
                v-if="storageStatus.persistenceSupported && storageStatus.persisted !== true"
                type="button"
                class="button button--small"
                :disabled="requestingPersistence"
                @click="requestPersistence"
              >
                {{ requestingPersistence ? '正在申请…' : '申请持久存储' }}
              </button>
            </template>
            <p v-else class="settings-body-text">
              当前浏览器没有提供存储用量接口。你仍可正常导入和阅读，但请定期备份。
            </p>
          </template>

          <div class="notice notice--info">
            <AppIcon name="shield" :size="19" />
            <span>
              书籍、原文和进度仅保存在当前浏览器的 IndexedDB（ReadNookDB）中。清除网站数据、卸载应用或系统回收空间都可能造成数据丢失。Safari 标签页和主屏幕应用也不一定共享同一份本地数据。
            </span>
          </div>
        </div>
      </details>

      <details class="settings-group" aria-labelledby="backup-heading">
        <summary class="settings-group__summary">
          <span class="settings-group__icon" aria-hidden="true">
            <AppIcon name="download" :size="18" />
          </span>
          <span class="settings-group__copy">
            <span
              id="backup-heading"
              class="settings-group__title"
              role="heading"
              aria-level="2"
            >
              备份与恢复
            </span>
            <span class="settings-group__hint">导出或恢复完整 ZIP 备份</span>
          </span>
          <span class="settings-group__value">ZIP + JSON</span>
          <AppIcon
            class="settings-group__chevron"
            name="chevron-right"
            :size="16"
          />
        </summary>
        <div class="settings-group__body">
          <p class="settings-body-text">
            备份包含小说原文、书名、阅读进度、书签和阅读设置，不包含应用代码。备份文件不受 ReadNook 服务器管理，也不会自动上传。
          </p>

          <div class="button-row">
            <button
              type="button"
              class="button button--primary"
              :disabled="exportBusy || restoreBusy"
              @click="exportBackup"
            >
              <AppIcon name="download" :size="18" />
              {{ exportBusy ? '正在生成…' : '导出完整备份' }}
            </button>
            <label class="button" :class="{ 'is-disabled': restoreBusy }">
              <AppIcon name="upload" :size="18" />
              {{ restoreBusy ? restoreStage || '正在校验…' : '从备份恢复' }}
              <input
                class="sr-only"
                type="file"
                accept=".zip,application/zip"
                :disabled="restoreBusy"
                @change="handleRestoreInput"
              />
            </label>
          </div>

          <div v-if="exportBusy" class="inline-loader" role="status">
            <span class="spinner" aria-hidden="true" />
            {{ exportStage || '正在准备备份…' }}
          </div>
          <p v-if="exportError" class="notice notice--error" role="alert">
            <AppIcon name="alert" :size="19" />
            <span>{{ exportError }}</span>
          </p>
          <div v-if="restoreBusy && !exportBusy" class="inline-loader" role="status">
            <span class="spinner" aria-hidden="true" />
            {{ restoreStage || '正在处理备份…' }}
          </div>

          <div v-if="exportResult" class="backup-result" aria-live="polite">
            <div class="backup-result__head">
              <strong>备份已生成</strong>
              <span>
                {{ formatBytes(exportResult.blob.size) }} ·
                {{ exportResult.manifest.bookCount }} 本书
              </span>
            </div>
            <p class="backup-result__file">{{ exportResult.fileName }}</p>
            <div class="button-row">
              <button
                v-if="shareSupported"
                type="button"
                class="button button--primary button--small"
                @click="shareBackup"
              >
                <AppIcon name="share" :size="17" />
                保存/分享到“文件”
              </button>
              <button type="button" class="button button--small" @click="downloadBackup">
                <AppIcon name="download" :size="17" />
                下载备份
              </button>
            </div>
            <p class="field__hint">
              iPhone 若无下载反应，请使用“保存/分享到文件”，在系统分享面板中选择“存储到文件”。
            </p>
          </div>

          <div class="notice notice--info">
            <AppIcon name="alert" :size="19" />
            <span>
              备份是普通 ZIP 文件，不加密。恢复时按内容摘要跳过重复书籍，不会清空或覆盖现有书库；校验或写入失败不会破坏已有书籍。
            </span>
          </div>

          <section
            v-if="restoreSummary"
            class="restore-result"
            aria-labelledby="restore-result-heading"
          >
            <div class="restore-result__head">
              <h3 id="restore-result-heading">本次恢复</h3>
              <AppIcon name="check" :size="20" />
            </div>
            <dl class="data-list">
              <div>
                <dt>新增书籍</dt>
                <dd>{{ restoreSummary.restoredBooks }} 本</dd>
              </div>
              <div>
                <dt>跳过重复</dt>
                <dd>{{ restoreSummary.skippedDuplicates }} 本</dd>
              </div>
              <div>
                <dt>跳过书签</dt>
                <dd>{{ restoreSummary.skippedBookmarks }} 个</dd>
              </div>
              <div>
                <dt>阅读设置</dt>
                <dd>{{ restoreSummary.settingsRestored ? '已恢复' : '未恢复' }}</dd>
              </div>
            </dl>
            <ul v-if="restoreSummary.warnings.length" class="warning-list">
              <li v-for="warning in restoreSummary.warnings" :key="warning">
                {{ warning }}
              </li>
            </ul>
            <ul
              v-if="restoreSummary.failures.length"
              class="warning-list warning-list--error"
            >
              <li v-for="failure in restoreSummary.failures" :key="failure">
                {{ failure }}
              </li>
            </ul>
          </section>
        </div>
      </details>

      <details class="settings-group" aria-labelledby="install-heading">
        <summary class="settings-group__summary">
          <span class="settings-group__icon" aria-hidden="true">
            <AppIcon name="share" :size="18" />
          </span>
          <span class="settings-group__copy">
            <span
              id="install-heading"
              class="settings-group__title"
              role="heading"
              aria-level="2"
            >
              添加到主屏幕
            </span>
            <span class="settings-group__hint">iPhone Safari 安装步骤</span>
          </span>
          <span class="settings-group__value">Safari</span>
          <AppIcon
            class="settings-group__chevron"
            name="chevron-right"
            :size="16"
          />
        </summary>
        <div class="settings-group__body">
          <ol class="instruction-list">
            <li>用 Safari 打开 <strong>gongtp.github.io/readnook/</strong>。</li>
            <li>点击 Safari 工具栏的“分享”按钮。</li>
            <li>选择“添加到主屏幕”，再从主屏幕图标启动 ReadNook。</li>
            <li>建议从主屏幕应用内导入小说，以获得更稳定的独立存储空间。</li>
          </ol>
          <p class="settings-body-text">
            第一次联网打开并等待离线缓存完成后，ReadNook 才能断网启动。应用会在发现新版本时提示，而不会在阅读过程中自动刷新。
          </p>
        </div>
      </details>

      <details class="settings-group" aria-labelledby="about-heading">
        <summary class="settings-group__summary">
          <span class="settings-group__icon" aria-hidden="true">
            <AppIcon name="book" :size="18" />
          </span>
          <span class="settings-group__copy">
            <span
              id="about-heading"
              class="settings-group__title"
              role="heading"
              aria-level="2"
            >
              关于 ReadNook
            </span>
            <span class="settings-group__hint">版本与数据说明</span>
          </span>
          <span class="settings-group__value">v{{ APP_VERSION }}</span>
          <AppIcon
            class="settings-group__chevron"
            name="chevron-right"
            :size="16"
          />
        </summary>
        <div class="settings-group__body">
          <p class="settings-body-text">
            私人、本地优先的 TXT 小说阅读器。第一版仅支持 TXT，不提供账号、云同步、在线书源或付费功能。阅读位置按“章节标识 + 章节内字符偏移”保存。
          </p>
        </div>
      </details>
    </div>

    <BaseDialog
      v-model:open="restoreDialogOpen"
      title="恢复这个备份？"
      aria-label="确认从备份恢复"
    >
      <template v-if="preparedBackup">
        <dl class="data-list">
          <div>
            <dt>备份时间</dt>
            <dd>{{ backupSummaryTime }}</dd>
          </div>
          <div>
            <dt>备份内书籍</dt>
            <dd>{{ preparedBackup.summary.totalBooks }} 本</dd>
          </div>
          <div>
            <dt>可恢复</dt>
            <dd>{{ preparedBackup.summary.restorableBooks }} 本</dd>
          </div>
          <div>
            <dt>重复跳过</dt>
            <dd>{{ preparedBackup.summary.duplicateBooks }} 本</dd>
          </div>
        </dl>

        <p class="notice notice--info">
          <AppIcon name="shield" :size="19" />
          <span>
            现有书库不会被清空。重复书籍按内容摘要跳过；恢复前会先校验所有原文件的 SHA-256。
          </span>
        </p>

        <label v-if="preparedBackup.summary.settingsIncluded" class="check-field">
          <input v-model="restoreSettings" type="checkbox" />
          <span>同时恢复备份中的阅读主题、字号、行距和页边距</span>
        </label>

        <p v-if="restoreError" class="notice notice--error" role="alert">
          <AppIcon name="alert" :size="19" />
          <span>{{ restoreError }}</span>
        </p>
      </template>

      <template #footer>
        <button
          type="button"
          class="button"
          :disabled="restoreBusy"
          @click="restoreDialogOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="button button--primary"
          :disabled="restoreBusy"
          @click="confirmRestore"
        >
          {{ restoreBusy ? restoreStage || '正在恢复…' : '开始恢复' }}
        </button>
      </template>
    </BaseDialog>

    <BaseDialog
      v-model:open="demoClearDialogOpen"
      title="清除演示书籍？"
      aria-label="确认清除演示书籍"
    >
      <p>
        将删除由“生成示例书”加入的书籍及其章节、阅读进度和书签。你自己导入的书籍不会被删除。
      </p>
      <template #footer>
        <button
          type="button"
          class="button"
          :disabled="demoBusy"
          @click="demoClearDialogOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          class="button button--danger"
          :disabled="demoBusy"
          @click="confirmClearDemoBooks"
        >
          {{ demoBusy ? demoStage || '正在清除…' : '清除示例书' }}
        </button>
      </template>
    </BaseDialog>
  </main>
</template>
