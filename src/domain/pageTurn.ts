/** 位移、速度都沿屏幕坐标：向左为负；返回值沿阅读顺序：下一页为 1。 */
export function resolvePageTurn(offset: number, velocity: number, width: number): -1 | 0 | 1 {
  if (width <= 0 || Math.abs(offset) < 20) return 0
  const distance = Math.abs(offset)
  const sameDirection = Math.sign(offset) === Math.sign(velocity)
  // 明确往回收手时，即使先前拖过了门槛，也让页面回到原位。
  if (!sameDirection && Math.abs(velocity) >= 0.35) return 0
  const flick = sameDirection && Math.abs(velocity) >= 0.45 && distance >= 24
  const projected = sameDirection ? Math.abs(offset + velocity * 120) : distance
  if (!flick && projected < width * 0.28) return 0
  return offset < 0 ? 1 : -1
}

/** 剩余距离短时尽快吸附，长距离轻扫保留足够的过渡。单位为毫秒。 */
export function pageTurnDuration(distance: number, stride: number, velocity = 0): number {
  if (distance < 1 || stride <= 0) return 0
  const fraction = Math.min(distance / stride, 1)
  const natural = 130 + 150 * Math.sqrt(fraction)
  const momentum = distance / (Math.abs(velocity) + 0.8)
  return Math.round(Math.max(110, Math.min(natural, velocity === 0 ? natural : momentum, 280)))
}

export function resistPageBoundary(offset: number, width: number): number {
  const limit = Math.max(0, width * 0.12)
  if (limit === 0) return 0
  return Math.sign(offset) * limit * Math.abs(offset) / (Math.abs(offset) + limit * 2.5)
}
