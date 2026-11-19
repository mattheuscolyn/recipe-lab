import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { canonicalIngredients, pilotRecipes } = await server.ssrLoadModule('/src/data/pilotCatalog.ts')
  const { adaptRecipeCatalogV2ToV3 } = await server.ssrLoadModule('/src/domain/recipeV3Migration.ts')
  const { buildGeneratorReadinessReport } = await server.ssrLoadModule('/src/domain/generatorReadinessV3.ts')
  const { recipes } = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients)
  const report = buildGeneratorReadinessReport(recipes)
  await mkdir('docs/data', { recursive: true })
  await writeFile('docs/data/G1_RECIPE_READINESS.json', `${JSON.stringify(report, null, 2)}\n`)
} finally {
  await server.close()
}
