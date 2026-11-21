# G2B2a real-catalog coverage and approval shortlist

Scope: [Issue #30](https://github.com/mattheuscolyn/recipe-lab/issues/30), toward the [Generate Week roadmap](https://github.com/mattheuscolyn/recipe-lab/issues/21).

## What the coverage evaluator proves

`buildRealCatalogCoverageReport` applies the real G2B1 production approval manifest to the 25-recipe v3 catalog, creates two fixed seven-day requests, and sends every candidate route through the existing G1 `evaluateCandidateFeasibility` function. It does not rank recipes, choose a week, persist a plan, or weaken a G1 gate.

The ordinary scenario requests two-person breakfasts and dinners plus alternating one- and two-portion weekday office lunches. Weekend lunches are explicitly skipped. The constrained scenario adds a locked Wednesday dinner, a skipped Friday dinner, a 25-active-minute/45-elapsed-minute dinner limit, and an example beef ingredient constraint. Neither scenario contains household taste votes; preference state is therefore `unknown`, not inferred from publisher ratings.

The report evaluates fresh breakfast/dinner routes, advance-prepared breakfasts, Sunday dedicated-prep office lunches, and prior-dinner refrigerated leftovers. Fresh breakfast preparation is limited to 6:30–8:00 a.m. Pacific. A recipe whose reviewed elapsed time exceeds that 90-minute window is not probed as fresh. Recipes with reviewed prepare-ahead suitability or long elapsed time instead receive a distinct 9:00 p.m.–6:00 a.m. Pacific advance window, using `dedicated-prep` plus refrigerated service until breakfast so G1 must verify prepare-ahead, storage, and service-effort evidence. It records per-route batch grocery demand as quantified, review-needed, or unavailable. This is candidate-level demand only: consolidating selected routes into one week and one shopping list remains G3 work.

All 25 recipes contribute to route counts and per-slot blocker aggregates. To keep the committed artifact reviewable, detailed route rows are retained for source-reviewed recipes and for any eligible route; an eligible route can therefore never disappear into aggregation. A slot's `blockerScope` is `whole-routes-touching-slot`: blockers summarize complete multi-meal routes that touch the slot, so a dinner may display an office-lunch blocker when the proposed route couples that dinner to a later lunch. These are route blockers, not claims that every blocker applies directly to the named slot.

Reproduce the report with:

```sh
npm run report:g2b2a
```

Committed output: [`data/G2B2A_REAL_CATALOG_COVERAGE.json`](data/G2B2A_REAL_CATALOG_COVERAGE.json).

## Honest baseline

| Measure | Result |
|---|---:|
| Structurally valid v3 recipes evaluated | 25 |
| G2A source-reviewed recipes | 7 |
| Production approval bundles | 0 |
| Production recommendation-ready revisions | 0 |
| Recipes with any eligible G1 route | 0 |
| Complete scenarios | 0 of 2 |

The ordinary scenario evaluates 318 routes over 19 required and two skipped slots. The constrained scenario evaluates 302 routes over 18 required and three skipped slots. Both have zero covered required slots.

Regression coverage also runs an isolated, fully reviewed synthetic dinner through this same evaluator. It proves that an eligible fresh route increments `recipesWithEligibleRoutes`, `eligibleRouteCount`, and `coveredSlotCount`, while a locked different dinner remains uncovered and unsupported stored routes remain ineligible. The fixture is never inserted into the production catalog or approval manifest.

Every non-skipped slot is reported as uncovered. A source-reviewed record is not called recommendation-ready, and a recommendation-ready fresh route would not automatically qualify for storage or office service.

## Actionable approval shortlist

The shortlist favors weekly utility before technical ease. Reviewer IDs and authority text in a manifest are audit fields, not authentication; the project owner must verify each real human and their authority outside the repository before a production record is committed.

### 1. Greek Chicken Pasta Salad — highest-value office-lunch path

Exact reviewed revision: `revision-10000000-0000-4000-8000-000000000009-g2a-1`

Evidence already captured:

- publisher range of four meal portions or six side portions;
- publisher prepare-ahead claim and conservative 72-hour refrigerator maximum from its 3–4 day statement;
- cold, no-reheat service; and
- publisher nutrition plus reviewed 60-minute active/elapsed planning interpretation.

Required decisions:

- **Source facts:** substantiate or replace the two-chicken-thigh planning weight. Choose the exact four-meal or six-side output policy used by a batch.
- **Owner/editorial:** approve meal adequacy and the high-effort interpretation.
- **Factual-metadata rights:** approve or restrict factual-metadata use for the exact publisher scope.
- **Office service:** a real reviewer must decide odor suitability. After the recipe revision changes, create a matching immutable service-assessment revision; the G2A assessment cannot be silently retargeted.

Effect: universal approvals could make the fresh recipe recommendation-ready. The source-supported prepare-ahead/storage path plus an exact office assessment could then support several cold office lunches. Categorical leftover quality remains unknown and is not needed for a dedicated-prep route, but it still blocks a dinner-leftover route.

### 2. Overnight Oats Base Recipe — repeatable breakfast, but not yet a two-person batch

Exact reviewed revision: `revision-10000000-0000-4000-8000-000000000015-g2a-1`

Evidence already captured: one 8-ounce jar, five active minutes, overnight passive time, publisher nutrition, and an explicit overnight/meal-prep claim.

Required decisions:

- **Source facts:** approve the fixed base ingredient representation, including nonquantified salt.
- **Owner/editorial:** decide whether one jar is an adequate breakfast and approve effort.
- **Factual-metadata rights:** approve or restrict factual-metadata use.
- **Before two-person coverage:** create a new reviewed revision with an evidence-supported two-jar batch/scaling policy. The current fixed one-jar batch cannot fulfill two portions, and an approval record cannot rewrite that fact.
- **Food safety:** a multi-day route still needs a claim-specific maximum storage window. “Overnight” does not establish several days.

Effect: valuable breakfast pattern after the batch issue is corrected; current two-person probes correctly return insufficient output.

### 3. Sheet Pan Chicken Fajitas — useful varied dinner after grocery branching is integrated

Exact reviewed revision: `revision-10000000-0000-4000-8000-000000000001-g2a-1`

Evidence already captured: four two-fajita servings, 20 active/55 elapsed minutes, publisher nutrition, and reheating methods.

Required decisions:

- **Source facts and downstream calculation:** resolve optional sour cream/cilantro and ingredient alternatives through selection-aware grocery demand. G2B1 correctly refuses ingredient approval while downstream shopping still assumes a different branch.
- **Owner/editorial:** approve two-fajita dinner adequacy and effort.
- **Factual-metadata rights:** approve or restrict factual-metadata use.
- **Household:** confirm interest only in browser-local preferences; do not commit private taste history.
- **Stored use:** obtain a claim-specific duration and quality assessment separately. Reheating instructions alone do not approve leftovers.

Effect: a useful fresh dinner after branch integration and real approvals. It is not an office-lunch shortcut.

### 4. Easy Vegetable Stir Fry — conditional technical shortest path, not assumed dinner coverage

Exact reviewed revision: `revision-10000000-0000-4000-8000-000000000016-g2a-1`

Evidence already captured: fixed listed ingredient set, four 1.5-cup servings, 25 active/elapsed minutes, and publisher nutrition of 209 kcal per serving.

Required decisions:

- **Owner/editorial:** explicitly choose whether 1.5 cups is an adequate standalone dinner, a side requiring a modeled protein/starch, or not a dinner.
- **Source facts:** approve only the fixed captured ingredient set; broad substitutions remain outside this revision.
- **Owner/editorial and rights:** approve effort and factual-metadata use through the correct authorities.

Effect: if—and only if—the owner authorizes it as a full meal, three authority-specific records are the shortest technical path to a fresh eligible candidate. If it is a side, revise the role or model its companion food first. The coverage target excludes it from credible standalone dinners today.

## Minimum coverage expansion

Source review breadth and actual eligibility are separate. Existing reviewed breadth is three breakfasts, one lunch, and three dinners. The dinner utility count is only two because Easy Vegetable Stir Fry is unresolved as a standalone meal.

| Need | Minimum additional source reviews | Recommended focus |
|---|---:|---|
| Breakfast patterns | 0 | Resolve the current oats, muffins, and tofu paths first; add one simple two-person fallback only if one is rejected by the owner. |
| Prepared/reheated lunch sources | 2 | Review two low-mess, no-assembly soup/chili-style recipes with explicit storage, reheating, quality, and office-service evidence. Existing Smoky Black Bean Soup and Best Lentil Soup are candidates, not approved claims. |
| Varied dinners | 4 | Add four genuinely different reviewed dinner paths to the two currently credible ones; favor a poultry dish, vegetarian protein, fish/patty meal, and one-pot pasta rather than more soup-only dinners. |

No additional source reviews are included in this PR. That is deliberate: a source review by itself would leave the production pool at zero while the four higher-value existing reviews still await human authority, rights, adequacy, and branch decisions. The next source work should start with the two lunch-source candidates once reviewers confirm that these meal types are useful; it must revisit the publishers and capture claim-specific facts rather than promoting v2 tags.

## Remaining work before G3

1. Obtain verified human decisions and apply exact production approval bundles in G2B2b.
2. Demonstrate at least one real G1 `eligible` route; fresh eligibility and stored/office eligibility must be shown independently.
3. Resolve selection-aware grocery demand for any chosen optional/alternative branches.
4. Build enough eligible breadth to cover the role gaps above.
5. Only then implement G3 whole-week search, contention/repetition handling, route selection, and consolidated shopping. Until every required slot has an eligible selected route, the week is infeasible.
