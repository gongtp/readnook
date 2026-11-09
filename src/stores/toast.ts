import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createId } from '@/utils/id'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  message: string
  tone: ToastTone
}

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function dismiss(id: string): void {
    items.value = items.value.filter((item) => item.id !== id)
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function show(
    message: string,
    tone: ToastTone = 'info',
    duration = 3_200,
  ): string {
    const id = createId()
    items.value = [...items.value.slice(-2), { id, message, tone }]
    const timer = setTimeout(() => dismiss(id), duration)
    timers.set(id, timer)
    return id
  }

  function success(message: string): void {
    show(message, 'success')
  }

  function error(message: string): void {
    show(message, 'error', 5_000)
  }

  return { items, show, success, error, dismiss }
})
