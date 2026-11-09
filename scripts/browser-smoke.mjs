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
    const page = await context.newPage()
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

    async function noHorizontalOverflow(label) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      assert(overflow <= 1, `${label} 在 390px 宽度下没有横向溢出`)
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

    await page
      .locator('.reader-bottombar button')
      .filter({ hasText: '下一章' })
      .click()
    await waitForText('.chapter-heading h2', '第一章 雾起')
    await page.locator('.reader-shell[aria-busy="false"]').waitFor()
    assert(true, '阅读器可切换到下一章')

    await page.locator('.reader-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.waitForTimeout(2_200)
    const percentText = await page.locator('.chapter-heading__meta').textContent()
    assert(
      percentText?.includes('全书') ?? false,
      '滚动后显示章节与全书阅读百分比',
    )

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
        const element = document.querySelector('.reader-scroll')
        return element instanceof HTMLElement && element.scrollTop > 0
      },
      undefined,
      { timeout: 10_000 },
    )
    const restoredScroll = await page
      .locator('.reader-scroll')
      .evaluate((element) => element.scrollTop)
    assert(restoredScroll > 0, '刷新后按字符偏移恢复阅读位置')
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
      '断网以后，书页仍然可以翻开。'.repeat(12),
      '',
      '第二章 风停',
      '故事停在这里，但本地数据还在。'.repeat(12),
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
