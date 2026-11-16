import { describe, expect, it } from 'vitest'
import { canonicalIngredients, pilotRecipes } from '../data/pilotCatalog'
import { computeRecipeV3Readiness, recipeV3Schema, validateRecipeV3Catalog, type RecipeV3 } from './recipeV3'
import { adaptRecipeCatalogV2ToV3, adaptRecipeV2ToDraftV3 } from './recipeV3Migration'

const migration = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients)
const migratedRecipes = migration.recipes

const cloneRecipe = (index = 0): RecipeV3 => structuredClone(migratedRecipes[index])
const refreshReadiness = (recipe: RecipeV3): RecipeV3 => {
  recipe.review.readiness = computeRecipeV3Readiness(recipe)
  return recipe
}

describe('recipe v2 to v3 compatibility migration', () => {
  it('migrates and validates all 25 recipes without changing the live v2 catalog', () => {
    expect(migratedRecipes).toHaveLength(25)
    expect(migratedRecipes.every(({ schemaVersion }) => schemaVersion === 3)).toBe(true)
    expect(pilotRecipes.every(({ schemaVersion }) => schemaVersion === 2)).toBe(true)
    expect(validateRecipeV3Catalog({ ingredients: canonicalIngredients, recipes: migratedRecipes }).success).toBe(true)
  })

  it('preserves stable recipe, requirement, source-line, ingredient, and variant ids', () => {
    pilotRecipes.forEach((sourceRecipe) => {
      const migrated = migratedRecipes.find(({ identity }) => identity.recipeId === sourceRecipe.id)
      expect(migrated, sourceRecipe.slug).toBeDefined()
      expect(migrated?.identity.slug).toBe(sourceRecipe.slug)
      expect(migrated?.identity.revisionId).toBe(`revision-${sourceRecipe.id}-v2`)
      expect(migrated?.requirements.map(({ requirementId }) => requirementId)).toEqual(sourceRecipe.requirements.map(({ id }) => id))
      expect(migrated?.requirements.map(({ sourceLineId }) => sourceLineId)).toEqual(sourceRecipe.requirements.map(({ sourceLineId }) => sourceLineId))
      expect(migrated?.requirements.map(({ canonicalIngredientId, variantId }) => ({ canonicalIngredientId, variantId }))).toEqual(sourceRecipe.requirements.map(({ canonicalIngredientId, variantId }) => ({ canonicalIngredientId, variantId })))
    })
  })

  it('preserves source yield definitions without inventing serving sizes', () => {
    pilotRecipes.forEach((sourceRecipe) => {
      const migrated = migratedRecipes.find(({ identity }) => identity.recipeId === sourceRecipe.id)!
      expect(migrated.output.sourceYield.amount).toBe(sourceRecipe.yield.source.amount)
      expect(migrated.output.sourceYield.range).toEqual(sourceRecipe.yield.source.range)
      expect(migrated.output.sourceYield.unit).toBe(sourceRecipe.yield.source.unit)
      expect(migrated.output.sourceYield.label).toBe(sourceRecipe.yield.source.label)
      expect(migrated.output.sourceServing.servingSize).toBeNull()
      expect(migrated.output.sourceServing.servingLabel).toBeNull()
    })
    expect(migratedRecipes.filter(({ output }) => output.kind === 'flexible-batch')).toHaveLength(18)
    expect(migratedRecipes.filter(({ output }) => output.kind === 'discrete-items')).toHaveLength(7)
    expect(migratedRecipes.filter(({ output }) => output.sourceYield.range !== null)).toHaveLength(2)
  })

  it('preserves source lines, selected quantities, ranges, alternatives, packages, and review notes', () => {
    pilotRecipes.forEach((sourceRecipe) => {
      const migrated = migratedRecipes.find(({ identity }) => identity.recipeId === sourceRecipe.id)!
      sourceRecipe.requirements.forEach((sourceRequirement, index) => {
        const target = migrated.requirements[index]
        expect(target.originalText).toBe(sourceRequirement.originalText)
        expect(target.selectedPlanningQuantity?.amount ?? null).toBe(sourceRequirement.quantity?.amount ?? null)
        expect(target.selectedPlanningQuantity?.unit ?? null).toBe(sourceRequirement.quantity?.unit ?? null)
        expect(target.sourceQuantity?.range ?? null).toEqual(sourceRequirement.sourceRange ? { min: sourceRequirement.sourceRange.min, max: sourceRequirement.sourceRange.max } : null)
        expect(target.alternatives.map(({ label, canonicalIngredientId, variantId }) => ({ label, canonicalIngredientId, variantId }))).toEqual(sourceRequirement.alternatives.map(({ label, canonicalIngredientId, variantId }) => ({ label, canonicalIngredientId, variantId })))
        expect(target.reviewNote).toBe(sourceRequirement.reviewNote)
        expect(target.confidence).toBe(sourceRequirement.confidence)
        expect(target.sourcePackage?.count ?? null).toBe(sourceRequirement.sourcePackage?.count ?? null)
      })
    })
  })

  it('keeps incompatible original source measures as evidence without treating them as planning conversions', () => {
    const recipe = migratedRecipes.find(({ identity }) => identity.slug === 'hearty-black-bean-quesadillas')!
    const onion = recipe.requirements.find(({ requirementId }) => requirementId === 'requirement-quesadillas-onion')!
    expect(onion.sourceQuantity).toMatchObject({ amount: 0.5, unit: 'cup' })
    expect(onion.selectedPlanningQuantity).toBeNull()
    expect(onion.nonQuantified).toBe('as-needed')
    expect(validateRecipeV3Catalog({ ingredients: canonicalIngredients, recipes: migratedRecipes }).success).toBe(true)
  })

  it('does not promote legacy method summaries to structured cooking steps', () => {
    migratedRecipes.forEach((migrated, index) => {
      expect(migrated.legacyMethodSummary).toEqual(pilotRecipes[index].methodSummary)
      expect(migrated.steps).toEqual([])
      expect(migrated.review.structuredStepsReviewed).toBe(false)
    })
  })

  it('uses explicit unknown states and conservative rights defaults', () => {
    migratedRecipes.forEach((recipe) => {
      expect(recipe.nutrition.status).toBe('unknown')
      expect(recipe.nutrition.caloriesKcal).toMatchObject({ value: null, confidence: 'unknown' })
      expect(recipe.equipment).toEqual([])
      expect(recipe.equipmentReviewState).toBe('unknown')
      expect(recipe.suitability.reviewState).toBe('unknown')
      expect(recipe.suitability.storageModes).toEqual([])
      expect(recipe.source.rights).toMatchObject({ factualMetadataUse: 'review-needed', methodTextUse: 'independent-summary-only', imageUse: 'none' })
    })
  })

  it('makes every migrated record minimum-import-ready but not recommendation- or cooking-ready', () => {
    migratedRecipes.forEach((recipe) => {
      expect(recipe.review.readiness.minimumSafeImport).toBe(true)
      expect(recipe.review.readiness.recommendationReady).toBe(false)
      expect(recipe.review.readiness.cookingModeReady).toBe(false)
      expect(recipe.review.readiness.blockers).toEqual(expect.arrayContaining([
        'output-scaling-review-required',
        'meal-portion-guidance-missing',
        'active-time-unknown',
        'suitability-unknown',
        'structured-steps-missing',
        'equipment-unreviewed',
        'rights-review-required',
      ]))
    })
  })

  it('produces the reproducible audit totals from the approved 25-recipe snapshot', () => {
    expect(migration.report).toMatchObject({ schemaVersion: 3, recipeCount: 25, successfulMigrations: 25, failedMigrations: 0 })
    expect(migration.report.totals).toEqual({
      requirements: 285,
      sourceLines: 282,
      alternatives: 9,
      sourceRanges: 2,
      sourcePackages: 1,
      methodSummaryLines: 75,
    })
    expect(migration.report.entries.every(({ initializedUnknown }) => initializedUnknown.includes('nutrition') && initializedUnknown.includes('storage-and-leftover-suitability'))).toBe(true)
  })

  it('is deterministic and survives JSON serialization', () => {
    const untouchedV2 = structuredClone(pilotRecipes)
    const first = pilotRecipes.map(adaptRecipeV2ToDraftV3)
    const second = pilotRecipes.map(adaptRecipeV2ToDraftV3)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(recipeV3Schema.array().parse(JSON.parse(JSON.stringify(first)))).toEqual(first)
    expect(pilotRecipes).toEqual(untouchedV2)
  })

  it('preserves a kitchen-tested lifecycle without inventing a kitchen-test date', () => {
    const kitchenTested = structuredClone(pilotRecipes[0])
    kitchenTested.review.status = 'kitchen-tested'
    const migrated = adaptRecipeV2ToDraftV3(kitchenTested)
    expect(migrated.identity.lifecycle).toBe('kitchen-tested')
    expect(migrated.review.kitchenTestedAt).toBeNull()
    expect(migrated.review.readiness.blockers).toContain('kitchen-test-date-unknown')
    expect(migrated.review.readiness.cookingModeReady).toBe(false)
  })

  it('preserves Dessert as a distinct primary meal role', () => {
    const dessert = structuredClone(pilotRecipes[0])
    dessert.id = '20000000-0000-4000-8000-000000000001'
    dessert.slug = 'synthetic-dessert-fixture'
    dessert.title = 'Synthetic Dessert Fixture'
    dessert.category = 'Dessert'
    const migrated = adaptRecipeV2ToDraftV3(dessert)
    expect(migrated.mealRoles.primary).toEqual(['dessert'])
    expect(migrated.mealRoles.primary).not.toContain('snack')
  })
})

describe('recipe v3 validation', () => {
  it('rejects known values without evidence and false unknown nutrition', () => {
    const missingEvidence = cloneRecipe()
    missingEvidence.effort.prepMinutes.evidenceIds = []
    expect(recipeV3Schema.safeParse(missingEvidence).success).toBe(false)

    const falseUnknown = cloneRecipe()
    falseUnknown.nutrition.caloriesKcal.value = 0
    expect(recipeV3Schema.safeParse(falseUnknown).success).toBe(false)
  })

  it('accepts publisher nutrition only with an explicit serving basis and evidence', () => {
    const recipe = cloneRecipe()
    const evidenceId = recipe.source.evidence[0].evidenceId
    recipe.nutrition.status = 'publisher-reported'
    recipe.nutrition.basis = 'source-serving'
    recipe.nutrition.servingsInBasis = 1
    recipe.nutrition.caloriesKcal = { value: 200, evidenceIds: [evidenceId], confidence: 'reported', unknownReason: null }
    expect(recipeV3Schema.safeParse(recipe).success).toBe(true)

    recipe.nutrition.basis = null
    expect(recipeV3Schema.safeParse(recipe).success).toBe(false)
  })

  it('rejects dangling evidence, component, step, and equipment references', () => {
    const danglingEvidence = cloneRecipe()
    danglingEvidence.output.sourceYield.evidenceIds = ['evidence-not-real']
    expect(recipeV3Schema.safeParse(danglingEvidence).success).toBe(false)

    const danglingComponent = cloneRecipe()
    danglingComponent.requirements[0].componentId = 'component-not-real'
    expect(recipeV3Schema.safeParse(danglingComponent).success).toBe(false)

    const danglingStep = cloneRecipe()
    const sourceEvidence = danglingStep.source.evidence[0].evidenceId
    danglingStep.steps = [{
      stepId: 'step-first', stage: 'cook', order: 1, instruction: 'An independently written test instruction.',
      ingredientUses: [{ requirementId: 'requirement-not-real', use: 'all', quantity: null }],
      equipmentIds: ['equipment-not-real'], duration: { kind: 'active', minutes: 5 }, timer: null,
      canPrepareAhead: null, blockingStepIds: [], techniqueTipIds: [], evidenceIds: [sourceEvidence],
    }]
    expect(recipeV3Schema.safeParse(danglingStep).success).toBe(false)
  })

  it('enforces whole-item output and reviewed multiplier integrality', () => {
    const discrete = cloneRecipe(migratedRecipes.findIndex(({ output }) => output.kind === 'discrete-items'))
    discrete.output.sourceYield.amount = 1.5
    if (discrete.output.discreteItem) discrete.output.discreteItem.itemCount = 1.5
    expect(recipeV3Schema.safeParse(discrete).success).toBe(false)

    const fractionalMultiplier = cloneRecipe(migratedRecipes.findIndex(({ identity }) => identity.slug === 'banana-flax-muffins'))
    fractionalMultiplier.output.scaling = { policy: 'whole-items-only', allowedMultipliers: [0.25, 1], note: null }
    refreshReadiness(fractionalMultiplier)
    const result = recipeV3Schema.safeParse(fractionalMultiplier)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some(({ message }) => message.includes('fractional items'))).toBe(true)
  })

  it('rejects incompatible planning units while retaining incompatible source facts', () => {
    const broken = cloneRecipe()
    broken.requirements[0].selectedPlanningQuantity = {
      amount: 1,
      range: null,
      unit: 'g',
      approximate: false,
      originalText: 'invalid planning conversion',
      evidenceIds: [broken.source.evidence[0].evidenceId],
    }
    const result = validateRecipeV3Catalog({ ingredients: canonicalIngredients, recipes: [broken] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues.some(({ message }) => message.includes('incompatible with base unit'))).toBe(true)
  })

  it('rejects duplicate revision ids and unknown canonical references', () => {
    const first = cloneRecipe(0)
    const second = cloneRecipe(1)
    second.identity.revisionId = first.identity.revisionId
    second.requirements[0].canonicalIngredientId = 'ingredient-not-real'
    const result = validateRecipeV3Catalog({ ingredients: canonicalIngredients, recipes: [first, second] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.some(({ message }) => message.includes('Duplicate revision-'))).toBe(true)
      expect(result.issues.some(({ message }) => message.includes('Unknown canonical ingredient'))).toBe(true)
    }
  })

  it('rejects readiness claims that do not match derived gates', () => {
    const recipe = cloneRecipe()
    recipe.review.readiness.recommendationReady = true
    const result = recipeV3Schema.safeParse(recipe)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some(({ message }) => message.includes('Readiness must be derived'))).toBe(true)
  })

  it('keeps an incompletely reviewed draft below every readiness gate', () => {
    const recipe = cloneRecipe()
    recipe.identity.lifecycle = 'draft'
    recipe.review.ingredientCompletenessReviewed = false
    refreshReadiness(recipe)
    expect(recipe.review.readiness.minimumSafeImport).toBe(false)
    expect(recipe.review.readiness.recommendationReady).toBe(false)
    expect(recipe.review.readiness.cookingModeReady).toBe(false)
    expect(recipe.review.readiness.blockers).toContain('ingredient-completeness-unreviewed')
    expect(recipeV3Schema.safeParse(recipe).success).toBe(true)
  })

  it('requires approved rather than restricted rights for public-use readiness', () => {
    const recipe = cloneRecipe()
    const evidenceId = recipe.source.evidence[0].evidenceId
    recipe.output.scaling = { policy: 'fixed-batch', allowedMultipliers: [1], note: 'Original batch only.' }
    recipe.output.planningGuidance.sourceServingsPerMealPortion = { value: 1, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
    recipe.effort.activeMinutes = { value: 20, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
    recipe.suitability.reviewState = 'editor-reviewed'
    recipe.source.rights.factualMetadataUse = 'restricted'
    refreshReadiness(recipe)
    expect(recipe.review.readiness.minimumSafeImport).toBe(true)
    expect(recipe.review.readiness.recommendationReady).toBe(false)
    expect(recipe.review.readiness.cookingModeReady).toBe(false)
    expect(recipe.review.readiness.blockers).toContain('rights-restricted')
    expect(recipeV3Schema.safeParse(recipe).success).toBe(true)
  })

  it('pins linked subrecipes to an exact recipe revision', () => {
    const parent = cloneRecipe(0)
    const child = cloneRecipe(1)
    parent.subrecipes = [{
      dependencyId: 'dependency-exact-child', recipeId: child.identity.recipeId, revisionId: null,
      sourceUrl: child.source.canonicalUrl, label: child.identity.title, quantity: null, required: true, resolution: 'linked-version',
    }]
    refreshReadiness(parent)
    expect(recipeV3Schema.safeParse(parent).success).toBe(false)

    parent.subrecipes[0].revisionId = child.identity.revisionId
    expect(recipeV3Schema.safeParse(parent).success).toBe(true)
    expect(validateRecipeV3Catalog({ ingredients: canonicalIngredients, recipes: [parent, child] }).success).toBe(true)

    parent.subrecipes[0].revisionId = 'revision-not-in-catalog'
    const mismatch = validateRecipeV3Catalog({ ingredients: canonicalIngredients, recipes: [parent, child] })
    expect(mismatch.success).toBe(false)
    if (!mismatch.success) expect(mismatch.issues.some(({ message }) => message.includes('Unknown subrecipe revision'))).toBe(true)
  })

  it('derives recommendation and cooking readiness only after their evidence gates pass', () => {
    const recipe = cloneRecipe()
    const evidenceId = recipe.source.evidence[0].evidenceId
    recipe.output.scaling = { policy: 'fixed-batch', allowedMultipliers: [1], note: 'Original batch only.' }
    recipe.output.planningGuidance.sourceServingsPerMealPortion = { value: 1, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
    recipe.effort.activeMinutes = { value: 20, evidenceIds: [evidenceId], confidence: 'reviewed', unknownReason: null }
    recipe.suitability.reviewState = 'editor-reviewed'
    recipe.source.rights.factualMetadataUse = 'approved'
    refreshReadiness(recipe)
    expect(recipe.review.readiness.recommendationReady).toBe(true)
    expect(recipe.review.readiness.cookingModeReady).toBe(false)

    recipe.subrecipes = [{
      dependencyId: 'dependency-test-seasoning', recipeId: null, revisionId: null, sourceUrl: null, label: 'Required seasoning',
      quantity: null, required: true, resolution: 'unresolved',
    }]
    refreshReadiness(recipe)
    expect(recipe.review.readiness.recommendationReady).toBe(false)
    expect(recipe.review.readiness.blockers).toContain('essential-subrecipe-unresolved')
    recipe.subrecipes[0].required = false
    refreshReadiness(recipe)
    expect(recipe.review.readiness.recommendationReady).toBe(true)

    recipe.steps = [{
      stepId: 'step-first', stage: 'cook', order: 1, instruction: 'An independently written reviewed instruction.',
      ingredientUses: [{ requirementId: recipe.requirements[0].requirementId, use: 'all', quantity: null }],
      equipmentIds: [], duration: { kind: 'active', minutes: 5 }, timer: null,
      canPrepareAhead: null, blockingStepIds: [], techniqueTipIds: [], evidenceIds: [evidenceId],
    }]
    recipe.review.structuredStepsReviewed = true
    recipe.review.safetyReviewed = true
    recipe.equipmentReviewState = 'editor-reviewed'
    refreshReadiness(recipe)
    expect(recipe.review.readiness.cookingModeReady).toBe(true)
    expect(recipeV3Schema.safeParse(recipe).success).toBe(true)
  })
})
