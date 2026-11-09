<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { INSTALL_HINT_KEY } from '@/config/app'

const visible = ref(false)

function isStandalone(): boolean {
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return Boolean(displayMode || iosStandalone)
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const isIos = /iP(hone|ad|od)/.test(ua)
  const isWebKit = /WebKit/.test(ua)
  const isOtherBrowser = /CriOS|FxiOS|OPiOS|EdgiOS/.test(ua)
  return isIos && isWebKit && !isOtherBrowser
}

function dismiss(): void {
  visible.value = false
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1')
  } catch {
    // 忽略存储异常。
  }
}

onMounted(() => {
  let dismissed = false
  try {
    dismissed = localStorage.getItem(INSTALL_HINT_KEY) === '1'
  } catch {
    dismissed = false
  }
  visible.value = !dismissed && !isStandalone() && isIosSafari()
})
</script>

<template>
  <aside v-if="visible" class="install-hint" aria-label="添加到主屏幕提示">
    <div class="install-hint__icon">
      <AppIcon name="share" :size="20" />
    </div>
    <div class="install-hint__copy">
      <strong>把 ReadNook 放到主屏幕</strong>
      <p>
        在 Safari 点“分享”按钮，选择“添加到主屏幕”，以后从图标打开导入小说更稳定。
      </p>
    </div>
    <button
      type="button"
      class="icon-button icon-button--quiet"
      aria-label="关闭安装提示"
      @click="dismiss"
    >
      <AppIcon name="close" :size="18" />
    </button>
  </aside>
</template>
