import { describe, expect, it } from 'vitest'
import { canonicalIngredients, packageOffers, pilotRecipes } from '../data/pilotCatalog'
import { buildGroceryList } from './grocery'
import { removeMealSlot, shiftWeek, startOfWeek, toggleMealLock, upsertMealSlot, weekDates } from './mealPlan'
import type { MealSlot } from './personalData'

const smoky = pilotRecipes.find(({ slug }) => slug === 'smoky-black-bean-soup')!
const slot = (id: string, date: string, servings = 4): MealSlot => ({ id, date, meal: 'Dinner', recipeId: smoky.id, servings, locked: false })

describe('weekly meal planning', () => {
  it('uses Monday-based seven-day weeks and navigates by whole weeks', () => {
    expect(startOfWeek('2026-11-13')).toBe('2026-11-09')
    expect(weekDates('2026-11-09')).toEqual(['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'])
    expect(shiftWeek('2026-11-09', 1)).toBe('2026-11-16')
  })
  it('adds, swaps, removes, and protects locked slots', () => {
    const original = slot('monday-dinner', '2026-11-09')
    const added = upsertMealSlot([], original)
    expect(added).toEqual([original])
    const locked = toggleMealLock(added, original.id)
    expect(upsertMealSlot(locked, { ...original, servings: 8 })).toEqual(locked)
    expect(removeMealSlot(locked, original.id)).toEqual(locked)
    expect(removeMealSlot(toggleMealLock(locked, original.id), original.id)).toEqual([])
  })
  it('keeps repeated calendar slots distinct while consolidating quantities', () => {
    const plan = [slot('monday', '2026-11-09', 4), slot('thursday', '2026-11-12', 8)]
    const grocery = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, plan.map((item) => ({ recipeId: item.recipeId, servings: item.servings, selectionId: item.id, label: item.date })))
    const garlic = grocery.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.total).toEqual({ amount: 6, unit: 'clove' })
    expect(garlic.contributions.map(({ selectionId }) => selectionId)).toEqual(['monday', 'thursday'])
  })
})
