# Recipe v2 to v3 migration and readiness report

This report is produced from the 25-recipe v2 snapshot through `adaptRecipeCatalogV2ToV3`. It records compatibility output, not new source research. The executable assertions live in `src/domain/recipeV3Migration.test.ts`.

## Aggregate result

| Result | Count |
|---|---:|
| Input v2 recipes | 25 |
| Successful deterministic migrations | 25 |
| Failed migrations | 0 |
| Preserved normalized requirements | 285 |
| Preserved distinct source lines | 282 |
| Preserved alternative branches | 9 |
| Preserved source ranges | 2 |
| Preserved source-package records | 1 |
| Preserved independent summary lines | 75 |
| Minimum-safe-import ready | 25 |
| Automatic-recommendation ready | 0 |
| Cooking-mode ready | 0 |

## Common compatibility outcome

Every migrated recipe carries forward identity, attribution, source yield, original ingredient text, stable requirement/source-line/ingredient/variant IDs, selected planning quantities, structured ranges/alternatives/packages, review notes, source-reviewed times, tags, and three independent method-summary lines.

Every record explicitly initializes these unavailable groups as unknown: publisher nutrition/serving size, active/passive effort split, equipment, structured steps, and storage/leftover suitability. The source serving count is retained only where the v2 publisher yield is a fixed meal-serving amount; a yield range remains a range and countable output remains discrete output.

All records share these initial readiness blockers:

- scaling policy needs recipe review;
- meal-portion/source-serving guidance is missing;
- active time is unknown;
- storage/leftover suitability is unknown;
- structured steps and their review are missing;
- safety and equipment review are missing;
- factual-metadata rights disposition remains `review-needed`.

The blockers do not prevent catalog browsing or manual planning. They prevent unsupported automatic recommendation and cooking-mode claims.

## Per-recipe result

`S/R` is preserved distinct source lines / normalized requirements. All rows migrated successfully and have gate result `minimum: yes / recommendation: no / cooking: no`.

| Recipe | S/R | Preserved special structure | Remaining source/review exception |
|---|---:|---|---|
| Smoky Black Bean Soup | 10/10 | 1 alternative | Salt remains nonquantified. |
| Simply Perfect Pancakes | 8/8 | Discrete output; 2 alternatives, 1 range | Milk range and selected alternatives remain explicit. |
| White Bean Soup | 16/16 | 3 alternatives | Fresh/dried herb and greens branches remain distinct. |
| Best Lentil Soup | 16/16 | 2 alternatives, 1 range | Lemon range and greens branch remain explicit. |
| Chickpea, Coriander & Lime Soup | 12/12 | 1 source package | Drained yield remains an explicitly estimated v2 assumption. |
| Sheet Pan Chicken Fajitas | 16/16 | 1 alternative | Cilantro bunch remains nonquantified. |
| Creamy Pesto Chicken | 8/8 | — | Grape-tomato pint remains unresolved. |
| Beef and Cabbage Stir Fry | 14/15 | Shared source-line identity | Compound salt/pepper line remains two requirements. |
| One Pot Cheeseburger Pasta | 10/10 | — | Approximate flour/cheddar planning values remain estimates. |
| Hearty Black Bean Quesadillas | 8/8 | Discrete output | Taco seasoning remains a nonquantified needs-review requirement, not an invented dependency. |
| One Pot Creamy Cajun Chicken Pasta | 17/17 | — | Approximate butter conversion remains identified. |
| Spinach Feta Grilled Cheese | 8/9 | Shared source-line identity | Compound seasoning line remains two requirements. |
| Banana Flax Muffins | 10/10 | Discrete output | Approximate flour conversion remains identified; batch scaling unreviewed. |
| Greek Chicken Pasta Salad | 14/14 | Yield range | Chicken weight assumption and unresolved tomato mass remain visible. |
| Sesame Tempeh Bowls | 13/13 | — | No current line exception; v3 enrichment remains unknown. |
| Beef Burrito Casserole | 11/11 | — | Salt pinch remains nonquantified. |
| Classic Tuna Salad | 8/8 | — | No current line exception; suitability remains unknown. |
| Bacon Ranch Turkey Burgers | 9/9 | Discrete output | Whole-item scaling remains unreviewed. |
| Southwest Tofu Scramble | 10/10 | — | No current line exception; suitability remains unknown. |
| Overnight Oats Base Recipe | 6/6 | Discrete jar output | Variations remain outside the record; passive time is unknown. |
| Easy Vegetable Stir Fry | 15/15 | — | No current line exception; active effort remains unknown. |
| Easy Sesame Chicken | 16/17 | Shared source-line identity | Compound salt/pepper line remains two requirements. |
| Smothered Pork Chops | 12/12 | — | Approximate flour/butter conversions remain identified. |
| Salmon Patties | 8/8 | Discrete output | Approximate onion fraction remains identified; scaling unreviewed. |
| Avocado Toast | 7/7 | Discrete output | Storage suitability remains unknown. |

## Interpretation

The migration meets the minimum-safe-import gate because it preserves uncertainty instead of filling gaps. It intentionally does not make any current recipe recommendation-ready or cooking-mode-ready. Reaching those gates requires targeted source capture and later editorial review described in `V3_RECIPE_AUDIT.md`; this milestone performs neither.
