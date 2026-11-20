# G2A real recipe evidence and recommendation readiness

The follow-on owner decision packet and immutable approval workflow are documented in [G2B1 recipe approval decisions](./G2B1_APPROVAL_DECISIONS.md).

Issue: [#26](https://github.com/mattheuscolyn/recipe-lab/issues/26), building on [#21](https://github.com/mattheuscolyn/recipe-lab/issues/21).

## Implemented scope

G2A adds an opt-in v3 review overlay. The live application still imports the v2 catalog and no personal-data or planner behavior changes.

- `recipeReviewArtifactSchema` is the durable review record. It names the exact base and resulting revision, source-access method, capture checklist, evidence, editorial decisions, unresolved issues, reviewed recipe, and version-specific service assessments.
- `applyRecipeReviewV3` accepts only the exact immutable base revision. It preserves stable recipe and requirement IDs, the canonical URL, and all prior evidence.
- Every recipe revision carries explicit ingredient-normalization, output-scaling, meal-portion, and effort decision states. Only `approved` satisfies recommendation readiness; `unreviewed`, `provisional`, and `blocked` create machine-enforced blockers. A review artifact must contain exactly one matching decision for each field.
- `reviewedRecipeCatalogV3` overlays reviewed revisions on the deterministic v2 migration without editing v2 source records.
- `G2A_RECIPE_READINESS.json` is reproducible with `npm run report:g2a` and includes all 25 recipes.

This is collection infrastructure and reviewed data, not a URL importer. No publisher instruction prose or imagery is stored.

## Source-review method

The publisher pages reject direct requests from the build environment, so this pass used the publisher pages through the connected web index. Every artifact records `publisher-page-index-reviewed` rather than claiming a direct-page fetch. Canonical publisher URLs—not search-result URLs—remain the evidence locations.

Each review captured, when present:

1. author/attribution and canonical URL;
2. output yield and the nutrition serving basis;
3. prep, cook, and total time;
4. ingredient alternatives, optional lines, and unresolved normalization assumptions;
5. explicit make-ahead, storage, and reheating statements;
6. publisher-displayed nutrition, including the publisher's warning that its values are automatically calculated and may include optional ingredients;
7. a separate editorial interpretation for meal portions, original-batch scaling, active effort, and attention.

Publisher facts cite `manual-source-review` evidence. Recipe Lab interpretations cite separate `editorial-judgment` evidence. Neither kind grants legal or food-safety approval.

## Initial real-recipe group

| Recipe | Use | Evidence added | Remaining recommendation decisions |
|---|---|---|---|
| Overnight Oats Base Recipe | repeatable breakfast | one 8 oz jar; 5 min active; overnight passive time; publisher nutrition; prep-ahead/refrigeration claim | metadata rights; a maximum storage window for later allocations |
| Banana Flax Muffins | batch breakfast | six-item output; one-serving nutrition basis; time; refrigerated storage claim | metadata rights; flour conversion; storage duration; owner acceptance of two muffins as a provisional meal portion |
| Southwest Tofu Scramble | quick breakfast | three 1-cup servings; time; publisher nutrition | metadata rights; recipe-specific storage/service review |
| Greek Chicken Pasta Salad | make-ahead lunch | 4 meal or 6 side portions; time; nutrition; prepare-ahead claim; 3–4 day refrigerator claim | metadata rights; exact yield per batch; chicken weight normalization; office odor review |
| Sheet Pan Chicken Fajitas | varied dinner | four 2-fajita servings; time; nutrition; leftover reheating methods | metadata rights; storage duration |
| Beef and Cabbage Stir Fry | varied dinner | four servings; time; publisher nutrition | metadata rights; recipe-specific storage/service review |
| Easy Vegetable Stir Fry | vegetarian dinner | four 1.5-cup servings; time; publisher nutrition | metadata rights; fixed ingredient branch; recipe-specific storage/service review |

The Greek salad refrigerator window is recorded as 72 hours, the conservative lower bound of the publisher's 3–4 day claim. Banana Flax Muffins, Greek Chicken Pasta Salad, and Sheet Pan Chicken Fajitas retain `unknown` categorical leftover quality: refrigeration, meal-prep, or reheating language is not attributed to the publisher as a `good` or `acceptable` rating.

## Before and after

| Readiness measure | Before | After |
|---|---:|---:|
| Real recipes source-reviewed in v3 | 0 | 7 |
| Publisher nutrition records captured | 0 | 7 |
| Original-batch scaling reviewed | 0 | 7 |
| Meal-portion guidance reviewed | 0 | 7 |
| Active-time interpretation reviewed | 0 | 7 |
| Source-specific suitability claims | 0 | 4 |
| Explicit maximum storage windows | 0 | 1 |
| Recommendation-ready real recipes | 0 | 0 |

Zero is intentional, not a framework-only outcome. Every recipe retains `rights-review-required`, and the provisional ingredient-normalization, meal-portion, and effort decisions now independently create formal readiness blockers. The original-batch scaling decision remains the already-reviewed, revision-specific approval. Three recipes also retain unknown overall suitability. A simulated rights-only change remains blocked; only a test-only copy with all four recommendation decisions explicitly finalized can pass the gate.

## G1 compatibility

Every reviewed recipe uses the exact G1 recipe/revision contract and original-batch output math. Regression tests run real reviewed revisions through batch planning and candidate feasibility. The Greek Chicken Pasta Salad has a version-specific refrigerated office-service assessment that supports no assembly, cold service, non-rice status, and zero service effort. Odor remains unknown, so G1 correctly returns `office-suitability-review-required` instead of allowing the recipe to self-certify.

No real recipe is demonstrated as `eligible` because none has all required approvals. G1 produces structured `recommendation-readiness-required` results with exact rights and editorial decision fields rather than silently admitting them. Once the owner/legal rights decision and listed recipe-specific reviews are resolved, these same fixtures can demonstrate eligibility without rewriting source capture.

## Required human decisions

1. **Metadata rights:** approve or restrict factual metadata use for the publisher. This must be an owner/legal decision; the technical review leaves all seven at `review-needed`.
2. **Editorial portion guidance:** approve the provisional meal portions, especially two Banana Flax Muffins and the 4-versus-6 Greek salad yield selection.
3. **Normalization assumptions:** approve or replace the banana-muffin flour conversion and Greek salad chicken-thigh planning weight.
4. **Food-safety/storage:** obtain recipe-specific reviewed windows for any planned leftovers. Only the Greek salad currently has a source-reported maximum.
5. **Office practicality:** review Greek salad odor acceptability. Publisher meal-prep language is not proof of workplace suitability.
6. **Flexible vegetables:** decide whether Easy Vegetable Stir Fry remains a fixed captured ingredient set or gains normalized alternative branches.

## Future work, not implemented

- owner/legal and food-safety approval workflow or signatures;
- kitchen testing and structured cooking-mode instructions;
- generalized source ingestion;
- broader recipe review;
- G3 optimization, v3 planner writes, or changes to the public application.

