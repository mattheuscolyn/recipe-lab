import { recipeApprovalManifestSchema, type RecipeApprovalManifest } from '../domain/recipeApprovalV3'

/**
 * Production approvals are intentionally empty until named, authorized human
 * reviewers supply version-specific records. Synthetic fixtures live in tests
 * and are never imported here.
 */
export const recipeApprovalManifestV3: RecipeApprovalManifest = recipeApprovalManifestSchema.parse({
  schemaVersion: 1,
  bundles: [],
})
