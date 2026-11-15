# Issue #3 acceptance report

- [x] Versioned v2 contracts separate canonical ingredients, source requirements, and package offers.
- [x] Source quantities and original factual lines remain traceable.
- [x] Unit dimensions and variants reject unsafe conversions; `1 cup + 2 tbsp = 1.125 cups` is tested.
- [x] Five hard-case real recipes from five publishers validate before collection scales.
- [x] Required normalization corrections and regression tests pass before expansion.
- [x] Collection contains 25 distinct, attributable real recipes with diverse proteins, vegetarian meals, breakfasts, lunches, and dinners.
- [x] Ad hoc JSON-LD staging suggests aliases and fails unresolved review.
- [x] UI selects up to three recipes, adjusts servings, consolidates groceries, and exposes source contributions.
- [x] Price demo separates checkout, consumption, and unused package quantity.
- [x] Tests cover conversions, aliases, serving multipliers, consolidation, rounding, missing price, approximate input, ingestion failures, and legacy defects.
- [x] A separate source-to-record line-count review covers all 25 recipes and records exceptions.
- [x] Mixed measured/nonquantified grocery lines remain unresolved in every recipe-selection order, with any measured amount labeled only as a known subtotal.
- [x] Compound salt-and-pepper source lines map to both grocery ingredients under one source-line identity.
- [x] Diced red onion uses the shared onion canonical identity while its incompatible cup measure remains visibly unresolved.
- [ ] Legal/source-terms review remains outstanding; the intentional public prototype preview is not clearance for source republication. Kitchen testing is not required for this milestone.

## Issue #5 — Milestone 2A acceptance report

- [x] Discovery offers Interested, Save for later, Pass, Not now, and one-step Undo with accessible native controls.
- [x] Passed and skipped recipes remain searchable and filterable in the complete library.
- [x] Preferences, cooked state, personal ratings, and notes persist under stable recipe IDs.
- [x] Personal data has a versioned schema, legacy migration, JSON export/import, and a visible storage-unavailable fallback.
- [x] Monday–Sunday plans start empty and provide Breakfast, Lunch, and Dinner slots with add/swap/remove, servings, repeats, and locks.
- [x] Week navigation is shared between the calendar and grocery views.
- [x] Grocery calculations derive only from the viewed week's scheduled slots, with no recipe cap.
- [x] Repeated recipes retain separate dated contributions while quantities consolidate and scale with each slot's servings.
- [x] Optional, unresolved, known-subtotal, missing-price, checkout, consumed-cost, and remainder semantics remain visible.
- [x] Grocery checks persist per week and never mutate pantry or ingredient quantities.
- [x] Discover, Library, Plan, and Grocery have responsive layouts and explicit empty/fallback states.
- [x] Regression tests cover discovery/undo, refresh persistence, week navigation, repeats, serving scaling, deletion, locking, migration, storage fallback, and backup round-trip.
- [x] Unknown recipe references and duplicate date/meal slots cannot enter through import; invalid persisted slots are quarantined with an exportable original recovery payload.
- [x] Persistence messaging follows the latest browser write and distinguishes temporary-memory imports from successfully persisted imports.
- [x] Recipe details transfer and contain keyboard focus, close with Escape, and restore focus to the opener.
- [x] Discovery resumes with unreviewed recipes and ends with explicit deferred/review-again actions instead of cycling invisibly.
- [x] The public prototype preview is intentionally enabled under issue #7; personal preferences, plans, and grocery checks remain browser-local and are not part of the deployment artifact.

## Issue #9 — tactile discovery deck acceptance report

- [x] Horizontal pointer gestures commit Interested to the right and Pass to the left only after a tested threshold; short, diagonal, and vertical movement cancels without changing personal data.
- [x] The top recipe visibly drags, rotates, shows directional feedback, sends off after commitment, and reveals two noninteractive preview cards without introducing external photography.
- [x] Interested, Pass, Save for later, and Not now buttons use the same persisted decision path; duplicate release/click events are locked to one decision.
- [x] Arrow Left and Arrow Right work when focus is in the deck, while interactive controls and dialogs retain their existing keyboard behavior.
- [x] Progress, action results, and cancellation feedback are exposed to assistive technology; reduced-motion users skip the send-off delay.
- [x] Undo, reload resumption, deferred-recipe revisit, details/source, searchable Library status, planning, and Grocery remain intact.
- [x] Review choices again creates a complete 25-recipe pass with truthful remaining counts and leaves every stored preference unchanged until the user makes a replacement choice.
- [x] The completion state retains Undo, moves keyboard focus to it after the final card exits, and restores both the final recipe and its prior preference.
- [x] Production builds were browser-checked at 1440px desktop and 390px touch-mobile sizes with no console errors or failed asset requests.
