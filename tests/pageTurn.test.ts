import { describe, expect, it } from 'vitest'
import { pageTurnDuration, resistPageBoundary, resolvePageTurn } from '@/domain/pageTurn'

describe('page turn intent', () => {
  it('keeps small accidental movements on the current page', () => {
    expect(resolvePageTurn(-12, -2, 390)).toBe(0)
    expect(resolvePageTurn(18, 2, 390)).toBe(0)
    expect(resolvePageTurn(-70, 0, 390)).toBe(0)
  })

  it('accepts a deliberate short flick in either direction', () => {
    expect(resolvePageTurn(-36, -0.8, 390)).toBe(1)
    expect(resolvePageTurn(36, 0.8, 390)).toBe(-1)
  })

  it('accepts a slow drag beyond the threshold with no flick', () => {
    expect(resolvePageTurn(-140, 0, 390)).toBe(1)
    expect(resolvePageTurn(140, 0, 390)).toBe(-1)
  })

  it('cancels when the reader pulls back before lifting their finger', () => {
    expect(resolvePageTurn(-180, 0.7, 390)).toBe(0)
    expect(resolvePageTurn(180, -0.7, 390)).toBe(0)
    expect(resolvePageTurn(-5, 0.7, 390)).toBe(0)
  })

  it('uses momentum for a near-threshold release and handles unmeasured pages', () => {
    expect(resolvePageTurn(-95, -0.2, 390)).toBe(1)
    expect(resolvePageTurn(-95, 0, 390)).toBe(0)
    expect(resolvePageTurn(-150, -1, 0)).toBe(0)
  })
})

describe('page motion', () => {
  it('settles a short remaining distance faster than a whole page', () => {
    expect(pageTurnDuration(40, 390)).toBeLessThan(pageTurnDuration(390, 390))
    expect(pageTurnDuration(200, 390, 2)).toBeLessThan(pageTurnDuration(200, 390))
    expect(pageTurnDuration(0, 390)).toBe(0)
    expect(pageTurnDuration(100, 0)).toBe(0)
  })

  it('bounds motion duration even after an unusually fast or long drag', () => {
    expect(pageTurnDuration(390, 390, 10)).toBeGreaterThanOrEqual(110)
    expect(pageTurnDuration(1000, 390)).toBeLessThanOrEqual(280)
  })

  it('provides smooth, bounded resistance at the ends of the book', () => {
    const small = resistPageBoundary(30, 390)
    const large = resistPageBoundary(300, 390)
    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThan(390 * 0.12)
    expect(resistPageBoundary(-300, 390)).toBe(-large)
    expect(resistPageBoundary(300, 0)).toBe(0)
  })
})
