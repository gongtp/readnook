<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 46 })
</script>

<template>
  <span
    class="brand-mark"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <svg viewBox="0 0 48 48" focusable="false">
      <path
        class="brand-mark__page"
        d="M8.8 16.6c0-2.2 1.8-4 4-4h7c2.5 0 4.2 1.9 4.2 4.3v18.3c0-1.8-1.4-3.2-3.2-3.2h-8c-2.2 0-4-1.8-4-4V16.6Z"
      />
      <path
        class="brand-mark__page"
        d="M39.2 16.6c0-2.2-1.8-4-4-4h-7c-2.5 0-4.2 1.9-4.2 4.3v18.3c0-1.8 1.4-3.2 3.2-3.2h8c2.2 0 4-1.8 4-4V16.6Z"
      />
      <path class="brand-mark__fold" d="M24 14.2v18.2" />
      <path class="brand-mark__line" d="M13.8 22h6M13.8 26h6M28.2 22h6M28.2 26h6" />
      <path class="brand-mark__ribbon" d="M29.5 11.8v8.6l2.7-1.8 2.7 1.8v-8.6Z" />
    </svg>
  </span>
</template>

<style scoped>
.brand-mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 30%;
  background: linear-gradient(145deg, var(--hero-bg-soft), var(--hero-bg));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--hero-text), transparent 88%),
    0 5px 14px rgba(43, 31, 19, 0.16);
  color: var(--hero-text);
}

.brand-mark svg {
  width: 92%;
  height: 92%;
  overflow: visible;
}

.brand-mark__page {
  fill: var(--hero-text);
}

.brand-mark__fold {
  fill: none;
  stroke: color-mix(in srgb, var(--hero-bg), transparent 48%);
  stroke-linecap: round;
  stroke-width: 1.1;
}

.brand-mark__line {
  fill: none;
  stroke: color-mix(in srgb, var(--hero-bg), transparent 62%);
  stroke-linecap: round;
  stroke-width: 1;
}

.brand-mark__ribbon {
  fill: var(--hero-accent);
}
</style>
