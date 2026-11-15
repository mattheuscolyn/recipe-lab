# Pantry MVP

Pantry inventory is personal browser-local data. It starts empty and is included in the existing JSON backup and recovery flow.

## Safe matching decisions

- A pantry lot offsets a grocery requirement only when its canonical ingredient and variant IDs both match.
- Its unit must convert to the ingredient's canonical base unit through the existing conversion rules. Count yields, density assumptions, and variant substitutions are never invented.
- Multiple matching lots are summed once each, but applied coverage is capped at the week's known demand.
- Unquantified requirements remain unresolved. Incompatible lots are shown as **Needs review** rather than subtracted.
- Package and consumption estimates are recalculated from the remaining quantity to buy. Missing or unsafe pricing remains unknown, never `$0`.

## Planning semantics

Pantry coverage is an estimate for the currently viewed week. Scheduling meals, marking recipes cooked, checking groceries, and moving between weeks never deduct or reserve pantry quantities. Best-by dates are optional planning cues: past dates and dates within seven days are surfaced without making safety or disposal claims.

## Review demo

1. Open **Pantry**, add a Garlic / Fresh clove lot with quantity `4`, and optionally add a best-by date and note.
2. In **Plan**, schedule meals that total seven garlic cloves for the viewed week.
3. Open **Grocery** and verify Garlic displays `7 clove` required, `4 clove` in pantry, and `3 clove` to buy with a one-package estimate.
4. Check the Garlic grocery item or change weeks, then return to Pantry and verify the recorded quantity is still `4`.
5. Add another lot with a different date, edit it, and delete it explicitly.

Later work may add purchase records, explicit consumption, multiweek allocation, external spreadsheet synchronization, or notifications. None are part of this MVP.
