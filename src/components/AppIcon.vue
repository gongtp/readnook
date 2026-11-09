<script setup lang="ts">
import { computed } from 'vue'

export type IconName =
  | 'alert'
  | 'arrow-left'
  | 'book'
  | 'bookmark'
  | 'check'
  | 'chevron-left'
  | 'chevron-right'
  | 'clock'
  | 'close'
  | 'download'
  | 'grid'
  | 'list'
  | 'more'
  | 'plus'
  | 'refresh'
  | 'rows'
  | 'search'
  | 'settings'
  | 'share'
  | 'shield'
  | 'trash'
  | 'type'
  | 'upload'
  | 'user'

const props = withDefaults(
  defineProps<{ name: IconName; size?: number }>(),
  { size: 20 },
)

const paths: Record<IconName, string[]> = {
  alert: ['M12 3 21 20H3L12 3Z', 'M12 9v5', 'M12 17h.01'],
  'arrow-left': ['M15 18 9 12l6-6'],
  book: [
    'M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4Z',
    'M20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6V4Z',
  ],
  bookmark: ['M6 4h12v17l-6-4-6 4V4Z'],
  check: ['m4 12 5 5L20 6'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 21h16'],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  rows: ['M4 5h16v4H4z', 'M4 13h16v6H4z'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  settings: [
    'M4 6h16',
    'M4 12h16',
    'M4 18h16',
    'M8 4v4',
    'M16 10v4',
    'M10 16v4',
  ],
  share: ['M12 16V4', 'm8 8 4-4 4 4', 'M5 13v7h14v-7'],
  shield: [
    'M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z',
    'm9 12 2 2 4-4',
  ],
  trash: [
    'M4 7h16',
    'M9 7V4h6v3',
    'm6 7 1 13h10l1-13',
    'M10 11v6',
    'M14 11v6',
  ],
  type: ['M4 6V4h16v2', 'M12 4v16', 'M9 20h6'],
  upload: ['M12 21V9', 'm7 14 5-5 5 5', 'M4 3h16'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
}

const iconPaths = computed(() => paths[props.name])
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(path, index) in iconPaths" :key="index" :d="path" />
  </svg>
</template>
