<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { lockPageScroll, unlockPageScroll } from '@/services/pageScrollLock'
import { createId } from '@/utils/id'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    ariaLabel?: string
    variant?: 'center' | 'sheet'
    fixedHeight?: boolean
  }>(),
  { variant: 'center', fixedHeight: false },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
const titleId = `dialog-title-${createId()}`

let scrollLocked = false

function applyScrollLock(shouldLock: boolean): void {
  if (shouldLock === scrollLocked) return
  scrollLocked = shouldLock
  if (shouldLock) lockPageScroll()
  else unlockPageScroll()
}

function requestClose(): void {
  emit('update:open', false)
}

/**
 * 弹层里的内容只允许纵向滚动。iOS 在弹出瞬间会因为聚焦或布局抖动
 * 把滚动容器横向挪动几个像素，表现为整块列表被推到左边；这里强制归零。
 */
function resetHorizontalScroll(): void {
  const body = bodyRef.value
  if (body && body.scrollLeft !== 0) body.scrollLeft = 0
}
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    const dialog = dialogRef.value
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      applyScrollLock(true)
      resetHorizontalScroll()
      requestAnimationFrame(resetHorizontalScroll)
    } else if (!open && dialog.open) {
      dialog.close()
      applyScrollLock(false)
    }
  },
  { immediate: true },
)

function handleCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

function handleNativeClose(): void {
  applyScrollLock(false)
  if (props.open) emit('update:open', false)
}

onBeforeUnmount(() => {
  if (dialogRef.value?.open) dialogRef.value.close()
  applyScrollLock(false)
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="app-dialog"
      :class="[`app-dialog--${variant}`, { 'app-dialog--fixed': fixedHeight }]"
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
        <div v-if="$slots.subheader" class="app-dialog__subheader">
          <slot name="subheader" />
        </div>
        <div ref="bodyRef" class="app-dialog__body" @scroll="resetHorizontalScroll">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="app-dialog__footer">
          <slot name="footer" />
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>
