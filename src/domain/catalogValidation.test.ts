import { describe, expect, it } from 'vitest'
import { legacyFixtureKnownIssues } from '../data/legacyQuality'
import { canonicalIngredients, packageOffers, pilotCatalog, pilotRecipes } from '../data/pilotCatalog'
import { validateCatalog } from './catalogValidation'

describe('schema-v2 pilot catalog', () => {
  it('contains exactly five distinct real recipes from five publishers', () => {
    expect(pilotRecipes).toHaveLength(5)
    expect(new Set(pilotRecipes.map(({ source }) => source.publisher)).size).toBe(5)
    expect(validateCatalog(pilotCatalog).success).toBe(true)
  })
  it('fails loudly for unresolved canonical ids and dimensional mismatches', () => {
    const broken = structuredClone(pilotCatalog)
    broken.recipes[0].requirements[0].canonicalIngredientId = 'ingredient-not-real'
    const result = validateCatalog(broken)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues.some(({ message }) => message.includes('Unknown canonical ingredient'))).toBe(true)
  })
  it('keeps canonical ingredients, requirements, and offers separate', () => {
    expect(canonicalIngredients.length).toBeGreaterThan(30)
    expect(pilotRecipes.every(({ requirements }) => requirements.every(({ originalText }) => originalText.length > 0))).toBe(true)
    expect(packageOffers.every(({ estimate }) => estimate)).toBe(true)
  })
  it('documents completeness failures in every legacy synthetic fixture', () => {
    expect(legacyFixtureKnownIssues).toHaveLength(4)
    expect(legacyFixtureKnownIssues.find(({ slug }) => slug === 'olive-oil-chocolate-cake')?.missingMethodIngredients).toEqual(expect.arrayContaining(['eggs', 'coffee', 'flaky salt']))
  })
})
