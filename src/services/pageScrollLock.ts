/**
 * iOS 上只给 html/body 设 overflow: hidden 并不总能挡住橡皮筋滚动，
 * 这里用「固定 body + 记录滚动位置」的方式把页面真正锁住，
 * 关闭弹层时再恢复原来的位置。
 */
let lockCount = 0
let savedScrollY = 0

export function lockPageScroll(): void {
  if (typeof document === 'undefined') return
  lockCount += 1
  if (lockCount > 1) return

  savedScrollY = window.scrollY
  document.documentElement.style.setProperty(
    '--dialog-scroll-top',
    `-${savedScrollY}px`,
  )
  document.documentElement.classList.add('dialog-open')
}

export function unlockPageScroll(): void {
  if (typeof document === 'undefined') return
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount > 0) return

  document.documentElement.classList.remove('dialog-open')
  document.documentElement.style.removeProperty('--dialog-scroll-top')
  window.scrollTo(0, savedScrollY)
}
