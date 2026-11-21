import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { canonicalIngredients } = await server.ssrLoadModule('/src/data/pilotCatalog.ts')
  const { g3aCompleteWeekRequest } = await server.ssrLoadModule('/src/domain/g3aWeekFixtures.ts')
  const { generateWeekDraft } = await server.ssrLoadModule('/src/domain/weekGeneratorV3.ts')
  const draft = generateWeekDraft({
    request: g3aCompleteWeekRequest,
    ingredients: canonicalIngredients,
    options: { maxSearchNodes: 20_000, maxOptionsPerRequirement: 10, maxRoutes: 2_000, maxStoredMealsPerBatch: 3 },
  })
  await mkdir('docs/data', { recursive: true })
  await writeFile('docs/data/G3A_SYNTHETIC_WEEK_DRAFT.json', `${JSON.stringify(draft, null, 2)}\n`)
  console.log(`Wrote G3a ${draft.status} week: ${draft.meals.filter(({ status }) => status === 'planned').length} planned, ${draft.unmetRequirements.length} unmet, ${draft.batches.length} batches.`)
} finally {
  await server.close()
}
