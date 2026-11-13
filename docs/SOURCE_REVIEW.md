# Separate source-to-record review

On 2026-11-13, a second pass compared every stored record with the visible ingredient list on its linked publisher page. The executable manifest is `src/data/sourceReview.ts`; its regression test requires one review entry per recipe and equal visible-source/record line counts.

## Result

- Recipes reviewed: **25 of 25**
- Visible source ingredient lines represented: **282 of 282**
- Missing lines: **0**
- Records with a documented normalization exception: **15**
- Records without an exception: **10**

Exceptions do not hide source facts. They cover structured alternatives or ranges, linked sub-recipes intentionally left nonquantified, base-recipe-only scope, combined seasoning lines, nonstandard bunch/pint measures, and explicit development-only density/usable-yield assumptions. Full exception text is stored beside each slug in the executable manifest and summarized in `DATA_QUALITY.md`.
