<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import AppIcon from '@/components/AppIcon.vue'
import { flushReadingProgress } from '@/services/readingProgress'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const dismissed = ref(false)
const updating = ref(false)
let registration: ServiceWorkerRegistration | undefined = undefined
let lastUpdateCheck = Date.now()

const { needRefresh, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisteredSW(_swUrl: string, swRegistration?: ServiceWorkerRegistration) {
    registration = swRegistration
  },
})

watch(needRefresh, (value) => {
  if (value) dismissed.value = false
})

function dismiss(): void {
  dismissed.value = true
}

async function updateNow(): Promise<void> {
  if (updating.value) return
  updating.value = true
  try {
    await flushReadingProgress()
    await updateServiceWorker(true)
  } catch (error) {
    console.error('ReadNook: 更新应用失败', error)
    toast.error('更新没有完成，请检查网络后再试。当前版本仍可继续阅读。')
    updating.value = false
  }
}

function checkForUpdates(): void {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - lastUpdateCheck < 60 * 60 * 1000) return
  lastUpdateCheck = Date.now()
  void registration?.update()
}

onMounted(() => {
  document.addEventListener('visibilitychange', checkForUpdates)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', checkForUpdates)
})
</script>

<template>
  <aside
    v-if="needRefresh && !dismissed"
    class="update-banner"
    role="status"
    aria-live="polite"
  >
    <div class="update-banner__mark">
      <AppIcon name="refresh" :size="19" />
    </div>
    <div class="update-banner__copy">
      <strong>ReadNook 有新版本</strong>
      <p>更新前会先保存阅读进度。更新后本地书库仍然保留。</p>
    </div>
    <div class="update-banner__actions">
      <button type="button" class="text-button" @click="dismiss">稍后</button>
      <button
        type="button"
        class="button button--primary button--small"
        :disabled="updating"
        @click="updateNow"
      >
        {{ updating ? '更新中…' : '更新' }}
      </button>
    </div>
  </aside>
</template>
