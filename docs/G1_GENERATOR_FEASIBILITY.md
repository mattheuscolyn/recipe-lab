# G1 weekly generator contracts and candidate feasibility

> **Status:** reusable domain foundation for [Issue #21](https://github.com/mattheuscolyn/recipe-lab/issues/21). It is not connected to the live planner and does not generate or persist a week.

## Implemented boundary

`src/domain/generatorV3.ts` defines Zod-validated, JSON-safe contracts for a `PlanningRequest`, a proposed `GeneratorCandidate`, and a `CandidateFeasibility` result. A request snapshots the planning horizon, requested portions, skips and locks, exact recipe revisions, hard ingredient/recipe avoids, household taste votes, active/elapsed cooking limits, active cooking windows, prepared-food inventory, pantry availability, recent meals, and office-lunch policy. `hardConstraints` is structurally separate from `preferences`; preferences can explain or eventually rank a candidate, but cannot override a rejection.

`evaluateCandidateFeasibility` is deterministic and side-effect free. It returns `eligible`, `rejected`, or `review-needed` with stable reason codes, involved entity IDs, and exact missing fields. It checks:

- exact recipe revision and recommendation-readiness;
- locks, skips, meal roles, hard avoids, and cooking limits;
- approved batch multipliers, source yield, whole-item constraints, output conservation, and meal portions;
- no lunchtime cooking unless a meal explicitly permits it;
- reviewed prepare-ahead or leftover suitability and evidence-backed storage windows; and
- reviewed office assembly, reheating, odor, and rice suitability.

Batch projections delegate to the existing v3 planning functions. G1 therefore cannot produce a candidate that passes different portion, whole-item, timing, or storage rules than the eventual plan entities.

## Executable acceptance scenario

`src/domain/generatorV3Fixtures.ts` contains a permanent seven-day request and candidates using explicitly synthetic, fully reviewed recipes. The week includes two-person dinners, varying lunch portions, Sunday meal prep, a dinner feeding later leftovers, repeating breakfasts, varied dinner intent, one skipped lunch, one locked dinner, a no-cook/no-assembly office policy, and conflicting household votes. Candidate expectations cover eligible prep and leftovers, rejected lunchtime cooking and office assembly, lock protection, and review-needed unknown service facts.

These are candidate-level fixtures, not a fabricated optimizer result. An additional executable insufficient-options scenario probes an unreviewed-only catalog, returns no eligible candidates, and names every non-skipped slot as unfillable. The future optimizer must use these inputs to prove that it can assemble a complete week—or return those precise unmet slots—rather than fabricate coverage.

S12 is now executable: a recipe cooked at lunch is rejected by default, while a reviewed earlier prep event or a reviewed safe leftover route can be eligible. Unreviewed recipe or service facts never silently pass.

## Actual-catalog readiness

The reproducible report at [`data/G1_RECIPE_READINESS.json`](data/G1_RECIPE_READINESS.json) is generated with `npm run report:g1`. It audits all 25 migrated v3 recipe drafts and names exact blocker fields. Current result: all 25 remain usable as minimum imports, and **0 of 25 are recommendation-ready**. No source evidence, serving interpretation, scaling policy, storage guidance, or suitability rating was invented.

The prioritized first review group is deliberately diverse:

1. Overnight Oats Base Recipe — breakfast / prep-ahead candidate
2. Banana Flax Muffins — breakfast / batch candidate
3. Southwest Tofu Scramble — breakfast
4. Greek Chicken Pasta Salad — lunch / prep-ahead candidate
5. Hearty Black Bean Quesadillas — lunch
6. Sheet Pan Chicken Fajitas — dinner
7. Beef and Cabbage Stir Fry — dinner
8. Easy Vegetable Stir Fry — dinner
9. Salmon Patties — dinner

“Candidate” means priority for real source and product review, not approved suitability. Each still needs reviewed scaling, meal-portion guidance, active time, suitability/storage, and metadata-rights approval as shown by the machine-readable report.

## What remains before an end-to-end generated week

1. Review enough diverse real recipes to satisfy the readiness gates; today the real eligible pool is empty.
2. Implement the whole-week search/optimizer that chooses candidates, balances repetition and preferences, proves complete slot coverage, and explains infeasibility.
3. Integrate prepared inventory and pantry-aware batch grocery demand across the chosen candidates, including S06 thaw/prep tasks.
4. Add preview, explicit user acceptance, persistence, and rollback without replacing the current v2 plan or original personal data.

G1 intentionally does not modify v2 data, the public planner, browser storage, UI, deployment, or the active runtime import graph.
