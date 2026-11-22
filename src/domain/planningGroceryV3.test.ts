import { describe, expect, it } from 'vitest'
import { canonicalIngredients, pilotRecipes } from '../data/pilotCatalog'
import type { CanonicalIngredient } from './catalog'
import { buildBatchGroceryDemand } from './planningGroceryV3'
import { planCookingBatch } from './planningV3'
import type { RecipeV3 } from './recipeV3'
import { adaptRecipeV2ToDraftV3 } from './recipeV3Migration'

function parsleyFixture(): { recipe: RecipeV3; ingredient: CanonicalIngredient } {
  const recipe = adaptRecipeV2ToDraftV3(pilotRecipes.find(({ slug }) => slug === 'smoky-black-bean-soup')!)
  recipe.identity = { ...recipe.identity, recipeId: '22222222-2222-4222-8222-222222222222', revisionId: 'revision-synthetic-parsley-batch-v1', slug: 'synthetic-parsley-batch', title: 'Synthetic Parsley Batch' }
  const evidenceIds = recipe.output.sourceYield.evidenceIds
  recipe.output.scaling = { policy: 'linear-reviewed', allowedMultipliers: [1, 2], note: 'Synthetic grocery fixture.' }
  recipe.requirements = [{
    ...recipe.requirements[0],
    requirementId: 'requirement-parsley',
    sourceLineId: 'source-line-parsley',
    originalText: '20 g fresh parsley',
    canonicalIngredientId: 'ingredient-parsley',
    variantId: 'variant-parsley-fresh-bunch',
    sourceQuantity: { amount: 20, range: null, unit: 'g', approximate: false, originalText: '20 g', evidenceIds },
    selectedPlanningQuantity: { amount: 20, range: null, unit: 'g', approximate: false, originalText: '20 g', evidenceIds },
    scaling: 'linear',
    confidence: 'reviewed',
    reviewNote: null,
    nonQuantified: null,
    optional: false,
  }]
  const original = canonicalIngredients.find(({ id }) => id === 'ingredient-parsley')!
  return { recipe, ingredient: { ...original, baseUnit: 'g' } }
}

function batch(recipe: RecipeV3, suffix: string) {
  return planCookingBatch(recipe, { batchId: `batch-${suffix}`, groceryDemandId: `grocery-demand-${suffix}`, multiplier: 1 })
}

describe('batch-derived grocery demand', () => {
  it('S07 counts two cooking batches once each, consolidates them, and subtracts confirmed pantry once', () => {
    const { recipe, ingredient } = parsleyFixture()
    const pantry = [{ availabilityId: 'availability-parsley', canonicalIngredientId: ingredient.id, variantId: ingredient.variants[0].id, confidence: 'confirmed-measured' as const, quantity: { amount: 15, unit: 'g' as const } }]
    const before = JSON.stringify(pantry)
    const demand = buildBatchGroceryDemand({
      recipes: [recipe],
      ingredients: [ingredient],
      batches: [batch(recipe, 'monday'), batch(recipe, 'thursday')],
      scope: 'historical',
      pantry,
    })
    expect(demand.lines).toHaveLength(1)
    expect(demand.lines[0]).toMatchObject({ total: 40, knownSubtotal: 40, pantry: { applied: 15, toBuy: 25, knownToBuy: 25 } })
    expect(demand.lines[0].contributions.map(({ batchId }) => batchId)).toEqual(['batch-monday', 'batch-thursday'])
    expect(JSON.stringify(pantry)).toBe(before)
  })

  it('S09 refuses an incompatible pantry conversion and exposes an uncertainty instead of subtracting it', () => {
    const { recipe, ingredient } = parsleyFixture()
    const demand = buildBatchGroceryDemand({
      recipes: [recipe],
      ingredients: [ingredient],
      batches: [batch(recipe, 'one')],
      scope: 'outstanding',
      pantry: [{ availabilityId: 'availability-parsley-volume', canonicalIngredientId: ingredient.id, variantId: ingredient.variants[0].id, confidence: 'confirmed-measured', quantity: { amount: 1, unit: 'cup' } }],
    })
    expect(demand.lines[0].pantry).toMatchObject({ applied: 0, toBuy: 20, checkAvailabilityIds: ['availability-parsley-volume'] })
    expect(demand.uncertainties.join(' ')).toMatch(/Illegal conversion/)
  })

  it('never treats likely, unquantified, missing, or wrong-variant pantry records as offsets', () => {
    const { recipe, ingredient } = parsleyFixture()
    const demand = buildBatchGroceryDemand({
      recipes: [recipe],
      ingredients: [ingredient],
      batches: [batch(recipe, 'one')],
      scope: 'outstanding',
      pantry: [
        { availabilityId: 'availability-likely', canonicalIngredientId: ingredient.id, variantId: ingredient.variants[0].id, confidence: 'likely-owned', quantity: null },
        { availabilityId: 'availability-wrong-variant', canonicalIngredientId: ingredient.id, variantId: 'variant-parsley-curly', confidence: 'confirmed-measured', quantity: { amount: 20, unit: 'g' } },
      ],
    })
    expect(demand.lines[0].pantry.applied).toBe(0)
    expect(demand.lines[0].pantry.checkAvailabilityIds).toEqual(['availability-likely', 'availability-wrong-variant'])
    expect(demand.lines[0].uncertainties.join(' ')).toMatch(/does not match required variant/)
  })

  it('keeps unresolved amounts visible and does not present a false precise total', () => {
    const { recipe, ingredient } = parsleyFixture()
    recipe.requirements[0] = { ...recipe.requirements[0], selectedPlanningQuantity: null, sourceQuantity: null, nonQuantified: 'as-needed' }
    const line = buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [batch(recipe, 'one')], scope: 'outstanding' }).lines[0]
    expect(line).toMatchObject({ total: null, knownSubtotal: 0, unresolved: true, pantry: { toBuy: null, knownToBuy: 0 } })
    expect(line.uncertainties[0]).toMatch(/Non-quantified/)
  })

  it('excludes optional requirements by default and includes them only when requested', () => {
    const { recipe, ingredient } = parsleyFixture()
    recipe.requirements[0].optional = true
    expect(buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [batch(recipe, 'one')], scope: 'outstanding' }).lines).toEqual([])
    expect(buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [batch(recipe, 'one')], scope: 'outstanding', includeOptional: true }).lines[0].optional).toBe(true)
  })

  it('uses the exact selected alternative instead of silently purchasing the primary ingredient', () => {
    const { recipe, ingredient } = parsleyFixture()
    const alternateVariant = { id: 'variant-parsley-curly', label: 'Curly parsley', form: 'fresh' }
    ingredient.variants.push(alternateVariant)
    recipe.requirements[0].alternatives = [{
      alternativeId: 'alternative-curly-parsley',
      label: '10 g curly parsley',
      canonicalIngredientId: ingredient.id,
      variantId: alternateVariant.id,
      quantity: { ...recipe.requirements[0].selectedPlanningQuantity!, amount: 10, originalText: '10 g' },
      relationship: 'substitution',
    }]
    const planned = batch(recipe, 'alternative')
    const demand = buildBatchGroceryDemand({
      recipes: [recipe],
      ingredients: [ingredient],
      batches: [planned],
      scope: 'outstanding',
      ingredientSelections: [{ batchId: planned.batchId, requirementId: recipe.requirements[0].requirementId, selection: 'alternative', alternativeId: 'alternative-curly-parsley' }],
    })
    expect(demand.lines).toEqual([expect.objectContaining({ variantId: alternateVariant.id, total: 10 })])
    expect(demand.lines[0].contributions[0].originalText).toMatch(/curly parsley/)
  })

  it('honors explicit optional inclusion and exclusion per batch', () => {
    const { recipe, ingredient } = parsleyFixture()
    recipe.requirements[0].optional = true
    const included = batch(recipe, 'optional-included')
    const excluded = batch(recipe, 'optional-excluded')
    const demand = buildBatchGroceryDemand({
      recipes: [recipe], ingredients: [ingredient], batches: [included, excluded], scope: 'outstanding',
      ingredientSelections: [
        { batchId: included.batchId, requirementId: recipe.requirements[0].requirementId, selection: 'primary', alternativeId: null },
        { batchId: excluded.batchId, requirementId: recipe.requirements[0].requirementId, selection: 'excluded-optional', alternativeId: null },
      ],
    })
    expect(demand.lines[0]).toMatchObject({ total: 20, optional: true })
    expect(demand.lines[0].contributions.map(({ batchId }) => batchId)).toEqual([included.batchId])
  })

  it('rejects unresolved alternative branches rather than assuming the primary ingredient', () => {
    const { recipe, ingredient } = parsleyFixture()
    recipe.requirements[0].alternatives = [{ alternativeId: 'alternative-curly-parsley', label: 'Curly parsley', canonicalIngredientId: ingredient.id, variantId: ingredient.variants.at(-1)!.id, quantity: recipe.requirements[0].selectedPlanningQuantity, relationship: 'substitution' }]
    expect(() => buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [batch(recipe, 'unresolved-branch')], scope: 'outstanding' })).toThrow(/explicit batch selection/)
  })

  it('distinguishes historical ingredient demand from outstanding shopping requirements', () => {
    const { recipe, ingredient } = parsleyFixture()
    const planned = batch(recipe, 'cooked')
    const prepared = { ...planned, state: 'prepared' as const, actualOutput: planned.plannedOutput }
    const historical = buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [prepared], scope: 'historical' })
    const outstanding = buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [prepared], scope: 'outstanding' })
    expect(historical).toMatchObject({ scope: 'historical', lines: [{ total: 20 }] })
    expect(outstanding).toEqual({ scope: 'outstanding', lines: [], uncertainties: [] })
  })

  it('rejects duplicate batch identities and missing exact recipe revisions', () => {
    const { recipe, ingredient } = parsleyFixture()
    const one = batch(recipe, 'one')
    expect(() => buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [one, one], scope: 'outstanding' })).toThrow(/only once/)
    expect(() => buildBatchGroceryDemand({ recipes: [{ ...recipe, identity: { ...recipe.identity, revisionId: 'revision-other' } }], ingredients: [ingredient], batches: [one], scope: 'outstanding' })).toThrow(/Missing exact recipe revision/)
    const availability = { availabilityId: 'availability-duplicate', canonicalIngredientId: ingredient.id, variantId: ingredient.variants[0].id, confidence: 'confirmed-measured' as const, quantity: { amount: 5, unit: 'g' as const } }
    expect(() => buildBatchGroceryDemand({ recipes: [recipe], ingredients: [ingredient], batches: [one], scope: 'outstanding', pantry: [availability, availability] })).toThrow(/only once/)
  })
})
