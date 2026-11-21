import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { recipeApprovalManifestV3 } = await server.ssrLoadModule('/src/data/recipeApprovalManifestV3.ts')
  const { realRecipeReviewArtifacts, reviewedRecipeCatalogV3, reviewedRecipeServiceAssessments } = await server.ssrLoadModule('/src/data/reviewedRecipeCatalogV3.ts')
  const { buildRealCatalogCoverageReport } = await server.ssrLoadModule('/src/domain/realCatalogCoverageV3.ts')
  const report = buildRealCatalogCoverageReport({
    baseRecipes: reviewedRecipeCatalogV3,
    reviewArtifacts: realRecipeReviewArtifacts,
    serviceAssessments: reviewedRecipeServiceAssessments,
    productionManifest: recipeApprovalManifestV3,
  })
  await mkdir('docs/data', { recursive: true })
  await writeFile('docs/data/G2B2A_REAL_CATALOG_COVERAGE.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote G2B2a coverage: ${report.catalog.recipesWithEligibleRoutes} recipes with eligible routes; ${report.scenarios.filter(({ complete }) => complete).length}/${report.scenarios.length} complete scenarios.`)
} finally {
  await server.close()
}
