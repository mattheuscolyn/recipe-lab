# Grocery calculation and ingestion

## Calculation flow

1. Scale each requirement by requested people divided by `yield.planningServings.default`; source output remains unchanged.
2. Group only identical canonical ingredient **and variant** IDs.
3. Convert within a shared dimension to the ingredient base unit.
4. Keep non-quantified, incompatible, optional, and alternative inputs explicit.
5. Select a compatible price fixture when present, round packages up, and report checkout, prorated consumption, and unused quantity separately.

If a grocery line combines measured and nonquantified contributions, its authoritative total remains unknown in every recipe-selection order. The UI may show a clearly labeled measured `knownSubtotal`, but never presents it as the complete total and never prices the unresolved line.

Deterministic conversion: `1 cup + 2 tbsp = 1.125 cups`. The engine refuses `oz_mass → fl_oz`, fresh thyme → dried thyme, table salt → sea salt, and garlic heads → cloves without an ingredient-specific yield.

The UI demonstrates up to three recipes, adjustable planning portions, source contributions, unresolved lines, and estimate-only package math. Optional ingredients are visibly excluded by default and can be included with a checkbox.

The headline is a **priced-items checkout subtotal**, never a whole-list estimate. Unpriced or unresolved item count is shown beside it. Package output separates nominal package quantity, assumed usable quantity, consumed cost, and usable remainder.

Example: the chickpea soup requires an assumed 480g drained chickpeas. Two hypothetical 410g-net cans at $1.19 each, each assumed to yield 240g drained, produce a $2.38 checkout subtotal, $2.38 consumed estimate, 820g nominal net purchase, 480g usable purchase, and 0g usable remainder.

## Ad hoc ingestion

`stageRecipeJsonLd` accepts manually supplied or permitted Recipe JSON-LD plus reviewer-provided publisher/check date. It preserves each raw ingredient line, suggests canonical matches from names and aliases, and labels unmatched or ambiguous lines. `assertStagingResolved` fails loudly until a human resolves every line. There is no scheduled scraper or refresh job.

Ingestion deliberately does not parse quantities into a final recipe automatically. Quantity/unit interpretation, alternatives, source rights, completeness, and method summary remain human review steps.
