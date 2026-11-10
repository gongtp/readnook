/**
 * iOS Safari 从 iOS 10 起会忽略 viewport 里的 user-scalable=no，
 * 双指缩放仍会发生。这里拦截 iOS 专有的 gesture 事件，把缩放彻底关掉；
 * 双击放大由 CSS 的 touch-action: manipulation 处理。
 */
export function installGestureGuards(): void {
  if (typeof document === 'undefined') return

  const preventZoom = (event: Event): void => {
    event.preventDefault()
  }

  const target = document as unknown as EventTarget
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, preventZoom, { passive: false })
  }
}
