<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  READER_FONT_MAX,
  READER_FONT_MIN,
  READER_LINE_HEIGHT_MAX,
  READER_LINE_HEIGHT_MIN,
  READER_MARGIN_MAX,
  READER_MARGIN_MIN,
} from '@/config/app'
import { useReaderSettingsStore } from '@/stores/readerSettings'
import type { ReaderTheme } from '@/types/models'

const store = useReaderSettingsStore()

const themes: Array<{ id: ReaderTheme; name: string; hint: string }> = [
  { id: 'paper', name: '米白', hint: '温暖纸感' },
  { id: 'sepia', name: '护眼', hint: '柔和绿意' },
  { id: 'dark', name: '深色', hint: '夜间阅读' },
]

const fontSize = computed({
  get: () => store.settings.fontSize,
  set: (value: number) => store.update({ fontSize: value }),
})
const lineHeight = computed({
  get: () => store.settings.lineHeight,
  set: (value: number) => store.update({ lineHeight: value }),
})
const pageMargin = computed({
  get: () => store.settings.pageMargin,
  set: (value: number) => store.update({ pageMargin: value }),
})
</script>

<template>
  <div class="reader-settings">
    <section class="setting-group" aria-labelledby="theme-label">
      <div class="setting-group__head">
        <h3 id="theme-label">阅读主题</h3>
        <span>自动保存</span>
      </div>
      <div class="theme-options" role="group" aria-labelledby="theme-label">
        <button
          v-for="option in themes"
          :key="option.id"
          type="button"
          class="theme-choice"
          :class="{ 'is-active': store.settings.theme === option.id }"
          :aria-pressed="store.settings.theme === option.id"
          @click="store.update({ theme: option.id })"
        >
          <span class="theme-choice__swatch" :class="`theme-choice__swatch--${option.id}`" />
          <span class="theme-choice__text">
            <strong>{{ option.name }}</strong>
            <small>{{ option.hint }}</small>
          </span>
          <AppIcon
            v-if="store.settings.theme === option.id"
            name="check"
            :size="16"
          />
        </button>
      </div>
    </section>

    <section class="setting-group" aria-labelledby="font-size-label">
      <div class="setting-group__head">
        <label id="font-size-label" for="font-size">字号</label>
        <output for="font-size">{{ fontSize }} px</output>
      </div>
      <input
        id="font-size"
        v-model.number="fontSize"
        type="range"
        :min="READER_FONT_MIN"
        :max="READER_FONT_MAX"
        step="1"
      />
    </section>

    <section class="setting-group" aria-labelledby="line-height-label">
      <div class="setting-group__head">

        <label id="line-height-label" for="line-height">行距</label>
        <output for="line-height">{{ lineHeight.toFixed(2) }}</output>
      </div>
      <input
        id="line-height"
        v-model.number="lineHeight"
        type="range"
        :min="READER_LINE_HEIGHT_MIN"
        :max="READER_LINE_HEIGHT_MAX"
        step="0.05"
      />
    </section>

    <section class="setting-group" aria-labelledby="page-margin-label">
      <div class="setting-group__head">
        <label id="page-margin-label" for="page-margin">页面边距</label>
        <output for="page-margin">{{ pageMargin }} px</output>
      </div>
      <input
        id="page-margin"
        v-model.number="pageMargin"
        type="range"
        :min="READER_MARGIN_MIN"
        :max="READER_MARGIN_MAX"
        step="1"
      />
    </section>

    <button type="button" class="text-button reader-settings__reset" @click="store.reset()">
      恢复默认阅读外观
    </button>
  </div>
</template>
