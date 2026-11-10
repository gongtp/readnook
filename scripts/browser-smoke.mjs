import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifactsDir = join(root, 'artifacts', 'browser-smoke')
const fixturePath = join(root, 'tests', 'fixtures', 'sample-novel.txt')
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const checks = []
const consoleErrors = []
const screenshots = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
  checks.push(message)
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env['PROGRAMFILES(X86)']
      ? join(
          process.env['PROGRAMFILES(X86)'],
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        )
      : null,
    process.env['PROGRAMFILES(X86)']
      ? join(
          process.env['PROGRAMFILES(X86)'],
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe',
        )
      : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  try {
    const bundled = chromium.executablePath()
    if (bundled && existsSync(bundled)) return bundled
  } catch {
    // Playwright browsers are optional; a system Chrome is enough.
  }

  throw new Error(
    '未找到 Chrome/Edge。请设置 CHROME_PATH，或安装 Playwright 的 Chromium。',
  )
}

async function getFreePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 4173
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForServer(url, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`预览服务器未在 ${timeoutMs / 1000} 秒内启动：${url}`)
}

async function main() {
  await mkdir(artifactsDir, { recursive: true })
  await stat(fixturePath)

  const currentBuild = await stat(join(root, 'dist', 'index.html'))
  assert(currentBuild.isFile(), '生产构建 dist/index.html 存在')

  const chromePath = findChrome()
  const port = await getFreePort()
  const origin = `http://127.0.0.1:${port}`
  const appUrl = `${origin}/readnook/`
  const backupPath = join(artifactsDir, 'ReadNook-backup.zip')

  const server = spawn(
    process.execPath,
    [
      viteBin,
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, BROWSER: 'none' },
    },
  )
  let serverExited = false
  server.on('exit', (code) => {
    serverExited = true
    if (code !== 0 && code !== null) {
      console.error(`预览服务器退出，代码 ${code}`)
    }
  })

  let browser
  let page
  const startedAt = Date.now()

  try {
    await waitForServer(appUrl)
    assert(true, `预览服务器已在 ${appUrl} 启动`)

    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      serviceWorkers: 'allow',
      acceptDownloads: true,
    })
    page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`)
    })

    async function screenshot(name) {
      const path = join(artifactsDir, name)
      await page.screenshot({ path, fullPage: false })
      screenshots.push(name)
    }

    async function waitForText(selector, text, timeout = 20_000) {
      await page.waitForFunction(
        ({ selector: targetSelector, text: expected }) =>
          Array.from(document.querySelectorAll(targetSelector)).some((node) =>
            node.textContent?.includes(expected),
          ),
        { selector, text },
        { timeout },
      )
    }

    async function openSettingsGroup(label) {
      const group = page.locator('details.settings-group', { hasText: label })
      await group.locator('summary').click()
      await group.locator('.settings-group__body').waitFor({ state: 'visible' })
    }

    async function swipeHorizontally(fromX, toX) {
      await page.locator('.reader-pages').evaluate(
        (element, [start, end]) => {
          const point = (x) =>
            new Touch({
              identifier: 1,
              target: element,
              clientX: x,
              clientY: 420,
            })
          const startTouch = point(start)
          element.dispatchEvent(
            new TouchEvent('touchstart', {
              bubbles: true,
              cancelable: true,
              touches: [startTouch],
              changedTouches: [startTouch],
            }),
          )
          const endTouch = point(end)
          element.dispatchEvent(
            new TouchEvent('touchend', {
              bubbles: true,
              cancelable: true,
              touches: [],
              changedTouches: [endTouch],
            }),
          )
        },
        [fromX, toX],
      )
    }

    /** 逐段发送触摸事件，模拟手指按住拖动（跟手翻页）。 */
    async function dragTouch(type, clientX) {
      await page.locator('.reader-pages').evaluate(
        (element, [eventType, x]) => {
          const point = new Touch({
            identifier: 1,
            target: element,
            clientX: x,
            clientY: 420,
          })
          element.dispatchEvent(
            new TouchEvent(eventType, {
              bubbles: true,
              cancelable: true,
              touches: eventType === 'touchend' ? [] : [point],
              changedTouches: [point],
            }),
          )
        },
        [type, clientX],
      )
    }

    async function noHorizontalOverflow(label) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      assert(overflow <= 1, `${label} 在 390px 宽度下没有横向溢出`)
    }

    async function readReaderState() {
      return page.evaluate(() => {
        const article = document.querySelector('.reader-article')
        return {
          chapter:
            document.querySelector('.chapter-heading h2')?.textContent?.trim() ?? '',
          indicator:
            document.querySelector('.reader-page-indicator')?.textContent?.trim() ?? '',
          transform: article ? getComputedStyle(article).transform : '',
        }
      })
    }

    /** 逐帧记录阅读页状态，用来确认换章后没有“先画错页码再跳回来”。 */
    function recordReaderFrames(durationMs = 900) {
      return page.evaluate((duration) => {
        const frames = []
        const started = performance.now()
        const sample = () => {
          const article = document.querySelector('.reader-article')
          return {
            chapter:
              document.querySelector('.chapter-heading h2')?.textContent?.trim() ?? '',
            indicator:
              document.querySelector('.reader-page-indicator')?.textContent?.trim() ?? '',
            transform: article ? getComputedStyle(article).transform : '',
          }
        }
        return new Promise((resolve) => {
          const record = () => {
            frames.push(sample())
            if (performance.now() - started >= duration) {
              resolve(frames)
              return
            }
            requestAnimationFrame(record)
          }
          requestAnimationFrame(record)
        })
      }, durationMs)
    }

    async function turnUntilChapterEnd(limit = 40) {
      for (let step = 0; step < limit; step += 1) {
        const current = await readReaderState()
        const [pageNo, total] = current.indicator.split(/\s*\/\s*/).map(Number)
        if (pageNo === total) return current
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(260)
      }
      return readReaderState()
    }

    async function assertChapterTurnLandsDirectly(direction, label) {
      const before = await readReaderState()
      const framesPromise = recordReaderFrames(900)
      await page.waitForTimeout(40)
      await page.keyboard.press(direction > 0 ? 'ArrowRight' : 'ArrowLeft')
      const frames = await framesPromise
      const firstOfNewChapter = frames.find((frame) => frame.chapter !== before.chapter)
      const settled = frames[frames.length - 1]
      assert(
        Boolean(firstOfNewChapter) &&
          firstOfNewChapter.chapter === settled.chapter &&
          firstOfNewChapter.indicator === settled.indicator &&
          firstOfNewChapter.transform === settled.transform,
        `${label}：新章节第一次绘出时就停在目标页码，不会再跳一次`,
      )
      return settled
    }

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await waitForText('.shelf-title', '书架')
    await waitForText('.state-panel h2', '把第一本小说带进来')
    await noHorizontalOverflow('空书架')
    await screenshot('01-empty-shelf.png')

    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) throw new Error('no service worker')
      await navigator.serviceWorker.ready
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForText('.shelf-title', '书架')
    const controlled = await page.evaluate(
      () => navigator.serviceWorker.controller !== null,
    )
    assert(controlled, 'Service Worker 已接管页面，可进行离线验证')

    await page.getByRole('link', { name: '导入', exact: true }).first().click()
    await page.locator('#txt-file-input').waitFor({ state: 'attached' })
    await page.setInputFiles('#txt-file-input', fixturePath)
    await waitForText('#encoding-heading', '核对编码与正文')

    const detected = await page.locator('.preview-panel .status-pill').textContent()
    assert(detected?.includes('UTF-8') ?? false, '导入预览自动识别为 UTF-8')
    const preview = await page.locator('.text-preview').textContent()
    assert(preview?.includes('雾从河面升起来') ?? false, '导入预览显示正确正文')
    await page.fill('#book-title', '雾中灯')
    await noHorizontalOverflow('导入预览')
    await screenshot('02-import-preview.png')

    await page.getByRole('button', { name: /导入并开始阅读/ }).click()
    await page.locator('.reader-shell').waitFor({ state: 'visible' })
    await waitForText('.chapter-heading h2', '开篇')
    await page.locator('.reader-shell[aria-busy="false"]').waitFor()
    assert(true, '导入后自动打开阅读器，并保留标题前的开篇')

    const readerLock = await page.evaluate(() => {
      const pages = document.querySelector('.reader-pages')
      return {
        readerOpen: document.documentElement.classList.contains('reader-open'),
        touchAction: pages ? getComputedStyle(pages).touchAction : '',
        bodyPosition: getComputedStyle(document.body).position,
        bodyOverflow: getComputedStyle(document.body).overflow,
        htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
        viewport:
          document
            .querySelector('meta[name="viewport"]')
            ?.getAttribute('content') ?? '',
      }
    })
    assert(
      readerLock.readerOpen &&
        readerLock.touchAction === 'none' &&
        readerLock.bodyPosition === 'fixed' &&
        readerLock.bodyOverflow === 'hidden',
      '阅读页锁定整页滚动，手指上下拖动不会带动窗口',
    )
    assert(
      readerLock.htmlTouchAction === 'manipulation' &&
        readerLock.viewport.includes('user-scalable=no') &&
        readerLock.viewport.includes('maximum-scale=1'),
      '页面禁用浏览器双击放大与双指缩放',
    )

    await page.getByRole('button', { name: '打开目录' }).click()
    await page.locator('dialog[open]').waitFor({ state: 'visible' })
    const dialogLock = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]')
      const body = dialog?.querySelector('.app-dialog__body')
      const panel = dialog?.querySelector('.app-dialog__panel')
      const dialogStyle = dialog ? getComputedStyle(dialog) : null
      const bodyStyle = body ? getComputedStyle(body) : null
      const rect = (element) => (element ? element.getBoundingClientRect() : null)
      const dialogRect = rect(dialog)
      const panelRect = rect(panel)
      return {
        dialogOpen: document.documentElement.classList.contains('dialog-open'),
        bodyPosition: getComputedStyle(document.body).position,
        dialogOverflow: dialogStyle?.overflow ?? '',
        dialogPosition: dialogStyle?.position ?? '',
        dialogBottom: dialogRect ? Math.round(dialogRect.bottom) : null,
        dialogTop: panelRect ? panelRect.top : null,
        bodyOverscroll: getComputedStyle(document.body).overscrollBehavior,
        bodyOverflowX: bodyStyle?.overflowX ?? '',
        bodyOverflowY: bodyStyle?.overflowY ?? '',
        bodyTouchAction: bodyStyle?.touchAction ?? '',
        bodyScrollWidth: body?.scrollWidth ?? 0,
        bodyClientWidth: body?.clientWidth ?? 0,
        bodyScrollLeft: body?.scrollLeft ?? 0,
        viewportHeight: window.innerHeight,
      }
    })
    assert(
      dialogLock.dialogOpen &&
        dialogLock.bodyPosition === 'fixed' &&
        dialogLock.dialogOverflow === 'hidden' &&
        dialogLock.bodyOverscroll === 'none',
      '打开目录时整页被固定，面板不会跟着手势整体移动',
    )
    assert(
      dialogLock.dialogPosition === 'fixed' &&
        dialogLock.dialogBottom === dialogLock.viewportHeight,
      '目录面板固定在视口底边（position: fixed），不会被上下拖动',
    )
    assert(
      dialogLock.bodyOverflowX === 'hidden' &&
        dialogLock.bodyOverflowY === 'auto' &&
        dialogLock.bodyTouchAction === 'pan-y' &&
        dialogLock.bodyScrollWidth <= dialogLock.bodyClientWidth + 1 &&
        dialogLock.bodyScrollLeft === 0,
      '目录内容区只能纵向滚动，没有横向溢出',
    )

    // 在目录列表上横向拖一下：面板和列表都不能被推走。
    const tocDragRect = await page
      .locator('dialog[open] .app-dialog__body')
      .boundingBox()
    const dialogDragBefore = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]')
      const panel = dialog?.querySelector('.app-dialog__panel')?.getBoundingClientRect()
      const list = dialog?.querySelector('.toc-list')?.getBoundingClientRect()
      return { panelTop: panel?.top, panelLeft: panel?.left, listLeft: list?.left }
    })
    if (tocDragRect) {
      const y = tocDragRect.y + Math.min(120, tocDragRect.height / 2)
      await page.locator('dialog[open] .app-dialog__body').evaluate(
        (element, [startX, endX, clientY]) => {
          const point = (x) =>
            new Touch({ identifier: 1, target: element, clientX: x, clientY })
          const fire = (type, touch, active) =>
            element.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: active ? [touch] : [],
                changedTouches: [touch],
              }),
            )
          fire('touchstart', point(startX), true)
          for (let step = 1; step <= 6; step += 1) {
            fire('touchmove', point(startX + ((endX - startX) * step) / 6), true)
          }
          fire('touchend', point(endX), false)
        },
        [tocDragRect.x + tocDragRect.width - 40, tocDragRect.x + 40, y],
      )
      await page.waitForTimeout(300)
      const dialogDragAfter = await page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]')
        const panel = dialog?.querySelector('.app-dialog__panel')?.getBoundingClientRect()
        const list = dialog?.querySelector('.toc-list')?.getBoundingClientRect()
        return {
          panelTop: panel?.top,
          panelLeft: panel?.left,
          listLeft: list?.left,
          scrollLeft: dialog?.querySelector('.app-dialog__body')?.scrollLeft ?? 0,
        }
      })
      assert(
        dialogDragAfter.panelTop === dialogDragBefore.panelTop &&
          dialogDragAfter.panelLeft === dialogDragBefore.panelLeft &&
          dialogDragAfter.listLeft === dialogDragBefore.listLeft &&
          dialogDragAfter.scrollLeft === 0,
        '在目录上横向拖动时面板和列表都不位移，只有纵向能滚',
      )
    }
    await page.fill('.toc-search__input', '第二章')
    await page.waitForTimeout(300)
    const filteredCount = await page.locator('.toc-item').count()
    assert(filteredCount === 1, '目录搜索可按章节名过滤')
    const tocSummaryText = await page.locator('.toc-summary').textContent()
    assert(
      tocSummaryText?.includes('找到 1 章') ?? false,
      '目录搜索显示匹配数量',
    )
    await page.locator('.toc-search__clear').click()
    await page.waitForTimeout(250)
    const fullCount = await page.locator('.toc-item').count()
    assert(fullCount > 1, '清除目录搜索后恢复完整列表')

    const tocAllText = await page.locator('.toc-summary').textContent()
    assert(
      tocAllText?.includes('共 6 章') ?? false,
      '目录章数不包含开篇',
    )

    const frontMatterRow = page.locator('.toc-item.is-front-matter')
    assert(
      (await frontMatterRow.count()) === 1 &&
        ((await frontMatterRow.locator('.toc-item__order').textContent())?.trim() ??
          '') === '',
      '开篇在目录中不占章节序号',
    )
    const firstNumberedRow = page.locator('.toc-item').nth(1)
    assert(
      ((await firstNumberedRow.locator('.toc-item__order').textContent())?.trim() ??
        '') === '1',
      '第一章在目录中从 1 开始编号',
    )
    await screenshot('50-toc-front-matter.png')

    await page.fill('.toc-search__input', '1')
    await page.waitForTimeout(250)
    const digitRows = page.locator('.toc-item')
    assert(
      (await digitRows.count()) === 1 &&
        ((await digitRows.first().textContent())?.includes('第一章 雾起') ?? false),
      '目录数字搜索按正文序号匹配',
    )
    await page.locator('.toc-search__clear').click()
    await page.waitForTimeout(200)
    await page.locator('.toc-item').filter({ hasText: '第一章 雾起' }).click()
    await waitForText('.chapter-heading h2', '第一章 雾起')
    await page.locator('.reader-shell[aria-busy="false"]').waitFor()
    assert(true, '阅读器可从目录跳转到指定章节')

    await page.waitForTimeout(300)
    const afterDialog = await page.evaluate(() => ({
      dialogOpen: document.documentElement.classList.contains('dialog-open'),
      bodyPosition: getComputedStyle(document.body).position,
      readerOpen: document.documentElement.classList.contains('reader-open'),
    }))
    assert(
      !afterDialog.dialogOpen &&
        afterDialog.bodyPosition === 'fixed' &&
        afterDialog.readerOpen,
      '关闭目录后仍保持阅读页的滚动锁定',
    )

    const firstPage = await page.locator('.reader-page-indicator').textContent()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)
    const secondPage = await page.locator('.reader-page-indicator').textContent()
    assert(
      (firstPage?.trim() ?? '') !== (secondPage?.trim() ?? ''),
      '阅读器可用方向键左右翻页',
    )

    // 分页几何：两页之间必须留出空白，翻页位移 = 页宽 + 留白。
    const pagination = await page.evaluate(() => {
      const article = document.querySelector('.reader-article')
      if (!article) return null
      const style = getComputedStyle(article)
      const matrix = new DOMMatrixReadOnly(style.transform)
      const indicator =
        document.querySelector('.reader-page-indicator')?.textContent?.trim() ?? ''
      const [current, total] = indicator.split(/\s*\/\s*/).map(Number)
      return {
        width: article.clientWidth,
        gap: Number.parseFloat(style.columnGap) || 0,
        scrollWidth: article.scrollWidth,
        translateX: Math.round(matrix.m41),
        current,
        total,
      }
    })
    const pageStride = (pagination?.width ?? 0) + (pagination?.gap ?? 0)
    assert(
      Boolean(pagination) &&
        pagination.gap > 0 &&
        pagination.total > 1 &&
        Math.abs(pagination.translateX + (pagination.current - 1) * pageStride) <= 1 &&
        pagination.scrollWidth === pagination.total * pageStride - pagination.gap,
      `相邻两页之间留出 ${pagination?.gap}px 空白，翻页按「页宽 + 留白」整页位移`,
    )

    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    await swipeHorizontally(320, 70)
    await page.waitForTimeout(400)
    const swipedPage = await page.locator('.reader-page-indicator').textContent()
    assert(
      swipedPage?.trim() === secondPage?.trim(),
      '阅读器可左右滑动翻页',
    )

    // 跟手翻页：手指按住时页面跟着移动，两页同时可见；往回拖可以取消。
    const pageBeforeDrag = (await page.locator('.reader-page-indicator').textContent())?.trim()
    const articleWidth = await page
      .locator('.reader-article')
      .evaluate((element) => element.clientWidth)
    await dragTouch('touchstart', 330)
    for (let step = 1; step <= 6; step += 1) {
      await dragTouch('touchmove', 330 - step * 20)
      await page.waitForTimeout(16)
    }
    const draggingState = await page.evaluate(() => {
      const article = document.querySelector('.reader-article')
      const pages = document.querySelector('.reader-pages')?.getBoundingClientRect()
      const matrix = new DOMMatrixReadOnly(
        article ? getComputedStyle(article).transform : 'none',
      )
      const readOffset = (x) => {
        if (!pages || !Number.isFinite(x)) return null
        const range = document.caretRangeFromPoint(x, pages.top + 200)
        return range ? range.startOffset : null
      }
      return {
        translateX: Math.round(matrix.m41),
        indicator:
          document.querySelector('.reader-page-indicator')?.textContent?.trim() ?? '',
        leftOffset: readOffset(pages ? pages.left + 24 : NaN),
        rightOffset: readOffset(pages ? pages.right - 24 : NaN),
      }
    })
    const dragPageNo = Number((pageBeforeDrag ?? '').split(/\s*\/\s*/)[0])
    // 跟手位移 = 当前 transform 相对本页起始位置的偏移。
    const dragDelta =
      draggingState.translateX + (dragPageNo - 1) * articleWidth
    assert(
      dragDelta < -40 &&
        dragDelta > -articleWidth * 0.9 &&
        draggingState.indicator === pageBeforeDrag &&
        draggingState.leftOffset !== null &&
        draggingState.rightOffset !== null &&
        draggingState.rightOffset > draggingState.leftOffset,
      `拖动时页面跟手位移，左右两页文字同时可见（位移 ${Math.round(dragDelta)}px / 页宽 ${articleWidth}）`,
    )

    for (let step = 1; step <= 6; step += 1) {
      await dragTouch('touchmove', 210 + step * 20)
      await page.waitForTimeout(16)
    }
    await dragTouch('touchend', 330)
    await page.waitForTimeout(420)
    assert(
      (await page.locator('.reader-page-indicator').textContent())?.trim() ===
        pageBeforeDrag,
      '拖回原位松手取消翻页，不改变当前页',
    )

    await dragTouch('touchstart', 330)
    for (let step = 1; step <= 6; step += 1) {
      await dragTouch('touchmove', 330 - step * 20)
      await page.waitForTimeout(16)
    }
    await dragTouch('touchend', 210)
    await page.waitForTimeout(520)
    const afterDragPage = (await page.locator('.reader-page-indicator').textContent())?.trim()
    assert(
      afterDragPage !== pageBeforeDrag,
      '拖动超过阈值松手翻到下一页',
    )
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(520)
    assert(
      (await page.locator('.reader-page-indicator').textContent())?.trim() ===
        pageBeforeDrag,
      '拖动翻页后可以用方向键回到原页',
    )

    const pagedPercent = await page.locator('.chapter-heading__meta').textContent()
    assert(
      pagedPercent?.includes('全书') ?? false,
      '翻页后显示章节与全书阅读百分比',
    )
    await page.waitForTimeout(2_200)

    await page
      .locator('.reader-bottombar button')
      .filter({ hasText: '加书签' })
      .click()
    await waitForText('.toast', '已添加书签')
    assert(true, '可在当前位置添加书签')

    await page
      .locator('.reader-bottombar button')
      .filter({ hasText: '阅读设置' })
      .click()
    await page.locator('dialog[open]').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: /深色/ }).click()
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    assert(theme === 'dark', '阅读设置可切换深色主题')
    await page.locator('dialog[open]').getByRole('button', { name: '关闭' }).click()
    await page.waitForTimeout(2_200)
    await screenshot('03-reader-dark.png')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForText('.chapter-heading h2', '第一章 雾起')
    const restoredTheme = await page.evaluate(
      () => document.documentElement.dataset.theme,
    )
    assert(restoredTheme === 'dark', '刷新后主题保持为深色')
    await page.waitForFunction(
      () => {
        const element = document.querySelector('.reader-page-indicator')
        return /^\s*2\s*\//.test(element?.textContent ?? '')
      },
      undefined,
      { timeout: 10_000 },
    )
    assert(true, '刷新后按字符偏移恢复阅读页')
    await noHorizontalOverflow('阅读页')

    await page.getByRole('button', { name: '查看书签' }).click()
    await page.locator('dialog[open]').waitFor({ state: 'visible' })
    await waitForText('dialog[open]', '第一章 雾起')
    const bookmarkCount = await page.locator('.bookmark-entry').count()
    assert(bookmarkCount === 1, '刷新后书签仍然存在')
    await screenshot('04-bookmarks.png')
    await page.locator('dialog[open]').getByRole('button', { name: '关闭' }).click()

    await page.getByRole('button', { name: '返回书架' }).first().click()
    await page.locator('.bookshelf-page').waitFor({ state: 'visible' })
    await waitForText('.book-card__title', '雾中灯')
    const shelfProgress = await page.locator('.book-card__percent').textContent()
    assert(
      shelfProgress?.includes('已读') ?? false,
      '返回书架后显示已读进度',
    )
    const shelfLocation = await page.locator('.book-tile__meta').first().textContent()
    assert(
      shelfLocation?.includes('第 1 / 6 章') ?? false,
      '书架章节位置不把开篇算作第 1 章',
    )
    await screenshot('05-shelf-with-progress.png')

    await page.getByRole('button', { name: '列表视图' }).click()
    await page.locator('.book-list').waitFor({ state: 'visible' })
    assert(true, '书架可在封面网格和列表视图之间切换')

    await page.getByRole('button', { name: '封面网格视图' }).click()
    await page.locator('.book-grid').waitFor({ state: 'visible' })
    assert(true, '书架切回封面网格后仍然显示书籍')

    await page.goto(`${appUrl}#/settings`, { waitUntil: 'domcontentloaded' })
    await waitForText('#backup-heading', '备份与恢复')
    await page.evaluate(() => window.scrollTo(0, 0))
    await screenshot('06-settings-overview.png')

    await openSettingsGroup('应用更新')
    const updateGroup = page.locator('details.settings-group', { hasText: '应用更新' })
    const versionText = await updateGroup.locator('.data-list').textContent()
    assert(
      (versionText?.includes('当前版本') ?? false) &&
        (versionText?.includes('构建时间') ?? false),
      '设置中显示当前版本与构建时间',
    )
    await updateGroup.getByRole('button', { name: '检查更新' }).click()
    await updateGroup
      .locator('.settings-body-text', { hasText: '已是最新版本' })
      .waitFor({ timeout: 30_000 })
    assert(true, '设置中可手动检查更新并确认已是最新版本')
    await page
      .locator('.toast')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => undefined)
    await screenshot('52-settings-update.png')

    await openSettingsGroup('备份与恢复')
    await page.getByRole('button', { name: /导出完整备份/ }).click()
    await waitForText('.backup-result', '备份已生成', 30_000)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: '下载备份' }).click(),
    ])
    await download.saveAs(backupPath)
    const backupInfo = await stat(backupPath)
    assert(backupInfo.size > 1_000, '完整备份 ZIP 已下载到本机')
    await screenshot('06-settings-backup.png')

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await waitForText('.book-card__title', '雾中灯')
    await page.getByRole('button', { name: '管理', exact: true }).click()
    await page.getByRole('button', { name: '删除《雾中灯》' }).click()
    await page.locator('dialog[open]').waitFor({ state: 'visible' })
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await waitForText('.state-panel h2', '把第一本小说带进来')
    assert(true, '删除书籍后书架为空，级联数据已清理')

    await page.goto(`${appUrl}#/settings`, { waitUntil: 'domcontentloaded' })
    await waitForText('#backup-heading', '备份与恢复')
    await openSettingsGroup('备份与恢复')
    await page
      .locator('input[type="file"][accept=".zip,application/zip"]')
      .setInputFiles(backupPath)
    await page.locator('dialog[open]').waitFor({ state: 'visible' })
    await waitForText('dialog[open]', '可恢复')
    await page.getByRole('button', { name: '开始恢复' }).click()
    await page.locator('#restore-result-heading').waitFor({
      state: 'visible',
      timeout: 30_000,
    })
    const restorePanel = await page.locator(
      'section:has(#restore-result-heading)',
    ).textContent()
    assert(restorePanel?.includes('1 本') ?? false, '从备份恢复新增 1 本书')
    assert(restorePanel?.includes('已恢复') ?? false, '从备份恢复阅读设置')
    await screenshot('07-restore-result.png')

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await waitForText('.book-card__title', '雾中灯')
    assert(true, '恢复后的书籍重新出现在书架')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForText('.book-card__title', '雾中灯')
    const controllerBeforeOffline = await page.evaluate(
      () => navigator.serviceWorker.controller !== null,
    )
    assert(controllerBeforeOffline, '离线测试前页面已由 Service Worker 控制')

    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForText('.shelf-title', '书架')
    await waitForText('.book-card__title', '雾中灯')
    assert(true, '断网刷新后应用与书库仍可打开')

    await page.getByRole('link', { name: '导入', exact: true }).first().click()
    await page.locator('#txt-file-input').waitFor({ state: 'attached' })
    const offlineStory = [
      '第一章 离线灯火',
      '断网以后，书页仍然可以翻开。'.repeat(60),
      '',
      '第二章 风停',
      '故事停在这里，但本地数据还在。'.repeat(60),
    ].join('\n')
    await page.setInputFiles('#txt-file-input', {
      name: '离线小记.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(offlineStory, 'utf8'),
    })
    await waitForText('#encoding-heading', '核对编码与正文')
    await page.fill('#book-title', '离线小记')
    await page.getByRole('button', { name: /导入并开始阅读/ }).click()
    await page.locator('.reader-shell').waitFor({ state: 'visible' })
    await waitForText('.chapter-heading h2', '第一章 离线灯火')
    assert(true, '断网状态下仍可导入 TXT 并开始阅读')
    await screenshot('08-offline-reader.png')

    // 跨章翻页：新章节必须“一次画对”，否则读者会看到文字先出现再跳一下。
    await turnUntilChapterEnd()
    const forwardTurn = await assertChapterTurnLandsDirectly(
      1,
      '从章末翻到下一章',
    )
    assert(
      /^1 \//.test(forwardTurn.indicator),
      '从章末翻到下一章落在新章节第 1 页',
    )
    const backwardTurn = await assertChapterTurnLandsDirectly(-1, '从章首翻回上一章')
    const [backPageNo, backTotal] = backwardTurn.indicator.split(/\s*\/\s*/).map(Number)
    assert(
      backPageNo === backTotal && backTotal > 1,
      '从章首翻回上一章直接落在上一章最后一页',
    )

    await page.getByRole('button', { name: '返回书架' }).first().click()
    await page.locator('.bookshelf-page').waitFor({ state: 'visible' })
    await page.waitForFunction(
      () => document.querySelectorAll('.book-card:not(.book-card--skeleton)').length === 2,
    )
    assert(true, '离线导入后书架显示两本书')
    await noHorizontalOverflow('离线书架')
    await screenshot('09-offline-shelf.png')
    await context.setOffline(false)

    const gbkFixturePath = join(root, 'tests', 'fixtures', 'sample-gbk.txt')
    await page.goto(`${appUrl}#/import`, { waitUntil: 'domcontentloaded' })
    await page.locator('#txt-file-input').waitFor({ state: 'attached' })
    await page.setInputFiles('#txt-file-input', gbkFixturePath)
    await waitForText('#encoding-heading', '核对编码与正文')
    const gbkDetected = await page
      .locator('.preview-panel .status-pill')
      .textContent()
    assert(
      gbkDetected?.includes('GB18030') ?? false,
      'GBK 文件自动检测为 GB18030 兼容编码',
    )
    const gbkPreview = await page.locator('.text-preview').textContent()
    assert(gbkPreview?.includes('雾从河面升起来') ?? false, 'GBK 正文预览无乱码')

    await page.selectOption('#encoding-select', 'gbk')
    await page.waitForFunction(() => {
      const status = document.querySelector('.preview-panel .status-pill')
      return status?.textContent?.trim().startsWith('GBK') ?? false
    })
    const switchedPreview = await page.locator('.text-preview').textContent()
    assert(
      switchedPreview?.includes('雾从河面升起来') ?? false,
      '手动切换 GBK 后预览仍然正确',
    )
    await page.fill('#book-title', '编码测试')
    await page.getByRole('button', { name: /导入并开始阅读/ }).click()
    await page.locator('.reader-shell').waitFor({ state: 'visible' })
    await waitForText('.chapter-heading h2', '第一章 河雾')
    await page.locator('.reader-shell[aria-busy="false"]').waitFor()
    assert(true, '手动选择 GBK 后可正常导入并阅读')

    await page.getByRole('button', { name: '返回书架' }).first().click()
    await page.locator('.bookshelf-page').waitFor({ state: 'visible' })
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.book-card:not(.book-card--skeleton)')
          .length === 3,
    )
    assert(true, 'GBK 书籍导入后书架共有三本书')

    await page.getByRole('link', { name: '导入', exact: true }).first().click()
    await page.locator('#txt-file-input').waitFor({ state: 'attached' })
    await page.setInputFiles('#txt-file-input', gbkFixturePath)
    await waitForText('.notice--warn', '这本书已经导入过')
    const duplicateImportDisabled = await page
      .getByRole('button', { name: /导入并开始阅读/ })
      .isDisabled()
    assert(duplicateImportDisabled, '重复内容会提示已导入并禁用导入按钮')
    await screenshot('10-duplicate-detection.png')

    await page.goto(`${appUrl}#/settings`, { waitUntil: 'domcontentloaded' })
    await waitForText('#demo-heading', '演示书籍')
    await openSettingsGroup('演示书籍')
    await page.getByRole('button', { name: /生成 30 本示例书/ }).click()
    await waitForText('.toast', '已加入 30 本示例书', 60_000)

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.book-card:not(.book-card--skeleton)')
          .length === 12,
      undefined,
      { timeout: 20_000 },
    )
    assert(true, '示例书第一页只渲染 12 本，分页生效')
    assert(
      await page
        .getByRole('button', { name: /显示更多/ })
        .isVisible(),
      '首屏保留“显示更多”按钮作为兜底',
    )
    await screenshot('11-demo-pagination.png')

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.book-card:not(.book-card--skeleton)')
          .length === 24,
      undefined,
      { timeout: 20_000 },
    )
    assert(true, '滚动到底会自动加载第二批 24 本，无需点击')
    await screenshot('12-demo-page2.png')

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.book-card:not(.book-card--skeleton)')
          .length === 33,
      undefined,
      { timeout: 20_000 },
    )
    assert(true, '继续下滑可加载全部 33 本（含 3 本导入书）')

    await page.goto(`${appUrl}#/settings`, { waitUntil: 'domcontentloaded' })
    await waitForText('#demo-heading', '演示书籍')
    await openSettingsGroup('演示书籍')
    await page.getByRole('button', { name: '清除示例书' }).first().click()
    await page.locator('dialog[open]').waitFor({ state: 'visible' })
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: '清除示例书' })
      .click()
    await waitForText('.toast', '已清除 30 本示例书', 30_000)
    assert(true, '示例书可一键清除，不影响自己导入的书')

    const unexpectedErrors = consoleErrors.filter(
      (message) =>
        !message.includes('favicon') &&
        !message.includes('net::ERR_INTERNET_DISCONNECTED'),
    )
    assert(
      unexpectedErrors.length === 0,
      unexpectedErrors.length === 0
        ? '浏览器控制台没有未预期的错误'
        : `控制台错误：${unexpectedErrors.slice(0, 3).join(' | ')}`,
    )

    const result = {
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      chromePath,
      appUrl,
      viewport: '390x844',
      checks,
      screenshots,
      consoleErrors,
    }
    await writeFile(
      join(artifactsDir, 'result.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    )

    for (const message of checks) console.log(`✓ ${message}`)
    console.log(`\n截图与结果已保存到 ${artifactsDir}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n✗ 浏览器冒烟测试失败：${message}`)
    if (consoleErrors.length > 0) {
      console.error('控制台错误：')
      for (const entry of consoleErrors.slice(0, 10)) console.error(`  - ${entry}`)
    }
    try {
      if (page) {
        await page.screenshot({
          path: join(artifactsDir, '99-failure.png'),
        })
      }
      await writeFile(
        join(artifactsDir, 'failure.json'),
        `${JSON.stringify(
          {
            message,
            checks,
            screenshots,
            consoleErrors,
            serverExited,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
    } catch {
      // Best effort only.
    }
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    if (!serverExited) {
      server.kill()
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
}

await main()
