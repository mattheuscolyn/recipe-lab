# Pilot provenance and data-quality report

## Validated count

This branch contains **5 valid, distinct, attributable real recipes from 5 publishers**. All are `source-reviewed`; none is claimed as `kitchen-tested`. Source facts were checked on 2026-11-13. No publisher photography or article prose is stored. Ingredient lines are factual source data; methods are short original summaries with prominent links to the publisher.

| Recipe | Publisher | Quality case |
| --- | --- | --- |
| Simply Perfect Pancakes | King Arthur Baking | grams and US volume; table salt; optional unquantified berries; ingredient alternatives |
| Smoky Black Bean Soup | Budget Bytes | 15-ounce packages; dried herb; optional jalapeño; salt to taste |
| White Bean Soup | Love and Lemons | fresh/dried herb alternatives; sea salt; optional serving item; 4–6 serving range |
| Best Lentil Soup | Cookie and Kate | 28-ounce can; approximate lemon range; dried thyme; to-taste pepper |
| Chickpea, Coriander & Lime Soup | Good Food | grams/liters; two 410g cans; fresh versus ground coriander; cloves |

Direct URLs and selection rationales live on each record. Ratings and review counts are present only where the source page exposed them at review time.

## Unresolved decisions and data gaps

- **20 recipes remain blocked by editorial collection/review.** This is intentional: the issue prioritizes normalization correctness before scale and permits an honest count plus blocked report. Records must not be invented to reach 25.
- Love and Lemons states 4–6 servings. Grocery scaling currently uses the midpoint (5) while preserving the original label.
- Ingredient alternatives choose an explicit pilot branch (for example butter, granulated sugar, fresh thyme) and carry `needs-review` notes. The UI does not yet let a user choose another branch.
- Package prices are synthetic demonstration estimates dated 2026-11-13, not live retailer quotes. Items without a compatible fixture remain “unknown,” never `$0`.
- Package usable yields can be approximate (ten cloves per garlic head). Regional package sizes and waste are not modeled.
- Public reuse rights have not received legal review. Publisher pages were publicly accessible, but that is not a license for public republication. Keep the repository private and link users to originals.
- The five recipes need kitchen testing before any cooking-accuracy claim or public release.

## Legacy synthetic fixture review

All four v1 fixtures fail editorial ingredient/method completeness: orzo omits olive oil and parsley; mushroom toast omits finishing herbs; oats omit seeds; chocolate cake omits eggs, coffee, and flaky salt. They remain preserved and excluded from the pilot.

## Expansion gate

Before collecting the remaining 20, approve the range/alternative policies above, define allowed publisher/source terms, and require a second-person ingredient-completeness review. Each new record must pass the same import and grocery tests.
