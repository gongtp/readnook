import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { flushReadingProgress } from '@/services/readingProgress'

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'offline'
  | 'error'
  | 'unsupported'

/** 后台自动检查更新的最小间隔。 */
const AUTO_CHECK_INTERVAL = 60 * 60 * 1000
/** update() 之后给浏览器一点时间开始安装新版本。 */
const INSTALL_GRACE_MS = 1_500
/** 最多等待新版本进入 waiting 状态的时间。 */
const INSTALL_WAIT_MS = 8_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForInstalledWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker | null> {
  if (registration.waiting) return registration.waiting
  const deadline = Date.now() + INSTALL_WAIT_MS
  const graceUntil = Date.now() + INSTALL_GRACE_MS

  while (Date.now() < deadline) {
    if (registration.waiting) return registration.waiting
    const worker = registration.installing
    if (!worker) {
      if (Date.now() > graceUntil) return null
      await delay(150)
      continue
    }

    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        worker.removeEventListener('statechange', onChange)
        resolve()
      }
      const onChange = (): void => {
        if (worker.state !== 'installing') finish()
      }
      worker.addEventListener('statechange', onChange)
      setTimeout(finish, 2_000)
    })
    await delay(150)
  }

  return registration.waiting ?? null
}

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const registration = ref<ServiceWorkerRegistration | null>(null)
  const checkStatus = ref<UpdateCheckStatus>('idle')
  const checking = ref(false)
  const applying = ref(false)
  const lastCheckedAt = ref(0)
  const checkError = ref('')

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, swRegistration) {
      registration.value = swRegistration ?? null
    },
  })

  const hasUpdate = computed(
    () => needRefresh.value || checkStatus.value === 'available',
  )

  async function resolveRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (registration.value) return registration.value
    if (!('serviceWorker' in navigator)) return null

    const existing = await navigator.serviceWorker
      .getRegistration()
      .catch(() => null)
    if (existing) {
      registration.value = existing
      return existing
    }

    // 首次打开时注册可能还在进行，等它就绪，避免误报“不支持更新”。
    const ready = await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      delay(4_000).then(() => null),
    ])
    registration.value = ready
    return ready
  }

  /** 手动检查更新：主动拉取新的 Service Worker，并等待它进入等待状态。 */
  async function checkForUpdate(): Promise<UpdateCheckStatus> {
    if (checking.value || applying.value) return checkStatus.value
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      checkStatus.value = 'unsupported'
      return checkStatus.value
    }

    checking.value = true
    checkStatus.value = 'checking'
    checkError.value = ''
    try {
      const activeRegistration = await resolveRegistration()
      if (!activeRegistration) {
        checkStatus.value = 'unsupported'
        return checkStatus.value
      }
      if (activeRegistration.waiting) {
        needRefresh.value = true
        checkStatus.value = 'available'
        return checkStatus.value
      }
      if (!navigator.onLine) {
        checkStatus.value = 'offline'
        return checkStatus.value
      }

      await activeRegistration.update()
      const previousActive = activeRegistration.active
      const waiting = await waitForInstalledWorker(activeRegistration)
      if (waiting) {
        needRefresh.value = true
        checkStatus.value = 'available'
      } else if (
        activeRegistration.active &&
        activeRegistration.active !== previousActive
      ) {
        // 页面还没有被 Service Worker 接管时，新版本会直接激活；
        // 这时重新打开一次就能用上新版本。
        checkStatus.value = 'available'
      } else {
        checkStatus.value = 'latest'
      }
    } catch (error) {
      checkStatus.value = navigator.onLine ? 'error' : 'offline'
      checkError.value = error instanceof Error ? error.message : String(error)
    } finally {
      checking.value = false
      lastCheckedAt.value = Date.now()
    }

    return checkStatus.value
  }

  /** 回到前台时顺手检查一次，不再依赖设置页。 */
  function maybeCheckForUpdate(): void {
    if (document.visibilityState !== 'visible') return
    if (checking.value || applying.value) return
    if (Date.now() - lastCheckedAt.value < AUTO_CHECK_INTERVAL) return
    void checkForUpdate()
  }

  /** 先落盘阅读进度，再让等待中的新版本接管并刷新页面。 */
  async function applyUpdate(): Promise<void> {
    if (applying.value) return
    applying.value = true
    try {
      await flushReadingProgress()
      const activeRegistration = await resolveRegistration()
      if (!activeRegistration?.waiting) {
        window.location.reload()
        return
      }
      await updateServiceWorker(true)
    } catch (error) {
      applying.value = false
      throw error
    }
  }

  return {
    needRefresh,
    hasUpdate,
    checkStatus,
    checking,
    applying,
    lastCheckedAt,
    checkError,
    checkForUpdate,
    maybeCheckForUpdate,
    applyUpdate,
  }
})
