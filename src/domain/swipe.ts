export const SWIPE_COMMIT_THRESHOLD = 96
export const GESTURE_LOCK_DISTANCE = 8
export const DIRECTION_DOMINANCE = 1.15

export type GestureIntent = 'pending' | 'horizontal' | 'vertical'
export type SwipeDecision = 'interested' | 'passed' | null

export function gestureIntent(dx: number, dy: number): GestureIntent {
  const horizontal = Math.abs(dx)
  const vertical = Math.abs(dy)

  if (Math.max(horizontal, vertical) < GESTURE_LOCK_DISTANCE) return 'pending'
  if (vertical > horizontal * DIRECTION_DOMINANCE) return 'vertical'
  if (horizontal > vertical * DIRECTION_DOMINANCE) return 'horizontal'
  return 'pending'
}

export function swipeDecision(dx: number, dy: number, threshold = SWIPE_COMMIT_THRESHOLD): SwipeDecision {
  if (gestureIntent(dx, dy) !== 'horizontal' || Math.abs(dx) < threshold) return null
  return dx > 0 ? 'interested' : 'passed'
}
