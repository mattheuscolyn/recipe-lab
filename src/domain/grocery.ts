import type { CanonicalIngredient, PackageOffer, RecipeV2, UnitCode } from './catalog'
import type { PantryLot } from './personalData'
import { convertQuantity } from './units'

export type RecipeSelection = { recipeId: string; servings: number; selectionId?: string; label?: string }
export type Contribution = { recipeId: string; selectionId: string; recipeTitle: string; label: string; requirementId: string; amount: number | null; unit: UnitCode | null; originalText: string; approximate: boolean; optional: boolean; confidence: 'reviewed' | 'needs-review'; note: string | null }
export type PantryCoverage = { available: { amount: number; unit: UnitCode }; applied: { amount: number; unit: UnitCode }; toBuy: { amount: number; unit: UnitCode } | null; knownToBuy: { amount: number; unit: UnitCode }; matchedLotIds: string[]; reviewLotIds: string[] }
export type GroceryLine = { canonicalIngredientId: string; variantId: string; name: string; variant: string; total: { amount: number; unit: UnitCode } | null; knownSubtotal: { amount: number; unit: UnitCode }; contributions: Contribution[]; optional: boolean; unresolved: boolean; pricing: PriceCalculation | null; pantry: PantryCoverage }
export type PriceCalculation = { offerId: string; estimatedCheckoutCost: number; estimatedConsumptionCost: number; packages: number; packagePurchased: { amount: number; unit: UnitCode }; usablePurchased: { amount: number; unit: UnitCode }; unused: { amount: number; unit: UnitCode } }

export function calculatePackagePurchase(required: { amount: number; unit: UnitCode }, ingredient: CanonicalIngredient, offer: PackageOffer): PriceCalculation {
  const effective = offer.usableYield ?? offer.packageQuantity
  const usable = convertQuantity(effective, required.unit, ingredient)
  if (usable.amount <= 0) throw new Error('Package usable quantity must be positive')
  const packages = Math.ceil(required.amount / usable.amount)
  return { offerId: offer.id, packages, estimatedCheckoutCost: packages * offer.totalPrice, estimatedConsumptionCost: required.amount / usable.amount * offer.totalPrice, packagePurchased: { amount: packages * offer.packageQuantity.amount, unit: offer.packageQuantity.unit }, usablePurchased: { amount: packages * usable.amount, unit: required.unit }, unused: { amount: packages * usable.amount - required.amount, unit: required.unit } }
}

export function buildGroceryList(recipes: RecipeV2[], ingredients: CanonicalIngredient[], offers: PackageOffer[], selections: RecipeSelection[], options: { includeOptional?: boolean; pantryLots?: PantryLot[] } = {}): GroceryLine[] {
  const recipeMap = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const grouped = new Map<string, GroceryLine>()
  selections.forEach((selection) => {
    const recipe = recipeMap.get(selection.recipeId)
    if (!recipe) throw new Error(`Unknown recipe ${selection.recipeId}`)
    if (selection.servings <= 0) throw new Error('Requested servings must be positive')
    const multiplier = selection.servings / recipe.yield.planningServings.default
    const selectionId = selection.selectionId ?? selection.recipeId
    const label = selection.label ?? recipe.title
    recipe.requirements.forEach((requirement) => {
      if (requirement.optional && !options.includeOptional) return
      const ingredient = ingredientMap.get(requirement.canonicalIngredientId)
      if (!ingredient) throw new Error(`Unknown ingredient ${requirement.canonicalIngredientId}`)
      const key = `${ingredient.id}:${requirement.variantId}`
      const variant = ingredient.variants.find(({ id }) => id === requirement.variantId)
      if (!variant) throw new Error(`Unknown variant ${requirement.variantId}`)
      const line = grouped.get(key) ?? { canonicalIngredientId: ingredient.id, variantId: variant.id, name: ingredient.displayName, variant: variant.label, total: { amount: 0, unit: ingredient.baseUnit }, knownSubtotal: { amount: 0, unit: ingredient.baseUnit }, contributions: [], optional: requirement.optional, unresolved: false, pricing: null, pantry: { available: { amount: 0, unit: ingredient.baseUnit }, applied: { amount: 0, unit: ingredient.baseUnit }, toBuy: { amount: 0, unit: ingredient.baseUnit }, knownToBuy: { amount: 0, unit: ingredient.baseUnit }, matchedLotIds: [], reviewLotIds: [] } }
      line.optional = line.optional && requirement.optional
      if (requirement.quantity) {
        const scaled = { ...requirement.quantity, amount: requirement.quantity.amount * multiplier }
        try {
          const normalized = convertQuantity(scaled, ingredient.baseUnit, ingredient)
          line.knownSubtotal = { amount: line.knownSubtotal.amount + normalized.amount, unit: ingredient.baseUnit }
          line.total = line.unresolved ? null : { ...line.knownSubtotal }
          line.contributions.push({ recipeId: recipe.id, selectionId, recipeTitle: recipe.title, label, requirementId: requirement.id, amount: normalized.amount, unit: ingredient.baseUnit, originalText: requirement.originalText, approximate: requirement.quantity.approximate, optional: requirement.optional, confidence: requirement.confidence, note: requirement.reviewNote })
        } catch (error) {
          line.unresolved = true; line.total = null
          line.contributions.push({ recipeId: recipe.id, selectionId, recipeTitle: recipe.title, label, requirementId: requirement.id, amount: null, unit: null, originalText: requirement.originalText, approximate: requirement.quantity.approximate, optional: requirement.optional, confidence: requirement.confidence, note: error instanceof Error ? error.message : 'Incompatible unit' })
        }
      } else {
        line.unresolved = true; line.total = null
        line.contributions.push({ recipeId: recipe.id, selectionId, recipeTitle: recipe.title, label, requirementId: requirement.id, amount: null, unit: null, originalText: requirement.originalText, approximate: true, optional: requirement.optional, confidence: requirement.confidence, note: requirement.reviewNote ?? requirement.nonQuantified })
      }
      grouped.set(key, line)
    })
  })
  return [...grouped.values()].map((line) => {
    const ingredient = ingredientMap.get(line.canonicalIngredientId)!
    const pantry = (options.pantryLots ?? []).reduce<PantryCoverage>((coverage, lot) => {
      if (lot.canonicalIngredientId !== line.canonicalIngredientId) return coverage
      if (lot.variantId !== line.variantId) return { ...coverage, reviewLotIds: [...coverage.reviewLotIds, lot.id] }
      try {
        const converted = convertQuantity({ amount: lot.quantity, unit: lot.unit }, ingredient.baseUnit, ingredient)
        return { ...coverage, available: { amount: coverage.available.amount + converted.amount, unit: ingredient.baseUnit }, matchedLotIds: [...coverage.matchedLotIds, lot.id] }
      } catch {
        return { ...coverage, reviewLotIds: [...coverage.reviewLotIds, lot.id] }
      }
    }, { available: { amount: 0, unit: ingredient.baseUnit }, applied: { amount: 0, unit: ingredient.baseUnit }, toBuy: line.total ? { amount: line.total.amount, unit: ingredient.baseUnit } : null, knownToBuy: { amount: line.knownSubtotal.amount, unit: ingredient.baseUnit }, matchedLotIds: [], reviewLotIds: [] })
    const demand = line.total?.amount ?? line.knownSubtotal.amount
    pantry.applied.amount = Math.min(demand, pantry.available.amount)
    pantry.knownToBuy.amount = Math.max(0, line.knownSubtotal.amount - pantry.applied.amount)
    pantry.toBuy = line.total && !line.unresolved ? { amount: Math.max(0, line.total.amount - pantry.applied.amount), unit: ingredient.baseUnit } : null
    const coveredLine = { ...line, pantry }
    if (!pantry.toBuy || pantry.toBuy.amount <= 0 || line.unresolved) return coveredLine
    const offer = offers.find((candidate) => candidate.canonicalIngredientId === line.canonicalIngredientId && candidate.variantId === line.variantId)
    if (!offer) return coveredLine
    try { return { ...coveredLine, pricing: calculatePackagePurchase(pantry.toBuy, ingredient, offer) } } catch { return coveredLine }
  }).sort((a, b) => a.name.localeCompare(b.name))
}
