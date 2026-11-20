# Recipe data contract v3 implementation

## Status and boundary

Recipe Lab now contains an implemented, validated **recipe v3 foundation**. Deterministic cooking-batch, allocation, prepared-food, and batch-grocery domain math is documented separately in [V3_PLANNING_IMPLEMENTATION.md](./V3_PLANNING_IMPLEMENTATION.md). The opt-in personal-data compatibility preview and recovery model are documented in [V3_PERSONAL_DATA_PREVIEW.md](./V3_PERSONAL_DATA_PREVIEW.md). The live application still imports and uses the v2 catalog, and the established discovery, weekly plan, grocery, and pantry behavior remains v2-authoritative.

Implementation files:

- `src/domain/recipeV3.ts` — TypeScript types inferred from Zod, field validation, recipe-level referential checks, catalog validation, and derived readiness gates.
- `src/domain/recipeV3Migration.ts` — pure deterministic v2 compatibility adapter and reproducible migration report.
- `src/domain/recipeV3Migration.test.ts` — all-catalog migration and invalid-contract regression coverage.
- `docs/V3_MIGRATION_RESULTS.md` — the checked migration/readiness result for the existing 25-recipe snapshot.

The approved architecture remains the product source of truth. This document records implementation details and narrowly scoped clarifications needed to make its readiness rules enforceable.

## Implemented contract

`RecipeV3` validates these groups:

- stable recipe identity plus deterministic immutable revision identity;
- publisher attribution, checked date, selection rationale, conservative rights state, and evidence references;
- source yield, publisher serving definition, discrete whole-item output, scaling policy, and distinct planning guidance;
- recipe components, original source lines, structured source/planning quantities, nonquantified states, variants, alternatives, packages, and yield assumptions;
- required/optional subrecipe dependencies pinned to exact internal recipe revisions when linked;
- reported, computed, or explicitly unknown nutrition with a declared basis;
- reported or unknown prep/cook/passive/active/total time, effort, and attention metadata;
- equipment plus its review state;
- primary meal roles—including distinct dessert and snack roles—and tags;
- independently written structured steps linked to requirements, equipment, evidence, timing, and dependencies;
- storage/leftover suitability with explicit review and unknown states;
- source, ingredient, step, safety, kitchen-test, and feature-readiness review state;
- legacy independent method summaries, isolated from cooking-mode steps.

Unknown values are first-class. A `Sourced<T>` with `value: null` must use `confidence: "unknown"` and explain why the value is absent. A known value cannot claim unknown confidence and must reference evidence. Unknown nutrition cannot contain zero-valued stand-ins, a serving basis, or a computation method.

## Validation behavior

### Recipe-level checks

- Evidence, component, requirement, alternative, dependency, equipment, and step IDs are unique where scoped.
- Every evidence, component, requirement, equipment, and blocking-step reference resolves.
- Quantities contain exactly one amount or range and only supported v2 unit codes.
- Discrete output has a positive integer item count that matches source yield.
- Reviewed batch multipliers include the original batch (`1`) and cannot create fractional discrete items.
- A quantified requirement cannot also claim a nonquantified state.
- Needs-review requirements retain a review note.
- Known package usable yield retains an explicit sourced assumption.
- Nutrition state, basis, evidence, and computation method agree.
- Declared readiness must exactly match the derived completeness gates.

### Catalog-level checks

- Ingredient, recipe, revision, and slug identities are unique.
- Requirement and alternative canonical ingredient/variant references resolve to the retained v2 ingredient catalog.
- Selected planning quantities and alternative quantities match their ingredient base dimension.
- An incompatible original publisher measure remains legal as a source fact; it is not silently promoted into a planning conversion.
- Usable package quantities match the ingredient base dimension.
- A `linked-version` subrecipe contains both a recipe ID and immutable revision ID, and that exact pair resolves inside the supplied v3 catalog. Nonlinked dependencies cannot carry internal IDs that might drift silently.

`assertRecipeV3Catalog` throws an actionable path/message report; `validateRecipeV3Catalog` returns a result object for ingestion and tests.

## Compatibility adapter policy

`adaptRecipeV2ToDraftV3` is pure and deterministic. Running it twice on identical v2 input produces byte-identical JSON.

| V2 information | V3 treatment |
|---|---|
| Recipe UUID, slug and source | Retained exactly; revision is deterministically `revision-<recipe UUID>-v2`. |
| Source evidence | One dated manual-review evidence record points to the canonical publisher URL. |
| Migration interpretation | A separate rule-derived evidence record identifies compatibility choices and preserved assumptions. |
| Meal-serving yield | Retained as `flexible-batch`; amount/range/unit/label are unchanged. No serving size is invented. |
| Countable yield | Retained as `discrete-items`; whole item count and item label are unchanged. |
| Planning servings | Retained only as default meal portions and the existing assumption note; never treated as publisher serving size. |
| Flat requirements | Assigned to rule-derived `component-main`; stable requirement/source-line/ingredient/variant IDs remain unchanged. |
| Selected quantity | Retained as `selectedPlanningQuantity`, including approximation state. |
| Structured source quantity/range | Retained when v2 explicitly contains it. An exact non-approximate v2 quantity can serve as both source and planning evidence. |
| Approximate conversion lacking structured source quantity | The selected estimate is retained, while `sourceQuantity` stays null and the original publisher line remains verbatim. This avoids relabeling an estimate as a publisher measurement. |
| Alternatives, package facts and notes | Retained with deterministic alternative IDs and explicit evidence. |
| Method summary | Copied to `legacyMethodSummary`; `steps` remains empty and cooking mode remains blocked. |
| Times | Existing prep/cook/total values remain reviewed evidence. Active/passive split remains unknown. |
| Nutrition, equipment, storage | Explicit unknown states; nothing is inferred from tags or summaries. |
| Dessert and snack categories | Retained as distinct primary roles; neither is silently mapped to the other. |
| Kitchen-tested status | Lifecycle is retained, but `kitchenTestedAt` remains null because v2 supplies only a general review date, not a kitchen-test date. |
| Rights | `review-needed`, independent-summary-only, no image license. |

The adapter does not parse free-text review notes to manufacture subrecipe dependencies. For example, the quesadilla seasoning remains a preserved nonquantified needs-review requirement until a future source review captures a dependency URL and essential/optional status.

## Derived readiness gates

Minimum safe import requires a structurally valid recipe with attributable source/yield, preserved ingredient evidence, and an explicit completed ingredient-completeness review. Recommendation readiness additionally requires **approved** factual-metadata rights (neither `review-needed` nor `restricted` qualifies), reviewed scaling, meal-portion guidance, active-time knowledge, reviewed/explicit suitability, and resolution of essential subrecipes. It also requires revision-specific `approved` decisions for ingredient normalization, output scaling, meal portions, and effort; `unreviewed`, `provisional`, and `blocked` are enforced blockers even when the associated value has reviewed provenance. Cooking readiness additionally requires reviewed structured steps, safety review, and reviewed equipment state.

A migrated record whose v2 lifecycle says `kitchen-tested` keeps that lifecycle but receives no invented test date. It gets `kitchen-test-date-unknown`, which blocks cooking-mode readiness until actual date evidence is supplied; recommendation readiness remains governed by the normal evidence and rights gates.

Readiness is recomputed rather than trusted from serialized input. A record that claims a gate it has not earned is invalid.

## Narrow implementation clarifications

The illustrative architecture type required three explicit additions so approved rules can be represented without inference:

1. `SubrecipeDependency.required` distinguishes an essential unresolved input—which blocks complete grocery/recommendation results—from a disclosed optional dependency. A `linked-version` also requires an exact `revisionId` paired with `recipeId`; it never follows the latest revision implicitly.
2. `equipmentReviewState` distinguishes “not collected” from a reviewed conclusion that no special equipment is required.
3. `review.structuredStepsReviewed` and `review.safetyReviewed` make the cooking-mode gate auditable instead of deriving review from array presence.

`legacyMethodSummary` is also explicit because the migration section requires carrying v2 summaries without presenting them as structured cooking instructions.

These fields implement approved requirements; they do not add recipe facts or change runtime behavior.

## Future first-import path

Future ingestion should stage a v3 draft and require a reviewer to capture all available first-visit evidence listed in `V3_ARCHITECTURE.md`, especially publisher serving count/size and publisher-reported nutrition with its basis. Computed nutrition remains deferred. Restricted method-review artifacts must stay outside the public repository; only independently written structured instructions may enter the public catalog.

The compatibility adapter is not the new-recipe ingestion workflow. It exists only to preserve the current v2 snapshot honestly while v3 collection tooling is built.

## Reproducing the migration result

Run:

```sh
npx vitest run src/domain/recipeV3Migration.test.ts
```

The test adapts all 25 live v2 recipes, validates them as one v3 catalog, asserts stable identifiers and exact aggregate counts, checks deterministic JSON round trips, and exercises invalid records. The complete project gate remains `npm run check`.

## Not implemented

- No v3 catalog is imported by the application.
- No new recipe ingestion UI or source research is included.
- Batch, allocation, prepared-food, and pantry-confidence calculations remain isolated domain modules and are not connected to live runtime behavior. Personal-data v3 now has an opt-in deterministic compatibility preview and separate recoverable snapshot, but no week conversion, v3 planning activation, or optimizer is implemented.
- No computed nutrition, source-text reproduction, accounts, synchronization, or deployment changes are included.
