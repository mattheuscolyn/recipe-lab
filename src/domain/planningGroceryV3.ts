import { z } from 'zod'
import { unitCodeSchema, type CanonicalIngredient, type UnitCode } from './catalog'
import type { RecipeV3 } from './recipeV3'
import type { Batch } from './planningV3'
import { convertQuantity } from './units'

const availabilityId = z.string().regex(/^availability-[a-z0-9-]+$/)
export const pantryAvailabilitySchema = z.object({
  availabilityId,
  canonicalIngredientId: z.string().regex(/^ingredient-[a-z0-9-]+$/),
  variantId: z.string().regex(/^variant-[a-z0-9-]+$/),
  confidence: z.enum(['confirmed-measured', 'confirmed-unquantified', 'likely-owned', 'unknown', 'missing']),
  quantity: z.object({ amount: z.number().nonnegative().finite(), unit: unitCodeSchema }).nullable(),
}).superRefine((availability, context) => {
  if (availability.confidence === 'confirmed-measured' && !availability.quantity) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Confirmed measured availability needs a quantity' })
  if (availability.confidence !== 'confirmed-measured' && availability.quantity) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Only confirmed measured availability may reduce demand' })
})

export type PantryAvailability = z.infer<typeof pantryAvailabilitySchema>

export type BatchIngredientSelection = {
  batchId: string
  requirementId: string
  selection: 'primary' | 'alternative' | 'excluded-optional'
  alternativeId: string | null
}

export type BatchGroceryContribution = {
  batchId: string
  recipeId: string
  recipeRevisionId: string
  requirementId: string
  originalText: string
  amount: number | null
  unit: UnitCode
  approximate: boolean
  optional: boolean
  confidence: RecipeV3['requirements'][number]['confidence']
  note: string | null
}

export type BatchGroceryLine = {
  canonicalIngredientId: string
  variantId: string
  name: string
  variant: string
  total: number | null
  knownSubtotal: number
  unit: UnitCode
  contributions: BatchGroceryContribution[]
  optional: boolean
  unresolved: boolean
  uncertainties: string[]
  pantry: {
    applied: number
    toBuy: number | null
    knownToBuy: number
    matchedAvailabilityIds: string[]
    checkAvailabilityIds: string[]
  }
}

export type BatchGroceryDemand = {
  scope: 'historical' | 'outstanding'
  lines: BatchGroceryLine[]
  uncertainties: string[]
}

function revisionKey(recipeId: string, revisionId: string): string {
  return `${recipeId}:${revisionId}`
}

export function buildBatchGroceryDemand(input: {
  recipes: RecipeV3[]
  ingredients: CanonicalIngredient[]
  batches: Batch[]
  scope: 'historical' | 'outstanding'
  pantry?: PantryAvailability[]
  includeOptional?: boolean
  ingredientSelections?: BatchIngredientSelection[]
}): BatchGroceryDemand {
  if (!['historical', 'outstanding'].includes(input.scope)) throw new Error('Grocery demand scope must be historical or outstanding')
  const recipes = new Map(input.recipes.map((recipe) => [revisionKey(recipe.identity.recipeId, recipe.identity.revisionId), recipe]))
  const ingredients = new Map(input.ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const pantry = (input.pantry ?? []).map((availability) => pantryAvailabilitySchema.parse(availability))
  if (new Set(pantry.map(({ availabilityId }) => availabilityId)).size !== pantry.length) throw new Error('Pantry availability may offset demand only once')
  const activeBatches = input.batches.filter((batch) => input.scope === 'historical' ? batch.state !== 'cancelled' : batch.state === 'planned')
  if (new Set(activeBatches.map(({ batchId }) => batchId)).size !== activeBatches.length) throw new Error('A batch may contribute grocery demand only once')
  const batchIds = new Set(activeBatches.map(({ batchId }) => batchId))
  const selections = new Map<string, BatchIngredientSelection>()
  for (const selection of input.ingredientSelections ?? []) {
    if (!batchIds.has(selection.batchId)) throw new Error(`Ingredient selection references inactive or unknown batch ${selection.batchId}`)
    const key = `${selection.batchId}:${selection.requirementId}`
    if (selections.has(key)) throw new Error(`Ingredient requirement ${selection.requirementId} is selected more than once for ${selection.batchId}`)
    if ((selection.selection === 'alternative') !== (selection.alternativeId !== null)) throw new Error('Only an alternative selection names an alternative id')
    selections.set(key, selection)
  }

  const grouped = new Map<string, { ingredient: CanonicalIngredient; variantId: string; contributions: BatchGroceryContribution[]; uncertainties: string[] }>()
  const globalUncertainties: string[] = []
  for (const batch of activeBatches) {
    const recipe = recipes.get(revisionKey(batch.recipeId, batch.recipeRevisionId))
    if (!recipe) throw new Error(`Missing exact recipe revision for batch ${batch.batchId}`)
    for (const requirement of recipe.requirements) {
      const selection = selections.get(`${batch.batchId}:${requirement.requirementId}`)
      if (selection?.selection === 'excluded-optional') {
        if (!requirement.optional) throw new Error(`Required ingredient ${requirement.requirementId} cannot be excluded`)
        continue
      }
      if (requirement.optional && !selection && !input.includeOptional) continue
      if (!selection && requirement.alternatives.length) throw new Error(`Ingredient branch ${requirement.requirementId} needs an explicit batch selection`)
      const alternative = selection?.selection === 'alternative'
        ? requirement.alternatives.find(({ alternativeId }) => alternativeId === selection.alternativeId)
        : null
      if (selection?.selection === 'alternative' && !alternative) throw new Error(`Unknown alternative ${selection.alternativeId} for ${requirement.requirementId}`)
      const canonicalIngredientId = alternative?.canonicalIngredientId ?? requirement.canonicalIngredientId
      const variantId = alternative?.variantId ?? requirement.variantId
      const ingredient = ingredients.get(canonicalIngredientId)
      if (!ingredient) throw new Error(`Unknown ingredient ${canonicalIngredientId}`)
      const variant = ingredient.variants.find(({ id }) => id === variantId)
      if (!variant) throw new Error(`Unknown variant ${requirement.variantId} for ${ingredient.id}`)
      const key = `${ingredient.id}:${variant.id}`
      const entry = grouped.get(key) ?? { ingredient, variantId: variant.id, contributions: [], uncertainties: [] }
      let amount: number | null = null
      let note: string | null = null
      const quantity = alternative ? alternative.quantity : requirement.selectedPlanningQuantity
      if (!quantity || quantity.amount === null) {
        note = quantity?.range ? 'A reviewed planning quantity is still required for this source range.' : `Non-quantified requirement: ${requirement.nonQuantified ?? 'unknown amount'}.`
      } else {
        const multiplier = requirement.scaling === 'fixed' ? 1 : batch.multiplier
        if (requirement.scaling === 'review-required' && batch.multiplier !== 1) note = 'Scaling this requirement needs review.'
        else if (requirement.scaling === 'whole-item' && !Number.isInteger(quantity.amount * multiplier)) note = 'Scaling would create a fractional whole item.'
        else {
          try { amount = convertQuantity({ amount: quantity.amount * multiplier, unit: quantity.unit, approximate: quantity.approximate }, ingredient.baseUnit, ingredient).amount }
          catch (error) { note = error instanceof Error ? error.message : 'Unit conversion needs review.' }
        }
      }
      if (note) entry.uncertainties.push(`${batch.batchId}/${requirement.requirementId}: ${note}`)
      entry.contributions.push({
        batchId: batch.batchId,
        recipeId: batch.recipeId,
        recipeRevisionId: batch.recipeRevisionId,
        requirementId: requirement.requirementId,
        originalText: alternative ? `${requirement.originalText} → ${alternative.label}` : requirement.originalText,
        amount,
        unit: ingredient.baseUnit,
        approximate: quantity?.approximate ?? false,
        optional: requirement.optional || alternative?.relationship === 'optional-addition',
        confidence: requirement.confidence,
        note,
      })
      grouped.set(key, entry)
    }
  }

  const lines = [...grouped.values()].map(({ ingredient, variantId, contributions, uncertainties }): BatchGroceryLine => {
    const knownSubtotal = contributions.reduce((sum, contribution) => sum + (contribution.amount ?? 0), 0)
    const unresolved = contributions.some(({ amount }) => amount === null)
    const exactPantry = pantry.filter((availability) => availability.canonicalIngredientId === ingredient.id && availability.variantId === variantId)
    const wrongVariantPantry = pantry.filter((availability) => availability.canonicalIngredientId === ingredient.id && availability.variantId !== variantId)
    const measured = exactPantry.filter((availability) => availability.confidence === 'confirmed-measured')
    const check = [...exactPantry.filter((availability) => availability.confidence !== 'confirmed-measured'), ...wrongVariantPantry]
    let pantryApplied = 0
    const pantryUncertainties = wrongVariantPantry.map(({ availabilityId, variantId: pantryVariantId }) => `${availabilityId}: pantry variant ${pantryVariantId} does not match required variant ${variantId}.`)
    for (const availability of measured) {
      try { pantryApplied += convertQuantity(availability.quantity!, ingredient.baseUnit, ingredient).amount }
      catch (error) {
        check.push(availability)
        pantryUncertainties.push(`${availability.availabilityId}: ${error instanceof Error ? error.message : 'Pantry unit is incompatible.'}`)
      }
    }
    pantryApplied = Math.min(pantryApplied, knownSubtotal)
    const knownToBuy = Math.max(0, knownSubtotal - pantryApplied)
    const allUncertainties = [...uncertainties, ...pantryUncertainties]
    globalUncertainties.push(...allUncertainties)
    return {
      canonicalIngredientId: ingredient.id,
      variantId,
      name: ingredient.displayName,
      variant: ingredient.variants.find(({ id }) => id === variantId)!.label,
      total: unresolved ? null : knownSubtotal,
      knownSubtotal,
      unit: ingredient.baseUnit,
      contributions,
      optional: contributions.every(({ optional }) => optional),
      unresolved,
      uncertainties: allUncertainties,
      pantry: {
        applied: pantryApplied,
        toBuy: unresolved ? null : knownToBuy,
        knownToBuy,
        matchedAvailabilityIds: measured.filter((availability) => !check.includes(availability)).map(({ availabilityId }) => availabilityId),
        checkAvailabilityIds: [...new Set(check.map(({ availabilityId }) => availabilityId))],
      },
    }
  }).sort((left, right) => left.name.localeCompare(right.name) || left.variant.localeCompare(right.variant))

  return { scope: input.scope, lines, uncertainties: globalUncertainties }
}
