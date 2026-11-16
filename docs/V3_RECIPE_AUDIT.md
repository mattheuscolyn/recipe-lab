# Recipe v3 readiness audit — current 25-recipe catalog

This audit is a snapshot of `main` at `2d50a83`. It does not assert facts that were not collected. The 25 records remain source-reviewed, not kitchen-tested or cleared for unrestricted republication.

## Catalog totals

| Current evidence | Actual count |
|---|---:|
| Valid attributable recipes | 25 |
| Publishers | 5 (Budget Bytes 21; four others 1 each) |
| Categories | 16 Dinner, 5 Breakfast, 4 Lunch |
| Attested publisher ingredient lines | 282 |
| Normalized requirements | 285 |
| Flexible/fixed meal-serving outputs | 18 |
| Countable outputs | 7 |
| Source yield ranges | 2 |
| Records with a planning assumption | 9 |
| Requirements marked `needs-review` | 35 |
| Nonquantified requirements | 19 |
| Optional requirements | 12 |
| Structured alternative branches | 9 |
| Requirement source ranges | 2 |
| Source-package usable-yield records | 1 |
| Independent method-summary lines | 75 (3 per recipe) |
| Records `complete-with-exception` in the source audit | 12 |
| Kitchen-tested records | 0 |

## Field readiness across the collection

| V3 field group | Present now | Absent/uncertain | Collection action |
|---|---|---|---|
| Stable identity, attribution, URL, review date | 25/25 | Rights disposition is documented globally, not per revision. | Migrate IDs; add conservative per-record rights state without source revisit. |
| Publisher source yield | 25/25 | Serving-size basis is not consistently structured. | Preserve exact labels; collect serving basis on source revisit when published. |
| Output class | 25/25 can be adapted (18 meal-serving, 7 countable) | `flexible-batch` vs `fixed-portions`, scaling policy and integer constraints need review. | Rule-seed, then editorial review. |
| Ingredient facts and normalized requirements | 282/282 source lines attested; 285 requirements | Ingredient component/group headings were not modeled. | Preserve all facts; collect source groups on revisit rather than infer them. |
| Ranges, alternatives, packages | Selected cases preserved | Not guaranteed as a systematic first-visit capture beyond what was visible. | Make these mandatory ingestion evidence when present. |
| Cross-recipe subrecipes | Quesadilla taco seasoning is visibly nonquantified | No versioned dependency entity. | Capture dependency URL/fact on revisit; later resolve to a stable recipe revision. |
| Nutrition | 0/25 structured | Calories, serving basis, inclusions and macros are genuinely unknown in the catalog. | Collect publisher-reported panel when present; unknown remains usable. |
| Prep/cook/total time | 25/25 | Active vs passive time and attention pattern are not separated; overnight oats demonstrates the ambiguity. | Capture publisher time fields; later derive effort with provenance. |
| Equipment | 0/25 structured | Method summaries imply some tools but inference is unaudited. | Collect explicit equipment on source visit; review later. |
| Meal role | 25/25 primary category | Secondary role, lunch prepare-ahead feasibility and dinner adequacy are unreviewed. | Seed primary role; editorial enrichment later. |
| Structured cooking steps | 0/25 | Three-line independent summaries are not ingredient-linked Cook mode instructions. | Retain summaries; source-evidence revisit plus independent step authoring required. |
| Storage/leftover/freezing suitability | 0/25 structured | Tags such as `Meal prep` or `Freezer-friendly` are hints, not reviewed duration evidence. | Capture publisher claims; later apply reviewed storage policy. |
| Readiness gates | 25/25 minimum-safe under current evidence | 0/25 v3 recommendation-ready; 0/25 cooking-mode-ready until output/suitability and step reviews occur. | Use feature-specific blockers, not invented defaults. |

## Audit matrix

Legend:

- `S/R` = attested source lines / normalized requirements.
- `NR/NQ/O/A` = needs-review / nonquantified / optional / alternative counts.
- `FSV baseline` = on the next source visit, capture nutrition+basis if reported, explicit equipment, active/passive time, ingredient groups, serving-size basis, storage/make-ahead claims and restricted method-stage evidence.
- `Later` = editorial/rule-derived work that should not require another source visit: scaling policy, adequacy guidance, meal roles, leftover quality, effort label, independently written structured steps and readiness review.

| Recipe | Role / output | S/R | NR/NQ/O/A | Existing exception or uncertainty | Additional first-source-visit target beyond baseline | Later enrichment focus |
|---|---|---:|---:|---|---|---|
| Smoky Black Bean Soup | Dinner / flexible, 4 servings | 10/10 | 1/1/1/1 | Salt to taste; paprika/chipotle branch. | Confirm published serving-size statement and any freezer/reheat claim. | Light-meal adequacy, soup leftover quality, batch scaling. |
| Simply Perfect Pancakes | Breakfast / 12 pancakes | 8/8 | 3/1/1/2 | Milk range; butter/oil and sugar/malt branches. | Capture items per publisher serving, holding/freezing statement and nutrition basis. | Integer pancake allocation, griddle equipment, Cook mode step links. |
| White Bean Soup | Dinner / flexible range 4–6 | 16/16 | 3/2/1/3 | Fresh/dried herbs and kale/spinach branches. | Capture serving-size and storage/freezing claims. | Range scaling, adequacy, leftover policy. |
| Best Lentil Soup | Dinner / flexible, 4 large servings | 16/16 | 3/1/0/2 | Kale/collard branch and lemon range. | Capture meaning of “large serving,” nutrition basis and storage claims. | Dinner adequacy, batch/leftover scaling. |
| Chickpea, Coriander & Lime Soup | Dinner / flexible, 4 servings | 12/12 | 1/0/0/0 | Publisher gives net can size, not drained mass; current usable yield is explicitly hypothetical. | Reconfirm whether drained yield or serving size is published; retain absence if not. | Keep yield assumption uncertain; soup suitability review. |
| Sheet Pan Chicken Fajitas | Dinner / 4 servings, 2 fajitas each | 16/16 | 3/1/2/1 | Cilantro bunch nonquantified; onion-size branch. | Capture serving/item relationship, equipment capacity and storage/reheat claim. | Decide flexible vs fixed output; integer tortilla allocation. |
| Creamy Pesto Chicken | Dinner / flexible, 4 servings | 8/8 | 1/1/0/0 | Grape-tomato pint is unresolved. | Capture side inclusion, serving basis and storage/reheat claim. | Adequacy and leftover quality; no invented tomato conversion. |
| Beef and Cabbage Stir Fry | Dinner / flexible, 4 servings | 14/15 | 2/2/2/0 | Compound salt/pepper line maps to two requirements. | Capture serving-size, rice/side inclusion and storage claim. | Short-life leftover review, active-attention classification. |
| One Pot Cheeseburger Pasta | Dinner / flexible, 4 servings | 10/10 | 2/0/1/0 | Approximate flour and shredded-cheddar conversions. | Capture serving-size and refrigeration/reheat guidance. | Batch scaling and leftover quality. |
| Hearty Black Bean Quesadillas | Lunch / 10 quesadillas | 8/8 | 3/2/0/0 | Diced onion unresolved; linked taco seasoning not expanded. | Capture linked dependency URL/amount, explicit freezing instructions, items per serving. | Versioned subrecipe dependency and integer batch policy. |
| One Pot Creamy Cajun Chicken Pasta | Dinner / flexible, 4 servings | 17/17 | 1/0/0/0 | Butter tablespoon uses approximate mass. | Capture serving-size and storage/reheat guidance. | Batch scaling, leftover quality, active effort. |
| Spinach Feta Grilled Cheese | Lunch / 2 servings | 8/9 | 2/2/1/0 | Compound seasoning split; low review count (1). | Capture sandwich count per serving and whether preparation-ahead is supported. | Default lunch infeasible unless prepared ahead; quality-after-storage review. |
| Banana Flax Muffins | Breakfast / 6 muffins | 10/10 | 1/0/1/0 | Cup flour uses approximate mass. | Capture muffins per serving, equipment size and storage/freezing claim. | Integer output, allowed batch multipliers, prep-ahead breakfast. |
| Greek Chicken Pasta Salad | Lunch / flexible range 4–6 | 14/14 | 2/2/0/0 | Chicken-thigh weight assumption; grape-tomato mass unresolved. | Capture serving-size, chill/storage statement and ingredient groups. | Prepared-lunch suitability and range scaling. |
| Sesame Tempeh Bowls | Dinner / flexible, 4 servings | 13/13 | 0/0/0/0 | No current line exception. | Capture bowl components, serving basis and storage/reheat claims. | Component allocations and leftover-quality review. |
| Beef Burrito Casserole | Dinner / flexible, 6 servings | 11/11 | 1/1/0/0 | Salt pinch nonquantified. | Capture casserole serving size, freezing/storage and equipment capacity. | Strong batch/leftover candidate; scaling review. |
| Classic Tuna Salad | Lunch / flexible, 4 servings | 8/8 | 0/0/0/0 | No current line exception. | Capture chilling/storage guidance and serving context. | Prepared-lunch suitability; conservative storage rule. |
| Bacon Ranch Turkey Burgers | Dinner / 4 burgers | 9/9 | 0/0/1/0 | Countable burger output. | Capture patty/burger serving definition, equipment and storage claim. | Integer output and leftover-quality review. |
| Southwest Tofu Scramble | Breakfast / flexible, 3 servings | 10/10 | 0/0/1/0 | No current line exception. | Capture serving-size and storage/reheat statement. | Breakfast adequacy and leftover review. |
| Overnight Oats Base Recipe | Breakfast / 1 jar | 6/6 | 1/1/0/0 | Base only; three source variation groups excluded. Total time includes overnight wait. | Capture nutrition per jar, refrigeration window, variation-group facts and passive time. | One-jar integer output, prep task timing, optional variations policy. |
| Easy Vegetable Stir Fry | Dinner / flexible, 4 servings | 15/15 | 0/0/0/0 | No current line exception. | Capture serving/side basis and storage guidance. | Active-attention effort and leftover-quality review. |
| Easy Sesame Chicken | Dinner / flexible, 4 servings | 16/17 | 2/2/0/0 | Compound salt/pepper split. | Capture rice inclusion in nutrition/serving basis and storage/reheat statement. | Component grouping, dinner adequacy, leftover policy. |
| Smothered Pork Chops | Dinner / 4 chops/servings | 12/12 | 2/0/0/0 | Approximate flour and butter masses; low review count (4). | Capture whole-chop serving definition, equipment and storage/reheat claim. | Fixed/whole-item batch policy and gravy leftover quality. |
| Salmon Patties | Dinner / 6 patties | 8/8 | 1/0/0/0 | Diced onion volume converted to explicit approximate fraction. | Capture patties per serving, storage/freezing and pan capacity. | Integer patty allocation and partial-batch policy. |
| Avocado Toast | Breakfast / 2 slices | 7/7 | 0/0/0/0 | No current line exception. | Capture slice serving basis; verify whether any storage claim exists. | Mark poor make-ahead only after review; integer slice allocation. |

## Known cross-catalog cautions

- Publisher diversity remains skewed: 21 of 25 records are Budget Bytes.
- Ratings/review counts are source facts, not quality guarantees. The smallest counts remain visible.
- The current package-price fixtures are hypothetical and are not v3 nutrition, cost or retailer evidence.
- No current method summary should be promoted mechanically to `StructuredStep`.
- Current tags (`Meal prep`, `Freezer-friendly`, `No cook`) can seed review queues but cannot alone establish a storage duration or optimizer hard constraint.
- The 35 needs-review and 19 nonquantified requirements remain usable because uncertainty is visible; v3 must not “complete” them by fabrication.

## Gate result for all 25

| Gate | Result |
|---|---|
| Minimum safe import | **Pass via compatibility adapter**, preserving all v2 uncertainty and evidence. |
| Recommendation-ready | **Not yet** for automated batch/leftover planning; output scaling and suitability need review. Manual planning remains valid. |
| Cooking-mode-ready | **No**; structured ingredient-linked steps, equipment and rights/safety review are absent. |
