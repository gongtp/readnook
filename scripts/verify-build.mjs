import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

function normalizeBase(value) {
  const raw = value?.trim() || '/readnook/'
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const base = normalizeBase(process.env.BASE_PATH)
const failures = []
const notes = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

async function readText(relativePath) {
  return readFile(join(distDir, relativePath), 'utf8')
}

async function exists(relativePath) {
  try {
    const info = await stat(join(distDir, relativePath))
    return info.isFile()
  } catch {
    return false
  }
}

function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  if (!signature.every((byte, index) => bytes[index] === byte)) return null
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await walk(join(directory, entry.name), relativePath)))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files
}

async function main() {
  try {
    await stat(distDir)
  } catch {
    console.error('✗ 未找到 dist/，请先运行 npm run build')
    process.exitCode = 1
    return
  }

  const files = await walk(distDir)
  check(files.includes('index.html'), '缺少 dist/index.html')
  check(files.includes('manifest.webmanifest'), '缺少 PWA manifest')
  check(files.includes('sw.js'), '缺少 service worker')
  check(files.includes('icons/icon-192.png'), '缺少 192x192 图标')
  check(files.includes('icons/icon-512.png'), '缺少 512x512 图标')
  check(files.includes('icons/icon-maskable-512.png'), '缺少 maskable 图标')
  check(files.includes('icons/apple-touch-icon-180.png'), '缺少 Apple 图标')

  const forbidden = files.filter((file) =>
    /\.(txt|zip|db|sqlite|sqlite3|json|log)$/i.test(file),
  )
  check(
    forbidden.length === 0,
    `dist/ 中不应包含用户数据或调试文件：${forbidden.join(', ')}`,
  )

  const indexHtml = await readText('index.html')
  check(
    indexHtml.includes(`href="${base}manifest.webmanifest"`),
    `index.html 未引用 ${base}manifest.webmanifest`,
  )
  check(
    indexHtml.includes(`href="${base}icons/apple-touch-icon-180.png"`),
    'index.html 缺少 Apple touch icon',
  )
  check(
    indexHtml.includes(`src="${base}assets/`),
    `index.html 的脚本没有使用 ${base} 基础路径`,
  )
  check(
    !/(?:src|href)="\/(?!readnook\/)/.test(indexHtml),
    'index.html 含有未加部署子路径的资源引用',
  )
  check(!indexHtml.includes('__DSH'), 'index.html 含有构建占位符')
  check(indexHtml.includes('viewport-fit=cover'), '缺少 iPhone 安全区 viewport')
  check(indexHtml.includes('apple-mobile-web-app-capable'), '缺少 Apple PWA 元信息')

  const manifest = JSON.parse(await readText('manifest.webmanifest'))
  check(manifest.name === 'ReadNook', 'manifest name 不正确')
  check(manifest.short_name === 'ReadNook', 'manifest short_name 不正确')
  check(manifest.start_url === base, `manifest start_url 应为 ${base}`)
  check(manifest.scope === base, `manifest scope 应为 ${base}`)
  check(manifest.id === base, `manifest id 应为 ${base}`)
  check(manifest.display === 'standalone', 'manifest display 应为 standalone')
  check(manifest.orientation === 'portrait', 'manifest orientation 应为 portrait')
  check(manifest.lang === 'zh-CN', 'manifest lang 应为 zh-CN')
  check(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'manifest 图标不足')

  const expectedIcons = new Map([
    ['icons/icon-192.png', { width: 192, height: 192, purpose: 'any' }],
    ['icons/icon-512.png', { width: 512, height: 512, purpose: 'any' }],
    [
      'icons/icon-maskable-512.png',
      { width: 512, height: 512, purpose: 'maskable' },
    ],
  ])

  for (const icon of manifest.icons) {
    check(
      typeof icon.src === 'string' && icon.src.startsWith(base),
      `manifest 图标路径不在 ${base} 下：${icon.src}`,
    )
    if (typeof icon.src !== 'string' || !icon.src.startsWith(base)) continue
    const relativePath = icon.src.slice(base.length)
    check(await exists(relativePath), `manifest 图标文件不存在：${relativePath}`)
    const expected = expectedIcons.get(relativePath)
    if (!expected) {
      check(false, `manifest 含有未预期的图标：${relativePath}`)
      continue
    }
    check(icon.sizes === `${expected.width}x${expected.height}`, `图标尺寸声明不正确：${relativePath}`)
    check(icon.type === 'image/png', `图标类型应为 image/png：${relativePath}`)
    check(icon.purpose === expected.purpose, `图标 purpose 不正确：${relativePath}`)
    const bytes = await readFile(join(distDir, relativePath))
    const size = pngSize(bytes)
    check(Boolean(size), `图标不是有效 PNG：${relativePath}`)
    if (size) {
      check(
        size.width === expected.width && size.height === expected.height,
        `图标实际尺寸不正确：${relativePath} 为 ${size.width}x${size.height}`,
      )
    }
  }

  const appleIcon = await readFile(join(distDir, 'icons/apple-touch-icon-180.png'))
  const appleSize = pngSize(appleIcon)
  check(
    appleSize?.width === 180 && appleSize.height === 180,
    'Apple touch icon 实际尺寸不是 180x180',
  )

  const sw = await readText('sw.js')
  check(sw.includes('ReadNook'), 'service worker 缺少 ReadNook cacheId')
  check(sw.includes('precacheAndRoute'), 'service worker 未预缓存应用资源')
  check(
    sw.includes(`createHandlerBoundToURL("${base}index.html")`),
    'service worker 的导航回退路径不正确',
  )

  const precachedUrls = [...sw.matchAll(/url:"([^"]+)"/g)].map(
    (match) => match[1],
  )
  check(precachedUrls.length > 0, 'service worker 没有预缓存任何资源')
  const duplicates = precachedUrls.filter(
    (url, index) => precachedUrls.indexOf(url) !== index,
  )
  check(
    new Set(duplicates).size === 0,
    `service worker 含有重复预缓存项：${[...new Set(duplicates)].join(', ')}`,
  )

  for (const url of precachedUrls) {
    const normalized = url.replace(/^\/+/, '')
    const relativePath = normalized.startsWith(base.slice(1))
      ? normalized.slice(base.length - 1)
      : normalized
    const safePath = posix.normalize(relativePath)
    check(
      !safePath.startsWith('..'),
      `service worker 预缓存了不安全的路径：${url}`,
    )
    check(await exists(safePath), `service worker 预缓存的文件不存在：${url}`)
  }

  const jsAssets = files.filter(
    (file) => file.startsWith('assets/') && extname(file) === '.js',
  )
  check(jsAssets.length > 0, '构建产物中没有 JavaScript 资源')
  check(
    files.some((file) => file.startsWith('assets/') && file.includes('txt.worker')),
    '构建产物缺少 TXT Worker',
  )
  check(
    files.some((file) => file.startsWith('assets/') && extname(file) === '.css'),
    '构建产物缺少样式表',
  )
  check(
    !files.some((file) => file.endsWith('.map')),
    '生产构建不应包含 source map',
  )

  notes.push(`部署基础路径：${base}`)
  notes.push(`构建文件：${files.length} 个`)
  notes.push(`预缓存条目：${precachedUrls.length} 个`)
  notes.push(`JavaScript 资源：${jsAssets.length} 个`)

  for (const note of notes) console.log(`• ${note}`)

  if (failures.length > 0) {
    console.error('\n构建校验失败：')
    for (const failure of failures) console.error(`✗ ${failure}`)
    process.exitCode = 1
    return
  }

  console.log('\n✓ 构建校验通过：PWA 清单、图标、子路径与离线缓存均符合预期。')
}

await main()
