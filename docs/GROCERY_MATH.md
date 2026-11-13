# Grocery calculation and ingestion

## Calculation flow

1. Scale each requirement by requested servings divided by source servings.
2. Group only identical canonical ingredient **and variant** IDs.
3. Convert within a shared dimension to the ingredient base unit.
4. Keep non-quantified, incompatible, optional, and alternative inputs explicit.
5. Select a compatible price fixture when present, round packages up, and report checkout, prorated consumption, and unused quantity separately.

Deterministic conversion: `1 cup + 2 tbsp = 1.125 cups`. The engine refuses `oz_mass → fl_oz`, fresh thyme → dried thyme, table salt → sea salt, and garlic heads → cloves without an ingredient-specific yield.

The UI demonstrates up to three recipes, adjustable servings, source contributions, unresolved lines, and estimate-only package math. It is not an optimizer and does not model pantry inventory beyond omission of optional ingredients.

## Ad hoc ingestion

`stageRecipeJsonLd` accepts manually supplied or permitted Recipe JSON-LD plus reviewer-provided publisher/check date. It preserves each raw ingredient line, suggests canonical matches from names and aliases, and labels unmatched or ambiguous lines. `assertStagingResolved` fails loudly until a human resolves every line. There is no scheduled scraper or refresh job.

Ingestion deliberately does not parse quantities into a final recipe automatically. Quantity/unit interpretation, alternatives, source rights, completeness, and method summary remain human review steps.
