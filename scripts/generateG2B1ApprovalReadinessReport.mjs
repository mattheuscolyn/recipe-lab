import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { recipeApprovalManifestV3 } = await server.ssrLoadModule('/src/data/recipeApprovalManifestV3.ts')
  const { realRecipeReviewArtifacts, reviewedRecipeCatalogV3 } = await server.ssrLoadModule('/src/data/reviewedRecipeCatalogV3.ts')
  const { buildRecipeApprovalReadinessReport } = await server.ssrLoadModule('/src/domain/recipeApprovalReadinessV3.ts')
  const report = buildRecipeApprovalReadinessReport(reviewedRecipeCatalogV3, realRecipeReviewArtifacts, recipeApprovalManifestV3)
  await mkdir('docs/data', { recursive: true })
  await writeFile('docs/data/G2B1_APPROVAL_READINESS.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote G2B1 readiness: ${report.recommendationReadyCount} ready, ${report.awaitingDecisionCount} awaiting decisions.`)
} finally {
  await server.close()
}
