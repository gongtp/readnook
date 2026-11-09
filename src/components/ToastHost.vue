<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="item in toast.items"
        :key="item.id"
        class="toast"
        :class="`toast--${item.tone}`"
        :role="item.tone === 'error' ? 'alert' : 'status'"
      >
        <span>{{ item.message }}</span>
        <button
          type="button"
          class="toast__close"
          aria-label="关闭提示"
          @click="toast.dismiss(item.id)"
        >
          <AppIcon name="close" :size="16" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
