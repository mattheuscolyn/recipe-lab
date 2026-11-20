import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { canonicalIngredients, pilotRecipes } = await server.ssrLoadModule('/src/data/pilotCatalog.ts')
  const { reviewedRecipeCatalogV3, realRecipeReviewArtifacts } = await server.ssrLoadModule('/src/data/reviewedRecipeCatalogV3.ts')
  const { adaptRecipeCatalogV2ToV3 } = await server.ssrLoadModule('/src/domain/recipeV3Migration.ts')
  const { buildRecipeReviewReadinessReport } = await server.ssrLoadModule('/src/domain/recipeReviewReportV3.ts')
  const { recipes: baseRecipes } = adaptRecipeCatalogV2ToV3(pilotRecipes, canonicalIngredients)
  const report = buildRecipeReviewReadinessReport(baseRecipes, reviewedRecipeCatalogV3, realRecipeReviewArtifacts)
  await mkdir('docs/data', { recursive: true })
  await writeFile('docs/data/G2A_RECIPE_READINESS.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote G2A readiness for ${report.reviewedRecipeCount}/${report.recipeCount} recipes; ${report.recommendationReadyAfter} recommendation-ready.`)
} finally {
  await server.close()
}
