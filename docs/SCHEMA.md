# Recipe schema v1

`src/domain/recipe.ts` is the executable contract. Each record contains:

- Identity: `schemaVersion`, UUID `id`, stable kebab-case `slug`.
- Display: `title`, `description`, `emoji`, and controlled `category`.
- Cooking model: positive yield, prep/cook/total minutes, ingredients, ordered steps, and tags.
- Provenance: source name and optional HTTPS URL.
- Governance: `draft`, `source-reviewed`, or `kitchen-tested` review state plus a required timestamp for reviewed states.

## Invariants

- Total time is at least prep plus cook time.
- Ingredient IDs are unique within a recipe.
- Step positions are contiguous and start at 1.
- Tags are unique within a recipe.
- IDs and slugs are unique across the collection.
- Validation errors include a stable path suitable for an editor or import report.

## Validation pipeline

Unknown input passes through `validateRecipe` for field and cross-field rules, then `validateRecipeCollection` for collection rules. `assertRecipeCollection` fails fast when application data is imported, so invalid source data cannot silently render. TypeScript types are inferred from the same Zod contract.

## Evolution

Additive optional fields may remain in v1 after documentation and tests. Breaking changes require `schemaVersion: 2`, a migration function from v1, retained fixtures for both versions, and a documented rollback plan. Never rewrite existing reviewed records without preserving provenance.
