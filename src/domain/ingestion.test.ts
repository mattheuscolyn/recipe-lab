import { describe, expect, it } from 'vitest'
import { canonicalIngredients } from '../data/pilotCatalog'
import { assertStagingResolved, findCanonicalCandidates, stageRecipeJsonLd } from './ingestion'

describe('ad hoc JSON-LD staging', () => {
  it('matches canonical aliases without discarding source text', () => {
    expect(findCanonicalCandidates('2 tbsp chopped cilantro', canonicalIngredients)).toContain('ingredient-coriander')
    const staged = stageRecipeJsonLd({ '@type': 'Recipe', name: 'Review sample', url: 'https://example.com/recipe', recipeIngredient: ['2 garlic cloves', '1 mystery root'] }, { publisher: 'Manual fixture', checkedAt: '2026-11-13' }, canonicalIngredients)
    expect(staged.ingredients[0]).toMatchObject({ originalText: '2 garlic cloves', status: 'matched' })
    expect(staged.ingredients[1].status).toBe('unmatched')
    expect(() => assertStagingResolved(staged)).toThrow(/mystery root/)
  })
  it('rejects missing source metadata', () => {
    expect(() => stageRecipeJsonLd({ '@type': 'Recipe', name: 'Missing URL', recipeIngredient: [] }, { publisher: 'Example', checkedAt: '2026-11-13' }, canonicalIngredients)).toThrow(/source URL/)
  })
})
