<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  seed: string
}>()

const palettes = ['clay', 'moss', 'ink', 'ochre', 'rose', 'slate'] as const

const palette = computed(() => {
  let hash = 0
  for (const char of props.seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return palettes[hash % palettes.length] ?? 'clay'
})

const glyph = computed(() => {
  const chars = Array.from(props.title.trim()).filter((char) => !/\s/.test(char))
  return chars.slice(0, 2).join('') || '书'
})
</script>

<template>
  <div class="book-cover" :class="`book-cover--${palette}`" aria-hidden="true">
    <span>{{ glyph }}</span>
  </div>
</template>
