function textNodeOf(root: HTMLElement): Text | null {
  const first = root.firstChild
  return first?.nodeType === Node.TEXT_NODE ? (first as Text) : null
}

function rangeRectAt(node: Text, offset: number): DOMRect | null {
  const length = node.data.length
  if (length === 0) return null
  const start = Math.max(0, Math.min(offset, length - 1))

  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, Math.min(start + 1, length))
  let rect = range.getBoundingClientRect()
  if (rect.height > 0 || rect.width > 0) return rect

  range.setEnd(node, Math.min(length, start + 16))
  const rects = range.getClientRects()
  return rects[0] ?? rect
}

/**
 * 分页模式下文本按列横向排布：同一列的字符共享列左边界，
 * 因此“字符所在列”等于它与正文起始左边界之间的距离除以页宽。
 */
export function pageOfOffset(
  root: HTMLElement,
  article: HTMLElement,
  offset: number,
  pageWidth: number,
): number {
  if (pageWidth <= 0) return 0
  const node = textNodeOf(root)
  if (!node) return 0
  const rect = rangeRectAt(node, offset)
  if (!rect) return 0
  const articleLeft = article.getBoundingClientRect().left
  return Math.max(0, Math.floor((rect.left - articleLeft) / pageWidth))
}

/** 二分查找某一页第一个字符的偏移，依赖 pageOfOffset 随偏移单调不减。 */
export function offsetOfPage(
  root: HTMLElement,
  article: HTMLElement,
  page: number,
  pageWidth: number,
): number {
  const node = textNodeOf(root)
  if (!node) return 0
  const length = node.data.length
  if (length === 0 || page <= 0) return 0

  let low = 0
  let high = length - 1
  let found = length
  while (low <= high) {
    const middle = (low + high) >> 1
    const current = pageOfOffset(root, article, middle, pageWidth)
    if (current >= page) {
      found = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  return found === length ? length - 1 : found
}

/** 列布局下正文的横向总宽是页宽的整数倍，向上取整可容忍亚像素误差。 */
export function countPages(article: HTMLElement): number {
  const width = article.clientWidth
  if (width <= 0) return 1
  return Math.max(1, Math.round(article.scrollWidth / width))
}
