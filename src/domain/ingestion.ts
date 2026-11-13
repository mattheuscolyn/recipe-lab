import type { CanonicalIngredient } from './catalog'

export type StagedIngredient = { originalText: string; candidateIds: string[]; status: 'matched' | 'ambiguous' | 'unmatched' }
export type StagedRecipe = { title: string; sourceUrl: string; publisher: string; checkedAt: string; ingredients: StagedIngredient[]; warnings: string[] }

const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

export function findCanonicalCandidates(originalText: string, ingredients: CanonicalIngredient[]): string[] {
  const source = ` ${normalize(originalText)} `
  return ingredients.filter((ingredient) => [ingredient.displayName, ...ingredient.aliases].some((name) => source.includes(` ${normalize(name)} `))).map(({ id }) => id)
}

export function stageRecipeJsonLd(input: unknown, context: { publisher: string; checkedAt: string }, ingredients: CanonicalIngredient[]): StagedRecipe {
  if (!input || typeof input !== 'object') throw new Error('Recipe JSON-LD must be an object')
  const value = input as Record<string, unknown>
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
  if (!types.includes('Recipe')) throw new Error('JSON-LD @type must include Recipe')
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('JSON-LD recipe name is required')
  if (typeof value.url !== 'string' || !URL.canParse(value.url)) throw new Error('JSON-LD recipe source URL is required')
  if (!Array.isArray(value.recipeIngredient) || value.recipeIngredient.some((line) => typeof line !== 'string')) throw new Error('JSON-LD recipeIngredient must be a string array')
  const staged = value.recipeIngredient.map((line) => {
    const originalText = line as string
    const candidateIds = findCanonicalCandidates(originalText, ingredients)
    return { originalText, candidateIds, status: candidateIds.length === 1 ? 'matched' as const : candidateIds.length > 1 ? 'ambiguous' as const : 'unmatched' as const }
  })
  const unresolved = staged.filter(({ status }) => status !== 'matched').length
  return { title: value.name, sourceUrl: value.url, publisher: context.publisher, checkedAt: context.checkedAt, ingredients: staged, warnings: unresolved ? [`${unresolved} ingredient line(s) require human review`] : [] }
}

export function assertStagingResolved(staged: StagedRecipe): StagedRecipe {
  const unresolved = staged.ingredients.filter(({ status }) => status !== 'matched')
  if (unresolved.length) throw new Error(`Ingestion review required:\n${unresolved.map((line) => `- ${line.status}: ${line.originalText}`).join('\n')}`)
  return staged
}
