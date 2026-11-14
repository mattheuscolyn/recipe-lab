import { describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { convertQuantity, dimensionOf } from './units'

describe('unit dimensions', () => {
  it('normalizes tablespoons into cups deterministically', () => {
    const converted = convertQuantity({ amount: 2, unit: 'tbsp' }, 'cup')
    expect(1 + converted.amount).toBeCloseTo(1.125, 10)
  })
  it('converts mass units and keeps fluid ounces distinct', () => {
    expect(convertQuantity({ amount: 1, unit: 'oz_mass' }, 'g').amount).toBeCloseTo(28.3495, 4)
    expect(dimensionOf('fl_oz')).toBe('volume')
    expect(dimensionOf('oz_mass')).toBe('mass')
    expect(() => convertQuantity({ amount: 1, unit: 'oz_mass' }, 'fl_oz')).toThrow(/Illegal conversion/)
  })
  it('does not infer cloves from heads without an offer yield', () => {
    const garlic = canonicalIngredients.find(({ id }) => id === 'ingredient-garlic')!
    expect(() => convertQuantity({ amount: 1, unit: 'head' }, 'clove', garlic)).toThrow(/yield is required/)
  })
})
