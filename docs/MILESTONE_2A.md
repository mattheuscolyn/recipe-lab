# Milestone 2A — personal discovery and planning

## Product behavior

Recipe Lab now has four connected views:

1. **Discover** records Interested, Save for later, Pass, or Not now and supports undoing the last decision. A pass changes personal state; it never hides or deletes the recipe.
2. **Library** searches all source-reviewed records and filters by meal, dietary tag, preference, or cooked state. Recipe details expose attribution and personal notes without copying source photography.
3. **Plan** is an explicit Monday–Sunday calendar with Breakfast, Lunch, and Dinner. It starts empty; the application does not auto-fill meals. A locked slot cannot be swapped, resized, or removed until unlocked.
4. **Grocery** derives from every scheduled slot in the currently viewed week. Repeats are separate contributions, servings scale independently, and consolidation still follows the reviewed canonical ingredient and variant rules.

The grocery week follows the plan week. Checked items are keyed by week plus canonical ingredient/variant, so moving to another week gets an independent checklist. Checks are presentation state only and do not imply pantry inventory.

## Persistence and recovery

Milestone 2A uses `localStorage` under `recipe-lab.personal.v1`. The payload is validated with Zod and contains only preferences, meal slots, and grocery-check state. The collection itself remains version-controlled application data.

`localStorage` was selected because the personal payload is small, synchronous, and easy to inspect or recover. A versioned schema and migration boundary are already present. If storage cannot be read or written, the UI displays a warning and continues in temporary memory. Library controls export and import the complete personal payload as JSON.

Moving to IndexedDB is intentionally deferred until data volume or attachment/offline requirements justify the added failure modes. The repository owner approved `localStorage` for Milestone 2A in the PR #6 review.

Catalog references are validated in addition to the structural Zod schema. A backup import containing an unknown recipe or duplicate date/meal slot is rejected before current data changes. If an older persisted payload contains either problem, the affected slots are quarantined from the active plan, a visible warning is shown, and the exact original JSON remains available as a recovery export.

Persistence status reflects the latest write, not only the initial page load. A quota or permission failure leaves the imported/edited state available in temporary memory, labels it accordingly, and keeps the normal JSON export available.

## Verification scenarios

- Choose a discovery preference, refresh, and find the same state in Library.
- Pass a recipe, confirm it remains searchable, then use Undo on a new decision.
- Schedule the same recipe twice at different servings and inspect two dated contributions in one consolidated grocery line.
- Remove either meal and confirm the grocery quantity and contribution count recalculate.
- Lock a slot and confirm its recipe, servings, and remove control cannot change until unlocked.
- Navigate to another week and confirm it starts empty unless that week was previously planned.
- Export personal JSON, clear browser data, import the file, and confirm the state round-trips.
- Open recipe details by keyboard, cycle focus through the modal, close with Escape, and confirm focus returns to the opener.
- Load a saved payload with an orphan or duplicate slot, export the untouched recovery JSON, and confirm groceries render only the quarantined-safe plan.

Automated coverage implements these cases where practical; browser screenshots are captured from the Vite build. Milestone 2A originally shipped without hosting; issue #7 adds an intentional static GitHub Pages preview while preserving browser-only personal data.

## Browser evidence

- [Desktop discovery](screenshots/milestone-2a-discover-desktop.png)
- [Mobile discovery](screenshots/milestone-2a-discover-mobile.png)
- [Desktop weekly plan](screenshots/milestone-2a-plan-desktop.png)
- [Desktop integrated grocery list](screenshots/milestone-2a-grocery-desktop.png)
