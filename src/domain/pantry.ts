import type { CanonicalIngredient, UnitCode } from './catalog'
import { dimensionOf } from './units'

const ALL_UNITS: UnitCode[] = ['g', 'kg', 'oz_mass', 'lb', 'ml', 'l', 'fl_oz', 'tsp', 'tbsp', 'cup', 'item', 'clove', 'head', 'can', 'pinch']

export type PantryDateState = 'expired' | 'soon' | 'later' | 'none'

export function pantryDateState(bestBy: string | null, today: string): PantryDateState {
  if (!bestBy) return 'none'
  const day = 86_400_000
  const difference = Math.round((new Date(`${bestBy}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / day)
  if (difference < 0) return 'expired'
  if (difference <= 7) return 'soon'
  return 'later'
}

export function compatiblePantryUnits(ingredient: CanonicalIngredient): UnitCode[] {
  const baseDimension = dimensionOf(ingredient.baseUnit)
  if (baseDimension === 'count') return [ingredient.baseUnit]
  return [ingredient.baseUnit, ...ALL_UNITS.filter((unit) => unit !== ingredient.baseUnit && dimensionOf(unit) === baseDimension)]
}
