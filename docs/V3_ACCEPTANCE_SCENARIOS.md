# Recipe Lab 3.0 acceptance scenarios

These are executable-test specifications for the next implementation PR. IDs and quantities are illustrative fixtures, not production data or claims about the current recipes.

## Shared test vocabulary

```ts
type ScenarioResult = {
  mealRequirements: MealRequirement[]
  cookEvents: CookEvent[]
  batches: Batch[]
  allocations: MealAllocation[]
  preparedLots: PreparedFoodLot[]
  tasks: PrepTask[]
  groceryDemand: GroceryDemand[]
  explanations: { code: string; entityIds: string[] }[]
}
```

All tests assert schema validity, stable IDs, nonnegative quantities, allocation conservation, and no mutation of input pantry/prepared-lot snapshots.

---

## S01 — light source servings need an explainable meal amount

**Fixture**

- Flexible soup yields four publisher source servings.
- Publisher-reported nutrition: 200 kcal per source serving, basis includes the soup only.
- Dinner meal requirement requests two meal portions.
- Reviewed guidance offers either two source servings per dinner portion or one source serving plus a side.

**Expected**

- Candidate A creates one default four-source-serving batch (`multiplier: 1`) and allocates all four source servings to the two dinner portions. Candidate B creates the same batch, allocates two source servings with explicit side requirements, and records the other two source servings as an unallocated planned remainder (not actual leftover stock); a reviewed half-batch could avoid that remainder when its multiplier is allowed.
- Explanation says the publisher serving is light for the selected dinner role.

**Checks**

- No allocation uses an arbitrary calorie-derived amount such as `1.63` source servings.
- Candidate A leaves no unexplained batch remainder and grocery demand reflects one publisher batch, not a doubled batch; Candidate B exposes rather than hides its planned remainder.
- Unknown side calories do not become zero.
- A user lock choosing one serving per portion is allowed with an adequacy warning, not rejected.

## S02 — Sunday meal prep supplies multiple lunches once

**Fixture**

- Monday–Thursday lunch each requests one meal portion; lunch cooking is disallowed.
- Meal-prep recipe yields four reviewed source portions.
- Sunday has a preparation window.

**Expected**

- One Sunday cook event, one four-portion batch, four weekday allocations.
- Grocery demand contains one scaled recipe batch.

**Checks**

- Sum of allocations equals four and does not exceed output.
- Grocery ingredients are not multiplied by four calendar appearances.
- No lunchtime cook event exists.

## S03 — dinner extras cover later lunch with storage evidence

**Fixture**

- Monday dinner requests two portions; Tuesday lunch requests one; Wednesday lunch optionally requests one.
- Recipe is reviewed as refrigerated-leftover suitable for the relevant window.
- Batch produces four source portions; one meal portion maps to one source portion.

**Expected**

- Monday cook event and four-portion batch.
- Two fresh allocations Monday, one refrigerated allocation Tuesday, and optionally one Wednesday only if its reviewed storage window includes Wednesday.

**Checks**

- One batch generates grocery demand once.
- If the storage window ends before Wednesday, Wednesday remains open with `storage-window-exceeded`.
- Planning the batch creates no actual `PreparedFoodLot`; confirming the cook event does.

## S04 — skipped dinner produces no demand

**Fixture**

- Wednesday dinner has `requestedPortions: 0`, status `skipped`.

**Expected/checks**

- No allocation, batch, cook event, prep task or grocery demand references the skipped requirement.
- The skipped requirement remains visible and is not treated as an optimization failure.

## S05 — portion counts do not require person identities

**Fixture**

- Monday lunch requests one portion; Monday dinner requests two.
- Same recipe may be feasible for either meal with a reviewed one-to-one source-serving mapping.

**Expected/checks**

- Allocations are one and two source servings respectively.
- No person/user profile IDs exist in the fixture or result.
- Preferences and nutrition are evaluated per meal requirement, not attributed to named people.

## S06 — frozen meat creates a justified thaw task

**Fixture**

- Planned Tuesday dinner batch requires a raw meat ingredient.
- Confirmed pantry lot identifies that ingredient/variant as frozen.
- A reviewed thaw policy exists but provides a timing window rather than a single universal duration.

**Expected**

- A `DefrostTask` references the cook event, ingredient lot and evidence/policy ID.
- Task has an earliest/latest window and an explicit safe-method note or asks the user to choose a method.

**Checks**

- Planner does not assert a made-up exact thaw duration.
- If storage state is unknown, task is a check/reminder, not a claim that the meat is frozen.
- A pantry note containing the word “frozen” does not create a defrost task; only the structured per-lot storage state with reported/reviewed evidence can do so.
- Cancelling the cook event cancels its derived thaw task.

## S07 — two cook events share parsley; pantry offsets once

**Fixture**

- Two distinct batches each require 20 g fresh parsley.
- Confirmed measured pantry lot contains 15 g of the exact variant.
- A likely-owned parsley record has no measured quantity.

**Expected**

- Grocery requirement consolidates to 40 g.
- Confirmed pantry coverage applies 15 g once for the horizon; to buy is 25 g.
- Likely-owned record produces a “check pantry” explanation but subtracts zero.

**Checks**

- Pantry coverage never exceeds 40 g or becomes negative.
- Switching to another planning horizon does not mutate the pantry lot.
- Incompatible parsley form/unit is not subtracted.

## S08 — replacing or locking dinner updates only dependencies

**Fixture**

- Monday dinner batch supplies Tuesday lunch leftovers.
- Wednesday dinner is separately locked.
- User replaces Monday dinner with a recipe that has no reviewed leftovers.

**Expected**

- Monday batch, grocery demand, tasks and Tuesday dependent allocation are invalidated/recomputed.
- Tuesday lunch becomes open with `dependent-leftover-invalidated`.
- Wednesday locked requirement/allocation/batch IDs remain byte-for-byte unchanged.

**Checks**

- Dry-run result lists changed and preserved entity IDs.
- A locked Monday dinner cannot be replaced without explicit unlock/confirmation.
- No orphan allocation references the removed batch.

## S09 — unknown nutrition, ambiguous yield and incompatible units stay honest

**Fixture**

- Calories are `unknown`.
- Source yield is “serves 4–6” with no serving size.
- One ingredient requirement is a cup volume while a pantry lot for the same ingredient is grams and no density exists.

**Expected**

- Recipe remains available for manual selection.
- Automated batch scaling stays original/range-reviewed or asks for a choice.
- Pantry lot offsets zero; grocery line remains `needs-review`.

**Checks**

- Calories do not become `0` and recipe is not rejected for missing nutrition.
- No mass↔volume conversion appears.
- Explanation exposes yield and pantry uncertainty.

## S10 — discrete whole-item output never creates fractions

**Fixture**

- Recipe produces six muffins; reviewed meal guidance is two muffins per portion.
- Meal requires one portion; allowed batch multipliers are `0.5`, `1`, `2` only if the reviewed recipe says a half batch produces three whole muffins.

**Expected**

- Planner may choose a reviewed three-muffin half batch, allocate two and leave one, or choose six and leave four.
- If half-batch scaling is unreviewed, it must choose six or ask the user.

**Checks**

- Batch and allocation amounts are integers.
- No `1.5 muffin`, fractional egg or unsupported multiplier is generated.
- Grocery scaling matches the chosen reviewed batch, not merely requested items.

## S11 — multiweek pantry and leftovers avoid phantom inventory

**Fixture**

- Week 1 has a planned but unconfirmed batch and a confirmed 500 g pantry lot.
- Week 2 is viewed independently and requests the same ingredient.
- No actual prepared-food lot exists.

**Expected**

- Week 1 planned leftovers are not available in Week 2.
- The pantry lot remains unchanged in both read-only estimates; the UI discloses that separate horizons may reuse the same estimate.
- A cross-week leftover is feasible only after explicit batch completion creates a prepared lot and a reservation is recorded.

**Checks**

- No silent pantry decrement and no double reservation of one prepared lot.
- Concurrent reservation against the same lot version rejects the stale second write.

## S12 — lunch cooking is infeasible by default

**Fixture**

- Tuesday lunch requests one portion with `allowLunchCooking: false`.
- Candidate A requires a new 30-minute cook event Tuesday noon.
- Candidate B is a refrigerated allocation from Monday dinner.
- Candidate C is a Sunday prepared lunch batch.

**Expected**

- A is rejected with `lunch-cooking-not-allowed`.
- B and C are feasible when storage windows and conservation pass.
- Explicitly setting `allowLunchCooking: true` makes A feasible subject to time constraints.

**Checks**

- The default planner never quietly schedules lunch cooking.
- Explanation identifies whether lunch came from dedicated prep or leftovers.

---

## Additional migration scenarios

### M01 — legacy meal slot is not a cooked batch

- Import a personal-data v2 slot with recipe, date, meal, servings and lock.
- Migration produces an inhabitable `schemaVersion: 3` value, preserves the exact v2 payload and original `plan` slot semantics, and creates a matching `MealRequirement`/unallocated legacy choice.
- Assert zero `CookEvent`, `Batch`, `MealAllocation` and `PreparedFoodLot` entities until explicit week conversion.

### M02 — migration rollback and atomic failure

- Given preferences, plan slots, grocery checks and pantry lots, export exact v2 JSON.
- Simulate an invalid v3 overallocated batch or storage-write failure.
- Assert the active v2 state is unchanged, the original recovery export is available, and no partial v3 collections persist.

### M03 — recipe revision stability

- Adapt a v2 recipe with existing recipe/requirement/source-line IDs.
- Assert those IDs are retained and a deterministic legacy `revisionId` is assigned.
- A later reviewed source change creates a new revision without rewriting historical plan references.

## Quality-gate checklist for the implementation PR

- Property tests cover nonnegative conservation and whole-item integrality.
- Grocery tests prove one demand per batch and one pantry offset per horizon.
- Migration fixtures include v2 backups with preferences, locked slots, checks and multiple pantry lots.
- Unknown values remain `null`/explicit states through export/import.
- Optimizer candidate snapshots include explanations and preserved locked IDs.
- No scenario depends on new copyrighted source text or claims current recipes are kitchen-tested.
