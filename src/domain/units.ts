import type { CanonicalIngredient, Dimension, UnitCode } from './catalog'

type UnitDefinition = { dimension: Dimension; toBase: number; base: UnitCode }

export const UNIT_DEFINITIONS: Partial<Record<UnitCode, UnitDefinition>> = {
  g: { dimension: 'mass', toBase: 1, base: 'g' }, kg: { dimension: 'mass', toBase: 1000, base: 'g' }, oz_mass: { dimension: 'mass', toBase: 28.349523125, base: 'g' }, lb: { dimension: 'mass', toBase: 453.59237, base: 'g' },
  ml: { dimension: 'volume', toBase: 1, base: 'ml' }, l: { dimension: 'volume', toBase: 1000, base: 'ml' }, fl_oz: { dimension: 'volume', toBase: 29.5735295625, base: 'ml' }, tsp: { dimension: 'volume', toBase: 4.92892159375, base: 'ml' }, tbsp: { dimension: 'volume', toBase: 14.78676478125, base: 'ml' }, cup: { dimension: 'volume', toBase: 236.5882365, base: 'ml' },
}

export type Quantity = { amount: number; unit: UnitCode; approximate?: boolean }

export function dimensionOf(unit: UnitCode): Dimension {
  return UNIT_DEFINITIONS[unit]?.dimension ?? 'count'
}

export function convertQuantity(quantity: Quantity, targetUnit: UnitCode, ingredient?: CanonicalIngredient): Quantity {
  if (quantity.unit === targetUnit) return { ...quantity }
  const source = UNIT_DEFINITIONS[quantity.unit]
  const target = UNIT_DEFINITIONS[targetUnit]
  if (source && target && source.dimension === target.dimension) return { amount: quantity.amount * source.toBase / target.toBase, unit: targetUnit, approximate: quantity.approximate }
  if (dimensionOf(quantity.unit) === 'count' && quantity.unit === ingredient?.baseUnit && targetUnit === ingredient.baseUnit) return { ...quantity, unit: targetUnit }
  throw new Error(`Illegal conversion from ${quantity.unit} to ${targetUnit}; ingredient-specific density or yield is required`)
}

export function formatAmount(value: number): string {
  return Number(value.toFixed(3)).toString()
}
