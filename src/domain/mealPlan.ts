import type { MealSlot } from './personalData'

const DAY_MS = 86_400_000
export const parseDateOnly = (iso: string): Date => new Date(`${iso}T12:00:00`)
export const toDateOnly = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const addDays = (iso: string, days: number): string => toDateOnly(new Date(parseDateOnly(iso).getTime() + days * DAY_MS))

export function startOfWeek(iso: string): string {
  const date = parseDateOnly(iso)
  const offset = (date.getDay() + 6) % 7
  return addDays(iso, -offset)
}

export const weekDates = (weekStart: string): string[] => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
export const shiftWeek = (weekStart: string, weeks: number): string => addDays(weekStart, weeks * 7)
export const defaultScheduleDate = (weekStart: string, today: string): string => weekDates(weekStart).includes(today) ? today : weekStart

export function upsertMealSlot(plan: MealSlot[], slot: MealSlot): MealSlot[] {
  const existing = plan.findIndex(({ date, meal }) => date === slot.date && meal === slot.meal)
  if (existing < 0) return [...plan, slot]
  if (plan[existing].locked) return plan
  return plan.map((item, index) => index === existing ? slot : item)
}

export function removeMealSlot(plan: MealSlot[], id: string): MealSlot[] {
  const target = plan.find((slot) => slot.id === id)
  if (target?.locked) return plan
  return plan.filter((slot) => slot.id !== id)
}

export function toggleMealLock(plan: MealSlot[], id: string): MealSlot[] {
  return plan.map((slot) => slot.id === id ? { ...slot, locked: !slot.locked } : slot)
}
