# Recipe schema v2

Schema v2 separates facts that schema v1 conflated:

- `CanonicalIngredient`: stable identity, aliases, variants/forms, and a grocery base unit.
- `RecipeRequirement`: verbatim factual source line, parsed quantity or explicit non-quantified state, canonical and variant IDs, preparation, optionality, confidence, and reviewer note.
- `RecipeV2`: attribution, checked date, explicit unknown ratings, yield, independently written method summary, and distinct `source-reviewed`/`kitchen-tested` status.
- `PackageOffer`: variant-specific package quantity, optional ingredient-specific usable yield, explicitly estimated dated price, retailer/source, and currency.

The v1 schema and four synthetic fixtures remain in `src/domain/recipe.ts` and `src/data/recipes.ts`. They are excluded from the real pilot rather than silently reinterpreted. Their completeness defects are recorded in `src/data/legacyQuality.ts`.

## Unit policy

Mass normalizes to grams, volume to milliliters, and count-like units only convert when identical. Legal built-in conversions are mass↔mass and volume↔volume. Fluid ounces (`fl_oz`) are volume; ounces by weight (`oz_mass`) are mass. Cross-dimensional conversion is rejected unless a future ingredient-specific density model explicitly supplies it.

Count semantics are named (`clove`, `head`, `can`, `item`). A garlic head does not become cloves through the unit registry. The package fixture instead supplies an approximate usable yield of ten cloves per head. Fresh/dried herb and salt-type variants never merge automatically.

## Validation

`validateCatalog` validates each contract and then checks cross-record references, duplicate IDs/slugs, variant ownership, and dimensional compatibility. Unknown canonical IDs and invalid units fail application import through `assertCatalog`.

Breaking evolution requires `schemaVersion: 3`, migration fixtures, rollback documentation, and retention of original source facts.
