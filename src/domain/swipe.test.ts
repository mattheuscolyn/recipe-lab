import { describe, expect, it } from 'vitest'
import { gestureIntent, swipeDecision } from './swipe'

describe('swipe gesture classification', () => {
  it('commits right and left drags beyond the threshold', () => {
    expect(swipeDecision(120, 10)).toBe('interested')
    expect(swipeDecision(-120, 10)).toBe('passed')
  })

  it('cancels short and ambiguous diagonal drags', () => {
    expect(swipeDecision(95, 0)).toBeNull()
    expect(swipeDecision(-40, 5)).toBeNull()
    expect(swipeDecision(120, 110)).toBeNull()
  })

  it('locks vertical motion as scrolling rather than a decision', () => {
    expect(gestureIntent(8, 90)).toBe('vertical')
    expect(swipeDecision(8, 160)).toBeNull()
  })
})
