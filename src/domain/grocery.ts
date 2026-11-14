import type { CanonicalIngredient, PackageOffer, RecipeV2, UnitCode } from './catalog'
import { convertQuantity } from './units'

export type RecipeSelection = { recipeId: string; servings: number }
export type Contribution = { recipeId: string; recipeTitle: string; requirementId: string; amount: number | null; unit: UnitCode | null; originalText: string; approximate: boolean; optional: boolean; confidence: 'reviewed' | 'needs-review'; note: string | null }
export type GroceryLine = { canonicalIngredientId: string; variantId: string; name: string; variant: string; total: { amount: number; unit: UnitCode } | null; knownSubtotal: { amount: number; unit: UnitCode }; contributions: Contribution[]; optional: boolean; unresolved: boolean; pricing: PriceCalculation | null }
export type PriceCalculation = { offerId: string; estimatedCheckoutCost: number; estimatedConsumptionCost: number; packages: number; packagePurchased: { amount: number; unit: UnitCode }; usablePurchased: { amount: number; unit: UnitCode }; unused: { amount: number; unit: UnitCode } }

export function calculatePackagePurchase(required: { amount: number; unit: UnitCode }, ingredient: CanonicalIngredient, offer: PackageOffer): PriceCalculation {
  const effective = offer.usableYield ?? offer.packageQuantity
  const usable = convertQuantity(effective, required.unit, ingredient)
  if (usable.amount <= 0) throw new Error('Package usable quantity must be positive')
  const packages = Math.ceil(required.amount / usable.amount)
  return { offerId: offer.id, packages, estimatedCheckoutCost: packages * offer.totalPrice, estimatedConsumptionCost: required.amount / usable.amount * offer.totalPrice, packagePurchased: { amount: packages * offer.packageQuantity.amount, unit: offer.packageQuantity.unit }, usablePurchased: { amount: packages * usable.amount, unit: required.unit }, unused: { amount: packages * usable.amount - required.amount, unit: required.unit } }
}

export function buildGroceryList(recipes: RecipeV2[], ingredients: CanonicalIngredient[], offers: PackageOffer[], selections: RecipeSelection[], options: { includeOptional?: boolean } = {}): GroceryLine[] {
  const recipeMap = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const grouped = new Map<string, GroceryLine>()
  selections.forEach((selection) => {
    const recipe = recipeMap.get(selection.recipeId)
    if (!recipe) throw new Error(`Unknown recipe ${selection.recipeId}`)
    if (selection.servings <= 0) throw new Error('Requested servings must be positive')
    const multiplier = selection.servings / recipe.yield.planningServings.default
    recipe.requirements.forEach((requirement) => {
      if (requirement.optional && !options.includeOptional) return
      const ingredient = ingredientMap.get(requirement.canonicalIngredientId)
      if (!ingredient) throw new Error(`Unknown ingredient ${requirement.canonicalIngredientId}`)
      const key = `${ingredient.id}:${requirement.variantId}`
      const variant = ingredient.variants.find(({ id }) => id === requirement.variantId)
      if (!variant) throw new Error(`Unknown variant ${requirement.variantId}`)
      const line = grouped.get(key) ?? { canonicalIngredientId: ingredient.id, variantId: variant.id, name: ingredient.displayName, variant: variant.label, total: { amount: 0, unit: ingredient.baseUnit }, knownSubtotal: { amount: 0, unit: ingredient.baseUnit }, contributions: [], optional: requirement.optional, unresolved: false, pricing: null }
      line.optional = line.optional && requirement.optional
      if (requirement.quantity) {
        const scaled = { ...requirement.quantity, amount: requirement.quantity.amount * multiplier }
        try {
          const normalized = convertQuantity(scaled, ingredient.baseUnit, ingredient)
          line.knownSubtotal = { amount: line.knownSubtotal.amount + normalized.amount, unit: ingredient.baseUnit }
          line.total = line.unresolved ? null : { ...line.knownSubtotal }
          line.contributions.push({ recipeId: recipe.id, recipeTitle: recipe.title, requirementId: requirement.id, amount: normalized.amount, unit: ingredient.baseUnit, originalText: requirement.originalText, approximate: requirement.quantity.approximate, optional: requirement.optional, confidence: requirement.confidence, note: requirement.reviewNote })
        } catch (error) {
          line.unresolved = true; line.total = null
          line.contributions.push({ recipeId: recipe.id, recipeTitle: recipe.title, requirementId: requirement.id, amount: null, unit: null, originalText: requirement.originalText, approximate: requirement.quantity.approximate, optional: requirement.optional, confidence: requirement.confidence, note: error instanceof Error ? error.message : 'Incompatible unit' })
        }
      } else {
        line.unresolved = true; line.total = null
        line.contributions.push({ recipeId: recipe.id, recipeTitle: recipe.title, requirementId: requirement.id, amount: null, unit: null, originalText: requirement.originalText, approximate: true, optional: requirement.optional, confidence: requirement.confidence, note: requirement.reviewNote ?? requirement.nonQuantified })
      }
      grouped.set(key, line)
    })
  })
  return [...grouped.values()].map((line) => {
    if (!line.total || line.unresolved) return line
    const ingredient = ingredientMap.get(line.canonicalIngredientId)!
    const offer = offers.find((candidate) => candidate.canonicalIngredientId === line.canonicalIngredientId && candidate.variantId === line.variantId)
    if (!offer) return line
    try { return { ...line, pricing: calculatePackagePurchase(line.total, ingredient, offer) } } catch { return line }
  }).sort((a, b) => a.name.localeCompare(b.name))
}
