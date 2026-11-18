# Recipe schema v2

> **Active runtime contract:** this document describes the live v2 application schema. The v3 foundation is implemented but not used by the application; see the [implemented contract](./V3_IMPLEMENTATION.md), [migration results](./V3_MIGRATION_RESULTS.md), [approved architecture](./V3_ARCHITECTURE.md), [25-recipe readiness audit](./V3_RECIPE_AUDIT.md), and [acceptance scenarios](./V3_ACCEPTANCE_SCENARIOS.md).

Schema v2 separates facts that schema v1 conflated:

- `CanonicalIngredient`: stable identity, aliases, variants/forms, and a grocery base unit.
- `RecipeRequirement`: shared source-line identity, verbatim factual source line, parsed quantity or explicit non-quantified state, canonical and variant IDs, preparation, optionality, confidence, and reviewer note.
- `RecipeV2`: attribution, checked date, explicit unknown ratings, independently written method summary, and distinct `source-reviewed`/`kitchen-tested` status.
- `RecipeV2.yield.source`: the publisher output as a quantity or range and its semantic kind (`meal-servings` or `countable-output`).
- `RecipeV2.yield.planningServings`: the user-adjustable people default and its documented assumption; it never rewrites the source output.
- `RecipeRequirement`: selected planning quantity, preserved incompatible source measure, source range, structured alternatives, optional state, and source package/net/usable facts when applicable. Multiple requirements may share a source-line identity when one source line names multiple grocery ingredients.
- `PackageOffer`: variant-specific package quantity, optional ingredient-specific usable yield, documented cross-dimension conversion, explicitly hypothetical dated price, retailer/source, and currency.

The v1 schema and four synthetic fixtures remain in `src/domain/recipe.ts` and `src/data/recipes.ts`. They are excluded from the real pilot rather than silently reinterpreted. Their completeness defects are recorded in `src/data/legacyQuality.ts`.

## Unit policy

Mass normalizes to grams, volume to milliliters, and count-like units only convert when identical. Legal built-in conversions are mass↔mass and volume↔volume. Fluid ounces (`fl_oz`) are volume; ounces by weight (`oz_mass`) are mass. Cross-dimensional conversion is rejected unless a future ingredient-specific density model explicitly supplies it.

Count semantics are named (`clove`, `head`, `can`, `item`). A garlic head does not become cloves through the unit registry. The package fixture instead supplies an approximate usable yield of ten cloves per head. Fresh/dried herb and salt-type variants never merge automatically.

Package validation rejects an offer whose package quantity has the wrong dimension unless a compatible usable yield is present. If package and usable dimensions differ, `conversionNote` is mandatory. For canned chickpeas, the requirement independently stores two 410g net cans and an explicitly hypothetical 240g drained yield per can.

## Validation

`validateCatalog` validates each contract and then checks cross-record references, duplicate IDs/slugs, variant ownership, and dimensional compatibility. Unknown canonical IDs and invalid units fail application import through `assertCatalog`.

Breaking evolution requires `schemaVersion: 3`, migration fixtures, rollback documentation, and retention of original source facts.
