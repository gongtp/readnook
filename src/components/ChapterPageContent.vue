<script setup lang="ts">
import type { ChapterMeta } from '@/types/models'

defineProps<{
  bookTitle: string
  chapter: ChapterMeta
  chapterPercent: number
  bookPercent: number
  content: string
}>()
</script>

<template>
  <header class="chapter-heading">
    <p class="chapter-heading__book">{{ bookTitle }}</p>
    <h2>{{ chapter.title }} <span v-if="chapter.autoSplit" class="auto-badge">自动分段</span></h2>
    <p class="chapter-heading__meta">本章 {{ chapterPercent }}% · 全书 {{ bookPercent }}%</p>
  </header>
  <div class="chapter-text" v-text="content" />
  <p v-if="!content" class="empty-chapter">（本章无正文）</p>
</template>
