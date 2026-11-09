<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppTabBar from '@/components/AppTabBar.vue'
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const route = useRoute()

const showTabBar = computed(() => route.name !== 'reader')

function reload(): void {
  window.location.reload()
}

onMounted(() => {
  void app.initialize()
})
</script>

<template>
  <a v-if="app.ready" class="skip-link" href="#main-content">跳到主要内容</a>

  <div v-if="!app.ready && !app.fatalError" class="app-boot">
    <div class="app-boot__mark" aria-hidden="true">R</div>
    <p class="app-boot__name">ReadNook</p>
    <p class="app-boot__hint">正在整理你的私人书架…</p>
  </div>

  <div v-else-if="app.fatalError" class="app-fatal">
    <div class="app-fatal__card">
      <h1>暂时无法打开书库</h1>
      <p>{{ app.fatalError }}</p>
      <p class="muted">
        ReadNook 的书籍和进度只保存在当前浏览器。请确认没有禁用网站存储，并尝试重新加载。
      </p>
      <button type="button" class="button button--primary" @click="reload">
        重新加载
      </button>
    </div>
  </div>

  <RouterView v-else />
  <AppTabBar v-if="app.ready && showTabBar" />
  <PwaUpdatePrompt v-if="app.ready" />
  <ToastHost />
</template>
