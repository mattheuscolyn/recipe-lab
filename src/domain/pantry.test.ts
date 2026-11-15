import { describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { compatiblePantryUnits, pantryDateState } from './pantry'

describe('pantry safety helpers', () => {
  it('classifies best-by dates against a fixed local date without making disposal claims', () => {
    const today = '2026-11-15'
    expect(pantryDateState('2026-11-14', today)).toBe('expired')
    expect(pantryDateState('2026-11-15', today)).toBe('soon')
    expect(pantryDateState('2026-11-22', today)).toBe('soon')
    expect(pantryDateState('2026-11-23', today)).toBe('later')
    expect(pantryDateState(null, today)).toBe('none')
  })

  it('offers dimension-compatible units but does not invent count yields', () => {
    const garlic = canonicalIngredients.find(({ id }) => id === 'ingredient-garlic')!
    const flour = canonicalIngredients.find(({ id }) => id === 'ingredient-flour')!
    expect(compatiblePantryUnits(garlic)).toEqual(['clove'])
    expect(compatiblePantryUnits(flour)).toEqual(expect.arrayContaining(['g', 'kg', 'oz_mass', 'lb']))
    expect(compatiblePantryUnits(flour)).not.toContain('cup')
  })
})
