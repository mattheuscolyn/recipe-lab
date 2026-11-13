import { describe, expect, it } from 'vitest'
import { recipeCollection } from '../data/recipes'
import { validateRecipe, validateRecipeCollection } from './validation'

describe('recipe validation pipeline', () => {
  it('accepts the prototype records', () => expect(validateRecipeCollection(recipeCollection).success).toBe(true))
  it('reports invalid fields with stable paths', () => {
    const result = validateRecipe({ ...recipeCollection[0], title: '', steps: [{ ...recipeCollection[0].steps[0], position: 2 }] })
    expect(result.success).toBe(false)
    if (result.success === false) expect(result.issues.map(({ path }) => path)).toEqual(expect.arrayContaining(['title', 'steps']))
  })
  it('rejects duplicate collection identifiers', () => {
    const result = validateRecipeCollection([recipeCollection[0], { ...recipeCollection[1], id: recipeCollection[0].id }])
    expect(result.success).toBe(false)
    if (result.success === false) expect(result.issues[0].message).toContain('Duplicate recipe id')
  })
  it('requires a timestamp after source review', () => {
    const result = validateRecipe({ ...recipeCollection[0], review: { status: 'source-reviewed' } })
    expect(result.success).toBe(false)
    if (result.success === false) expect(result.issues).toContainEqual(expect.objectContaining({ path: 'review.reviewedAt' }))
  })
})
