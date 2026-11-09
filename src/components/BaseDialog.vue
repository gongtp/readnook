<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { createId } from '@/utils/id'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    ariaLabel?: string
    variant?: 'center' | 'sheet'
  }>(),
  { variant: 'center' },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const titleId = `dialog-title-${createId()}`

function requestClose(): void {
  emit('update:open', false)
}

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    const dialog = dialogRef.value
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  },
  { immediate: true },
)

function handleCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

function handleNativeClose(): void {
  if (props.open) emit('update:open', false)
}

onBeforeUnmount(() => {
  if (dialogRef.value?.open) dialogRef.value.close()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="app-dialog"
      :class="`app-dialog--${variant}`"
      :aria-labelledby="title ? titleId : undefined"
      :aria-label="!title ? ariaLabel : undefined"
      @cancel="handleCancel"
      @close="handleNativeClose"
      @click.self="requestClose"
    >
      <div class="app-dialog__panel">
        <header v-if="title" class="app-dialog__header">
          <h2 :id="titleId">{{ title }}</h2>
          <button
            type="button"
            class="icon-button icon-button--quiet"
            aria-label="关闭"
            @click="requestClose"
          >
            <AppIcon name="close" :size="20" />
          </button>
        </header>
        <div class="app-dialog__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="app-dialog__footer">
          <slot name="footer" />
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>
