function textNodeOf(root: HTMLElement): Text | null {
  const first = root.firstChild
  return first?.nodeType === Node.TEXT_NODE ? (first as Text) : null
}

function topOfOffset(node: Text, offset: number): number {
  const length = node.data.length
  const start = Math.max(0, Math.min(offset, length))

  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, Math.min(start + 1, length))
  let rect = range.getBoundingClientRect()
  if (rect.height > 0 || rect.width > 0) return rect.top

  range.setEnd(node, Math.min(length, start + 24))
  const rects = range.getClientRects()
  rect = rects[0] ?? rect
  return rect.top
}

export function findVisibleTextOffset(
  root: HTMLElement,
  viewportTop: number,
): number {
  const node = textNodeOf(root)
  if (!node || node.data.length === 0) return 0

  let low = 0
  let high = node.data.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const top = topOfOffset(node, middle)
    if (top < viewportTop) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

export function scrollToTextOffset(
  root: HTMLElement,
  container: HTMLElement,
  offset: number,
  padding = 8,
): void {
  const node = textNodeOf(root)
  if (!node) return

  const length = node.data.length
  if (length === 0) {
    container.scrollTop = 0
    return
  }
  if (offset <= 0) {
    container.scrollTop = 0
    return
  }

  const safeOffset = Math.max(0, Math.min(Math.floor(offset), length))
  if (safeOffset >= length) {
    container.scrollTop = container.scrollHeight
    return
  }

  const range = document.createRange()
  range.setStart(node, safeOffset)
  range.setEnd(node, Math.min(safeOffset + 1, length))
  let rect = range.getBoundingClientRect()
  if (rect.height === 0 && rect.width === 0) {
    range.setEnd(node, Math.min(length, safeOffset + 24))
    rect = range.getBoundingClientRect()
  }

  const containerRect = container.getBoundingClientRect()
  container.scrollTop += rect.top - containerRect.top - padding
}
