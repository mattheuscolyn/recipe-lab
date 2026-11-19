# V3 cooking batches, meal allocations, and leftover accounting

> **Status:** deterministic domain foundation implemented; not connected to the live Recipe Lab UI, browser storage, or v2 weekly plan.

## What is implemented

`src/domain/planningV3.ts` implements validated, serializable planning entities and pure operations for:

- `MealRequirement`, `CookEvent`, `Batch`, `MealAllocation`, and `PreparedFoodLot`;
- recipe and immutable revision links on every production/inventory entity;
- reviewed batch multipliers, ranged-yield selection, whole-item guards, and exact planned output;
- meal-portion to source-output allocation using reviewed recipe guidance, never calorie-derived sizing;
- fresh, refrigerated, and frozen allocations with reviewed storage evidence and exact timing checks;
- explicit `Confirm cooked` creation of actual prepared-food inventory;
- version-checked reserve, serve, cancel, manual-adjust, and discard transitions;
- conservation and referential-integrity validation across a planning snapshot; and
- lock-aware cancellation, portion changes, skipping, and replacement with immutable `before`/`after` snapshots plus explainable changed/invalidated/preserved IDs.

`src/domain/planningGroceryV3.ts` derives ingredient demand exactly once per noncancelled batch. It preserves per-batch provenance, consolidates exact ingredient/variant pairs, keeps unresolved quantities visible, and applies only confirmed measured pantry quantities with compatible units. A stable availability ID prevents the same measured record from being applied twice. Estimates do not mutate pantry input.

These modules have no import path from the live application. The v2 catalog, current calendar, pantry, grocery experience, and browser-local personal data remain unchanged.

## Implemented terminology and contract clarifications

Two implementation-level additions make the approved model executable without changing its meaning:

1. The issue calls an unmet requirement `unplanned`, while the architecture draft calls it `open`. The implementation uses `unplanned`, the milestone's accepted term. It has the same meaning: positive demand without a complete active allocation.
2. `MealRequirement.intendedAt` is nullable. A date alone is insufficient to prove that refrigerated/frozen use falls within an evidence-backed hour window. Fresh allocations may omit the time; stored allocations may not.

The implementation also adds stable `recipeId` beside `recipeRevisionId`, evidence IDs for batch output and stored allocations, and internal `cancelled` batch state. These support exact revision pairing, explainability, and non-destructive edits. They do not change recipe facts.

### Calendar and instant policy

`MealRequirement.date` is the user's local calendar date. `timeZone` is a required IANA zone such as `America/Los_Angeles`, and `intendedAt` is an absolute ISO timestamp. Validation derives the local date with the IANA zone; it never compares a local date with a UTC string prefix. Fresh same-day checks also project the cook instant into the meal's zone. This handles Pacific evening timestamps that fall on the following UTC date, local midnight, and daylight-saving transitions. Storage durations remain elapsed-time comparisons between absolute instants.

## Conservation and lifecycle rules

- A zero-portion requirement must be `skipped`; a skipped requirement cannot have an active allocation.
- A planned requirement is complete only when active allocations exactly meet requested portions.
- Batch allocations cannot exceed planned output, and prepared-lot commitments cannot exceed initial inventory.
- Discrete-item output and allocation amounts are integers.
- A planned batch is not food inventory. A prepared lot is created only by explicit cook confirmation with actual output.
- Fresh allocations become served on confirmation. Stored allocations become versioned prepared-lot reservations. Unallocated actual output becomes available inventory.
- Cook confirmation revalidates every stored allocation against the actual completion instant. A reservation before `storedAt`/the best-use start is invalid even if it was feasible against the originally planned cook time.
- Reservation checks use the caller's expected lot version, so a stale concurrent write fails.
- Cancelling a planned batch invalidates its allocations, derived task IDs, and grocery-demand ID. Unrelated entities retain their IDs; a locked dependent meal blocks the destructive edit.
- A `served` allocation is immutable to prospective portion/replacement edits. Correcting history requires a future separately audited adjustment operation; this foundation never rewrites consumption as cancelled planning.

## Acceptance coverage

| Scenario | Coverage |
| --- | --- |
| S01 | Reviewed source-serving guidance drives allocations; calories are not used for portion math. |
| S02 | One batch can supply multiple meal requirements; grocery contribution remains one batch. |
| S03 | Fresh and stored allocations conserve output and require storage-window evidence. |
| S04 | Skipped requirements validate with no downstream entities. |
| S05 | Portion demand is modeled without person/profile identity. |
| S07 | Two batches consolidate demand; confirmed measured exact pantry stock offsets once. |
| S08 | Replacement/cancellation invalidates only dependency IDs and preserves unrelated locks. |
| S09 | Ambiguous yield and incompatible pantry units remain explicit uncertainties. |
| S10 | Discrete output, allocations, multipliers, and whole-item inputs reject fractions. |
| S11 | Planned batches create no inventory; confirmed lots use version-safe reservations. |

S06 (thaw-task policy execution) and S12 (candidate feasibility for the lunch-cooking policy) are intentionally deferred. This milestone records and invalidates derived task IDs but does not implement task generation or an optimizer/candidate engine.

## Grocery uncertainty behavior

Each line exposes both `knownSubtotal` and nullable `total`. If any contribution cannot be quantified safely, `total` and `toBuy` remain `null`; the known portion is not discarded. `likely-owned`, unknown, unquantified, wrong-variant, and incompatible-unit pantry records subtract zero. They remain check/uncertainty signals.

Callers must choose a grocery scope. `historical` reports ingredient demand for planned and already prepared batches, which is useful for a whole-plan audit. `outstanding` includes only batches still in `planned` state and therefore does not tell someone to buy ingredients for already cooked food. It is still ingredient demand—not a purchased/checklist ledger—so a later integration must also reconcile items already bought or checked off before presenting a final shopping list.

Offers, package rounding, and price totals remain in the existing v2 grocery pipeline. They are not duplicated here because this milestone establishes batch demand and pantry coverage, not a replacement UI.

## Future integration boundary

Later milestones may persist these entities, adapt legacy weeks, generate prep/defrost tasks, evaluate lunch feasibility, or optimize a plan. Integration must remain explicit and previewable. It must not infer actual leftovers from a calendar entry, mutate pantry from a read-only estimate, or silently replace v2 personal data.
