import { describe, expect, it } from 'vitest'
import { legacyFixtureKnownIssues } from '../data/legacyQuality'
import { canonicalIngredients, packageOffers, pilotCatalog, pilotRecipes } from '../data/pilotCatalog'
import { sourceReviewReport } from '../data/sourceReview'
import { validateCatalog } from './catalogValidation'

describe('schema-v2 pilot catalog', () => {
  it('contains exactly twenty-five distinct real recipes from five publishers', () => {
    expect(pilotRecipes).toHaveLength(25)
    expect(new Set(pilotRecipes.map(({ source }) => source.publisher)).size).toBe(5)
    expect(validateCatalog(pilotCatalog).success).toBe(true)
  })
  it('rejects an incompatible package quantity when no usable yield is supplied', () => {
    const broken = structuredClone(pilotCatalog)
    broken.offers[0].packageQuantity = { amount: 1, unit: 'item', approximate: false }
    broken.offers[0].usableYield = null
    broken.offers[0].conversionNote = null
    const result = validateCatalog(broken)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues.some(({ path, message }) => path.endsWith('packageQuantity') && message.includes('base dimension'))).toBe(true)
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
  it('maps every manually attested source line to one or more normalized requirements', () => {
    expect(sourceReviewReport).toHaveLength(25)
    expect(new Set(sourceReviewReport.map(({ slug }) => slug)).size).toBe(25)
    sourceReviewReport.forEach((entry) => {
      const recipe = pilotRecipes.find(({ slug }) => slug === entry.slug)
      expect(recipe, entry.slug).toBeDefined()
      expect(recipe?.requirements.length, entry.slug).toBe(entry.recordRequirementLines)
      expect(new Set(recipe?.requirements.map(({ sourceLineId }) => sourceLineId)).size, entry.slug).toBe(entry.sourceIngredientLines)
    })
    expect(sourceReviewReport.reduce((sum, entry) => sum + entry.sourceIngredientLines, 0)).toBe(282)
    expect(sourceReviewReport.reduce((sum, entry) => sum + entry.recordRequirementLines, 0)).toBe(285)
  })
  it('documents completeness failures in every legacy synthetic fixture', () => {
    expect(legacyFixtureKnownIssues).toHaveLength(4)
    expect(legacyFixtureKnownIssues.find(({ slug }) => slug === 'olive-oil-chocolate-cake')?.missingMethodIngredients).toEqual(expect.arrayContaining(['eggs', 'coffee', 'flaky salt']))
  })
})
