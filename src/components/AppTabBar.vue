<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'

interface TabItem {
  to: string
  label: string
  icon: 'book' | 'plus' | 'settings'
  routeName: string
}

const route = useRoute()

const tabs: TabItem[] = [
  { to: '/', label: '书架', icon: 'book', routeName: 'library' },
  { to: '/import', label: '导入', icon: 'plus', routeName: 'import' },
  { to: '/settings', label: '设置', icon: 'settings', routeName: 'settings' },
]

const activeIndex = computed(() =>
  tabs.findIndex((tab) => tab.routeName === route.name),
)
</script>

<template>
  <nav class="app-tabbar" aria-label="应用主导航">
    <div class="app-tabbar__inner">
      <RouterLink
        v-for="(tab, index) in tabs"
        :key="tab.to"
        :to="tab.to"
        class="app-tabbar__link"
        :class="{ 'is-active': activeIndex === index }"
        :aria-current="activeIndex === index ? 'page' : undefined"
      >
        <span class="app-tabbar__icon" aria-hidden="true">
          <AppIcon :name="tab.icon" :size="21" />
        </span>
        <span class="app-tabbar__label">{{ tab.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
