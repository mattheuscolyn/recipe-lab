# G3a weekly recommendation engine

G3a adds the first deterministic end-to-end `generateWeekDraft` domain function. It accepts an arbitrary validated `PlanningRequest`, canonical ingredient snapshot, and explicit search bounds. It returns either a complete proposal or an explicitly incomplete proposal with unmet requirements and aggregated blockers. It does not persist, activate, or display recommendations in the live v2 application.

## Implemented vertical slice

- `candidateEnumerationV3.ts` generalizes the route patterns first exercised by G2B2a. Dates, meal requirements, portions, cooking windows, exact recipe revisions, service assessments, and storage windows all come from the request; the generator contains no fixed November week.
- Every cooked route passes the existing G1 `evaluateCandidateFeasibility` gate before search. Review-needed and rejected routes cannot enter a proposal.
- Bounded backtracking explores alternatives instead of committing to the first local candidate. It evaluates a solver-configurable maximum number of complete proposals for the actual request, independent of dinner count or leftover use, and records actual backtracking. Completion and household acceptability rank first, followed by dinner variety, practical batch reuse, active effort, repeats, pantry reuse, and waste. Unknown preferences receive neither a bonus nor a penalty.
- Selected routes are materialized through the existing batch, cook-event, and allocation primitives. Planned output is conserved, overlapping cooking events are rejected, aggregate active minutes cannot exceed their shared cooking-window budget, and one prepared lot cannot be selected twice.
- Grocery demand is derived once from the unique selected batch list. Stored allocations from that batch do not add demand. Existing prepared inventory adds no grocery demand.
- The proposal carries selected meals, exact recipe revisions, cooking events, batches, allocations, one grocery list, scoring components, selected-route explanations, rejected G1 alternatives, unselected eligible alternatives, and unmet requirements.

## Executable complete week

The permanent synthetic fixture spans February 1–7, 2027 in `America/Los_Angeles`. It requests two-person breakfasts and dinners, alternating one- and two-portion office lunches, a locked Wednesday dinner, and skipped weekend lunches. Nine explicitly synthetic, fully reviewed recipe revisions demonstrate functionality without creating production approvals.

Run:

```sh
npm run report:g3a
```

The reproducible proposal is committed at [`data/G3A_SYNTHETIC_WEEK_DRAFT.json`](data/G3A_SYNTHETIC_WEEK_DRAFT.json). It is an engine acceptance artifact, not a coverage/readiness report and not production recipe data.

The generated week demonstrates:

- all 19 required meal slots filled and two lunches explicitly skipped;
- repeated breakfasts supplied through safe advance-prepared batches;
- at least five distinct dinners, with the synthetic household-disliked dinner excluded;
- reviewed office-lunch service and dinner batches that supply real later leftovers;
- a retained exact-revision dinner lock;
- non-overlapping proposed cooking events;
- batch conservation and a consolidated outstanding grocery list calculated once per selected batch.

### Generated acceptance week

| Day | Breakfast | Office lunch | Dinner |
| --- | --- | --- | --- |
| Mon Feb 1 | Tofu Scramble (prepared) | Sheet-Pan Chicken (prepared) | Sheet-Pan Chicken |
| Tue Feb 2 | Tofu Scramble (prepared) | Sheet-Pan Chicken (prepared) | Cheeseburger Pasta |
| Wed Feb 3 | Tofu Scramble (prepared) | Sheet-Pan Chicken (prepared) | Beef and Cabbage (locked) |
| Thu Feb 4 | Tofu Scramble (prepared) | Beef and Cabbage leftover | Pesto Chicken |
| Fri Feb 5 | Tofu Scramble (prepared) | Beef and Cabbage leftover | Sesame Chicken |
| Sat Feb 6 | Tofu Scramble (prepared) | Skipped | Sheet-Pan Chicken |
| Sun Feb 7 | Tofu Scramble (fresh) | Skipped | Sheet-Pan Chicken |

This exact deterministic draft uses 11 cooking batches, five distinct dinners, three dedicated-prep routes, two dinner-to-lunch routes, and six fresh routes. Its consolidated list has 44 ingredient/variant lines. Five non-quantified source requirements remain visibly uncertain; the engine does not invent amounts for them.

The unchanged production approval manifest is also executed through `generateWeekDraft`. With 25 recipes, seven source-reviewed recipes, and zero production approvals, it returns an incomplete proposal with no batches and explicit `recommendation-readiness-required` blockers. Synthetic approvals never leak into that request.

## Safety and scope boundaries

Recommendation readiness, rights, reviewed storage duration, office-service evidence, hard avoids, locks, portions, whole-item scaling, and cooking-window checks remain enforced. Unknown storage or service information remains blocked. Synthetic revisions and service evidence live only in test/acceptance fixtures and are never inserted into the production approval manifest.

Dedicated-prep enumeration uses the preparation start as the conservative storage start because the current recipe contract does not identify the exact refrigeration-entry step. This may reject otherwise safe routes, but it cannot shorten storage by moving the clock past passive resting. Publisher yield ranges likewise remain review-needed; the generator does not select an exact yield from a range.

Prepared inventory may be proposed only when its exact recipe revision is recommendation-ready, the lot has an explicit best-use end, service falls before both that end and `storedAt +` the recipe-reviewed storage maximum, the storage mode matches, office-service facts pass the request policy, and remaining output covers the allocation. Missing or expired metadata becomes an explicit unmet-slot blocker. Frozen lots additionally require reviewed no-thaw handling and reviewed reheating suitability; thaw-required routes remain blocked until S06 can schedule the work. The draft leaves the input lot unchanged; actual reservation/persistence remains future acceptance work.

Out of scope: live v2 changes, v3 planner writes, user acceptance/persistence, UI activation, production approvals, recipe collection, and deployment. G3b still needs broader production-catalog hardening, selected alternative-aware grocery substitution, richer scoring calibration/top alternatives, and evidence-backed S06 prep/defrost tasks before G4 exposes a read-only product preview.
