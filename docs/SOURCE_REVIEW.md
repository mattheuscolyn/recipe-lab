# Separate source-to-record review

On 2026-11-13, a manual second pass compared every stored record with the visible ingredient list on its linked publisher page. The executable manifest is `src/data/sourceReview.ts`. Its automated regression test establishes internal consistency: one review entry per recipe, the declared normalized-requirement count, and one or more normalized requirements for every manually attested source-line identity. It does not independently prove the publisher facts.

## Result

- Recipes reviewed: **25 of 25**
- Manually attested source ingredient lines represented: **282 of 282**
- Normalized grocery requirements: **285**
- Missing lines in the manual review: **0**
- Records with a documented normalization exception: **12**
- Records without an exception: **13**

Three compound salt-and-pepper lines each map to two grocery requirements sharing one source-line identity, which is why normalized requirements exceed source lines. Remaining exceptions do not hide source facts. They cover structured alternatives or ranges, linked sub-recipes intentionally left nonquantified, base-recipe-only scope, nonstandard bunch/pint measures, and explicit development-only density/usable-yield assumptions. Full exception text is stored beside each slug in the executable manifest and summarized in `DATA_QUALITY.md`.
