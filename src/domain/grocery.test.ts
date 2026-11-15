import { describe, expect, it } from 'vitest'
import { canonicalIngredients, packageOffers, pilotRecipes } from '../data/pilotCatalog'
import { buildGroceryList, calculatePackagePurchase } from './grocery'
import type { PantryLot } from './personalData'

const recipe = (slug: string) => pilotRecipes.find((item) => item.slug === slug)!
const selection = (slug: string, servings?: number) => { const item = recipe(slug); return { recipeId: item.id, servings: servings ?? item.yield.planningServings.default } }

describe('grocery calculation', () => {
  it('subtracts only safely matched pantry quantity and reprices the unmet garlic requirement', () => {
    const pantry: PantryLot[] = [{ id: 'garlic-lot', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 4, unit: 'clove', bestBy: null, note: '' }]
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('smoky-black-bean-soup', 8), selection('white-bean-soup')], { pantryLots: pantry })
    const garlic = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.total).toEqual({ amount: 7, unit: 'clove' })
    expect(garlic.pantry).toMatchObject({ available: { amount: 4, unit: 'clove' }, applied: { amount: 4, unit: 'clove' }, toBuy: { amount: 3, unit: 'clove' }, matchedLotIds: ['garlic-lot'] })
    expect(garlic.pricing).toMatchObject({ packages: 1, estimatedCheckoutCost: .89, unused: { amount: 7, unit: 'clove' } })
    expect(garlic.pricing?.estimatedConsumptionCost).toBeCloseTo(.267)
  })

  it('counts each compatible pantry lot once and caps coverage at demand', () => {
    const pantry: PantryLot[] = [
      { id: 'lot-a', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 3, unit: 'clove', bestBy: null, note: '' },
      { id: 'lot-b', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 5, unit: 'clove', bestBy: null, note: '' },
    ]
    const garlic = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('smoky-black-bean-soup', 8), selection('white-bean-soup')], { pantryLots: pantry }).find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.pantry.available.amount).toBe(8)
    expect(garlic.pantry.applied.amount).toBe(7)
    expect(garlic.pantry.toBuy?.amount).toBe(0)
    expect(new Set(garlic.pantry.matchedLotIds)).toEqual(new Set(['lot-a', 'lot-b']))
    expect(garlic.pricing).toBeNull()
  })

  it('never subtracts an incompatible pantry variant or unit', () => {
    const pantry: PantryLot[] = [
      { id: 'dried-thyme', canonicalIngredientId: 'ingredient-thyme', variantId: 'variant-thyme-dried', quantity: 2, unit: 'tsp', bestBy: null, note: '' },
      { id: 'garlic-by-weight', canonicalIngredientId: 'ingredient-garlic', variantId: 'variant-garlic-fresh-clove', quantity: 50, unit: 'g', bestBy: null, note: '' },
    ]
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('white-bean-soup')], { pantryLots: pantry })
    const freshThyme = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-thyme')!
    const garlic = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(freshThyme.pantry).toMatchObject({ applied: { amount: 0 }, reviewLotIds: ['dried-thyme'] })
    expect(garlic.pantry).toMatchObject({ applied: { amount: 0 }, reviewLotIds: ['garlic-by-weight'] })
    expect(garlic.pantry.toBuy).toEqual({ amount: 3, unit: 'clove' })
  })

  it('keeps an unquantified requirement unresolved even when matching pantry inventory exists', () => {
    const pantry: PantryLot[] = [{ id: 'salt-lot', canonicalIngredientId: 'ingredient-salt', variantId: 'variant-salt-unspecified', quantity: 5, unit: 'tsp', bestBy: null, note: '' }]
    const salt = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('smoky-black-bean-soup')], { pantryLots: pantry }).find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-salt')!
    expect(salt).toMatchObject({ unresolved: true, total: null, pricing: null })
    expect(salt.pantry.toBuy).toBeNull()
    expect(salt.pantry.applied.amount).toBe(0)
    expect(salt.pantry.available.amount).toBe(5)
  })
  it('applies serving multipliers and consolidates canonical garlic', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('smoky-black-bean-soup', 8), selection('white-bean-soup')])
    const garlic = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.total).toEqual({ amount: 7, unit: 'clove' })
    expect(garlic.contributions).toHaveLength(2)
  })
  it('keeps fresh and dried herb variants separate', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('white-bean-soup'), selection('best-lentil-soup')])
    const thyme = list.filter(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-thyme')
    expect(thyme).toHaveLength(2)
    expect(thyme.map(({ variant }) => variant).sort()).toEqual(['Dried', 'Fresh leaves'])
  })
  it('scales countable pancake output from a distinct people assumption', () => {
    const pancakes = recipe('simply-perfect-pancakes')
    expect(pancakes.yield.source).toMatchObject({ kind: 'countable-output', amount: 12, unit: 'large pancakes' })
    expect(pancakes.yield.planningServings.default).toBe(4)
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('simply-perfect-pancakes', 2)])
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-flour')?.total?.amount).toBeCloseTo(90)
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-egg')?.total).toEqual({ amount: 1, unit: 'item' })
  })
  it('consolidates the chosen kale branch across recipes', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('white-bean-soup'), selection('best-lentil-soup')])
    const kale = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-kale')!
    expect(kale.total).toEqual({ amount: 3, unit: 'cup' })
    expect(kale.contributions).toHaveLength(2)
  })
  it('separates canned net purchase mass from assumed drained usable mass', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('chickpea-coriander-lime-soup')])
    const chickpeas = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-chickpeas')!
    expect(chickpeas.total).toEqual({ amount: 480, unit: 'g' })
    expect(chickpeas.pricing).toMatchObject({ packages: 2, estimatedCheckoutCost: 2.38, packagePurchased: { amount: 820, unit: 'g' }, usablePurchased: { amount: 480, unit: 'g' }, unused: { amount: 0, unit: 'g' } })
  })
  it('excludes optional items by default and can include them visibly', () => {
    const selected = [selection('smoky-black-bean-soup')]
    const defaultList = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selected)
    expect(defaultList.some(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-jalapeno')).toBe(false)
    const withOptional = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selected, { includeOptional: true })
    expect(withOptional.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-jalapeno')?.optional).toBe(true)
  })
  it('produces a stable three-recipe consolidated sample', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('creamy-pesto-chicken'), selection('greek-chicken-pasta-salad'), selection('easy-sesame-chicken')])
    const garlic = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-garlic')!
    expect(garlic.total).toEqual({ amount: 7, unit: 'clove' })
    expect(garlic.contributions).toHaveLength(3)
    expect(garlic.pricing).toMatchObject({ packages: 1, estimatedCheckoutCost: .89, packagePurchased: { amount: 1, unit: 'head' }, usablePurchased: { amount: 10, unit: 'clove' }, unused: { amount: 3, unit: 'clove' } })
    expect(garlic.pricing?.estimatedConsumptionCost).toBeCloseTo(.623)
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-olive-oil')?.total).toEqual({ amount: .375, unit: 'cup' })
  })
  it('rounds package checkout separately from consumption and remainder', () => {
    const garlic = canonicalIngredients.find(({ id }) => id === 'ingredient-garlic')!
    const offer = packageOffers.find(({ id }) => id === 'offer-garlic-head')!
    const price = calculatePackagePurchase({ amount: 12, unit: 'clove' }, garlic, offer)
    expect(price.packages).toBe(2)
    expect(price.estimatedCheckoutCost).toBeCloseTo(1.78)
    expect(price.estimatedConsumptionCost).toBeCloseTo(1.068)
    expect(price.unused).toEqual({ amount: 8, unit: 'clove' })
  })
  it('leaves missing prices unknown and preserves approximate inputs', () => {
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('best-lentil-soup')])
    expect(list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-black-pepper')?.pricing).toBeNull()
    const lemon = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-lemon-juice')!
    expect(lemon.contributions[0].approximate).toBe(true)
  })
  it('keeps mixed measured and nonquantified totals unresolved in both selection orders', () => {
    const measured = selection('best-lentil-soup')
    const toTaste = selection('smoky-black-bean-soup')
    for (const selections of [[measured, toTaste], [toTaste, measured]]) {
      const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, selections)
      const salt = list.find(({ canonicalIngredientId, variantId }) => canonicalIngredientId === 'ingredient-salt' && variantId === 'variant-salt-unspecified')!
      expect(salt.unresolved).toBe(true)
      expect(salt.total).toBeNull()
      expect(salt.knownSubtotal).toEqual({ amount: 1, unit: 'tsp' })
      expect(salt.contributions).toHaveLength(2)
      expect(salt.pricing).toBeNull()
    }
  })
  it('maps a compound salt-and-pepper source line to both grocery ingredients', () => {
    const sesameChicken = recipe('easy-sesame-chicken')
    const compound = sesameChicken.requirements.filter(({ sourceLineId }) => sourceLineId === 'source-line-sesame-chicken-seasoning')
    expect(compound).toHaveLength(2)
    expect(compound.map(({ canonicalIngredientId }) => canonicalIngredientId).sort()).toEqual(['ingredient-black-pepper', 'ingredient-salt'])
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('easy-sesame-chicken')])
    const salt = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-salt')!
    const pepper = list.find(({ canonicalIngredientId }) => canonicalIngredientId === 'ingredient-black-pepper')!
    expect(salt).toMatchObject({ unresolved: true, total: null })
    expect(pepper).toMatchObject({ unresolved: true, total: null })
    expect(salt.contributions[0].originalText).toBe('Pinch each salt and pepper')
    expect(pepper.contributions[0].originalText).toBe('Pinch each salt and pepper')
  })
  it('keeps diced red onion under the onion canonical identity without a size conversion', () => {
    expect(canonicalIngredients.some(({ id }) => id === 'ingredient-red-onion-diced')).toBe(false)
    const quesadillas = recipe('hearty-black-bean-quesadillas')
    const redOnion = quesadillas.requirements.find(({ variantId }) => variantId === 'variant-onion-red')!
    expect(redOnion).toMatchObject({ canonicalIngredientId: 'ingredient-onion', quantity: null, sourceQuantity: { amount: .5, unit: 'cup' } })
    const list = buildGroceryList(pilotRecipes, canonicalIngredients, packageOffers, [selection('hearty-black-bean-quesadillas')])
    expect(list.find(({ canonicalIngredientId, variantId }) => canonicalIngredientId === 'ingredient-onion' && variantId === 'variant-onion-red')).toMatchObject({ unresolved: true, total: null, name: 'Onion', variant: 'Red' })
  })
})
