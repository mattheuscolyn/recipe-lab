# Interactive Generate Week preview

Recipe Lab now exposes the G3 generator inside the existing opt-in v3 planner preview. The original v2 planner remains authoritative and the generated draft is ephemeral: generating, locking, skipping, resizing, or trying another recipe does not write personal data.

## Modes

- **Interactive demo** uses the repository's clearly labeled synthetic, fully reviewed fixtures. It supports arbitrary selected weeks and exercises the same candidate enumeration, feasibility, bounded search, batch allocation, and grocery code as real mode. Synthetic recipes cannot enter the production approval manifest or be accepted as ordinary recipes.
- **Real catalog** applies the production approval manifest and includes only exact recipe revisions that are genuinely recommendation-ready. The production manifest remains empty, so the current result is intentionally incomplete with actionable slot blockers.

## Current interaction

The preview supports week selection, meal inclusion, default portions, Sunday prep, dinner hands-on limits, office-lunch rules, recipe preferences and avoidances, per-slot portions, skips, locks, and "Try another." Regeneration rebuilds all affected batches, leftovers, and grocery demand; it never presents a local meal edit as isolated when the edit changes shared food.

The result displays meal coverage, dinner variety, hands-on effort, fresh/prepared/leftover service, cooking batches, consolidated grocery quantities, pantry estimates, search limits, and unfilled-slot reasons.

## Grocery correctness

Every selected cooking route carries its reviewed ingredient-branch selections into its batch grocery demand. An explicit alternative replaces the primary ingredient, an excluded optional ingredient contributes nothing, and an unresolved alternative is never silently treated as the primary branch. Pantry quantities are offset once against the consolidated demand and are not consumed.

`meal plan complete` and `shopping list ready` are separate states. Unknown quantities and conversion issues keep shopping in `review-needed`; prices are explicitly unavailable in this v3 preview. Leftover allocations create no duplicate grocery demand because groceries are derived once per cooking batch.

## Safety and persistence boundary

The preview retains G1 recipe-readiness, exact-revision, food-storage, office-service, cooking-window, and prepared-inventory gates. It does not infer unsupported thawing or reheating tasks. It does not persist a generated plan, consume pantry inventory, create prepared-food lots, or replace existing v2 data. Those operations require a separate, explicit acceptance workflow with backup and stale-snapshot protection.

## Private My Recipes

Real-catalog mode includes a small browser-local personal-recipe form. A user supplies a title, role, output portions, active/elapsed effort, and normalized ingredient quantities, then explicitly confirms authorship or permission and reviews the facts for fresh meal planning. Saving creates an immutable v3 revision in `recipe-lab.personal-recipes.v1`; repository modules contain only the workflow, never the user's recipe contents.

Household-entered evidence is labeled `user-entered` and explicitly not independently verified. A valid personal recipe may become recommendation-ready for fresh breakfasts or dinners, but it has unknown storage, leftover, thawing, and reheating suitability. Those routes stay blocked. Lunches still follow the no-lunchtime-cooking and office-service rules, so a fresh-only personal lunch does not bypass them.

Editing existing personal recipes, structured storage review, and recovery/export UI remain future product slices. Generated-plan acceptance also remains separate: the preview does not write meal requirements, cooking batches, allocations, prepared lots, or pantry consumption.
