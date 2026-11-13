# Pilot provenance and data-quality report

## Validated count

This branch contains **25 valid, distinct, attributable real recipes from 5 publishers**. All are `source-reviewed`; none is claimed as `kitchen-tested`. Source facts were checked on 2026-11-13. No publisher photography or article prose is stored. Ingredient lines are factual source metadata; methods are short original summaries with prominent links to the publisher.

The original five normalization cases remain. Expansion adds 20 non-soup recipes from Budget Bytes: chicken fajitas, pesto chicken, beef-cabbage stir-fry, cheeseburger pasta, black-bean quesadillas, Cajun chicken pasta, spinach-feta grilled cheese, banana-flax muffins, Greek chicken pasta salad, sesame tempeh bowls, beef burrito casserole, tuna salad, turkey burgers, tofu scramble, overnight oats, vegetable stir-fry, sesame chicken, pork chops, salmon patties, and avocado toast.

The stack now includes chicken, beef, pork, turkey, canned fish, tofu, tempeh, beans, vegetarian and vegan choices; breakfast, lunch, and dinner; and American, Mediterranean, Southwestern, and Asian-inspired meals. All twenty expansion records expose a publisher rating; review counts range from 1 to 514 and are stored rather than overstated.

## Approved policy implementation

- Source output and meal planning portions are separate. Twelve pancakes remain twelve pancakes; the planning default is four people at three pancakes each.
- Serving ranges remain ranges. White bean soup and Greek chicken pasta salad use a marked midpoint planning default that the user can override.
- Chosen ingredient branches are structured and visible; alternatives and quantities remain attached to the source line. Fresh kale from two recipes now consolidates correctly.
- Optional items are visibly excluded by default and can be included in the grocery list.
- Hypothetical package prices and usable yields are labeled development fixtures. Missing prices remain unknown.
- Two 410g chickpea cans are stored as purchase count and nominal net mass. The 480g drained planning quantity derives only from the documented 240g-per-can development assumption.
- Every recipe has a separate second-pass source-line count in `src/data/sourceReview.ts`.

## Remaining data-quality exceptions

- The 20-record expansion is intentionally concentrated at Budget Bytes. This produced meal diversity efficiently but should be balanced with more publishers in a later milestone.
- Low-review records are not presented as broadly proven: spinach-feta grilled cheese has 1 vote and smothered pork chops has 4. Their exact counts are visible in data.
- The overnight-oats record covers the publisher's labeled base recipe only; three variation groups remain outside the record.
- The quesadilla record preserves the linked taco-seasoning batch as nonquantified rather than silently importing another recipe.
- A few source measures cannot be safely converted without density or size assumptions: grape-tomato pint/mass, bunch herbs, chicken-thigh count, cup flour, shredded-cheese volume, and diced-onion volume. Each affected record either remains unresolved or carries an explicit approximate planning note.
- Combined source lines such as “pinch salt and pepper” remain one visibly flagged nonquantified requirement; they are not given false precision.
- Package prices are synthetic demonstration estimates dated 2026-11-13, not retailer quotes. Regional sizes, waste, pantry inventory, taxes, and substitutions are not modeled.
- Public reuse rights still need a separate legal/source-terms review. The repository must remain private and public deployment disabled.
- Kitchen testing is not required for private pilot use. Records remain `source-reviewed` and must never be described as `kitchen-tested` unless actually cooked.

## Legacy synthetic fixture review

All four v1 fixtures fail editorial ingredient/method completeness: orzo omits olive oil and parsley; mushroom toast omits finishing herbs; oats omit seeds; chocolate cake omits eggs, coffee, and flaky salt. They remain preserved and excluded from the pilot.
