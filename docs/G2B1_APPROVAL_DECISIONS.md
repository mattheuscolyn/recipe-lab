# G2B1 recipe approval decision packet

Scope: [Issue #28](https://github.com/mattheuscolyn/recipe-lab/issues/28), advancing the [Generate Week roadmap](https://github.com/mattheuscolyn/recipe-lab/issues/21).

This packet turns the seven G2A reviews into decisions a named, authorized reviewer can actually close. It does **not** contain an approval. The production manifest at `src/data/recipeApprovalManifestV3.ts` is empty, so the production readiness report remains seven awaiting decisions and zero recommendation-ready.

## How approvals are separated

| Authority | May decide | Must not decide |
|---|---|---|
| Owner / editorial | meal adequacy, portion interpretation, planning effort, subjective leftover quality, appeal/exclusion | legal rights or unsupported safety windows |
| Source facts | normalized ingredient facts and original-batch scaling against the exact captured revision | household taste or legal permission |
| Food safety | recipe/version-specific prepare-ahead, storage duration, freeze/thaw, and reheating policy with evidence | household appeal or metadata rights |
| Factual-metadata rights | approve or restrict factual-metadata use for the named publisher and scope | portions, safety, or household preferences |

Every record requires a stable reviewer ID, non-generic display name, authority basis, authorization reference, timestamp, durable approval evidence, exact base recipe revision, and a fingerprint of the value reviewed. A valid bundle creates a new revision. Stale, conflicting, generic, unsupported, or wrong-authority records are rejected.

Household preferences remain browser-local personal data. They are not public recipe facts and are not committed in approval records. “Sounds appealing,” “disliked,” or “exclude” should be confirmed through the existing preference model before automatic selection.

## Common decision options

- **Approve current captured value:** only when the reviewer has authority and the exact fingerprint/evidence supports it.
- **Block/exclude:** keep the decision closed as blocked; the recipe remains ineligible.
- **Request correction:** create a new source-review revision first, then review that new exact revision. Do not approve stale data.
- **Defer:** leave the G2A revision provisional. No eligibility change.

Metadata-rights approval is always limited to factual metadata. Publisher method prose and images remain excluded.

## Recipe decisions

### Easy Vegetable Stir Fry — shortest technical path to a fresh-use candidate

Source: <https://www.budgetbytes.com/easy-vegetable-stir-fry/>  
Base revision: `revision-10000000-0000-4000-8000-000000000016-g2a-1`  
Evidence: `evidence-easy-vegetable-stir-fry-g2a-source`, `evidence-easy-vegetable-stir-fry-g2a-editorial`

| Decision | Authority | Recommended owner/reviewer options | Automatic-planning effect |
|---|---|---|---|
| Fixed captured ingredient set | Source facts | Approve exactly the listed vegetables; or request normalized substitution branches | Approval closes ingredient normalization. Broad publisher substitution suggestions remain outside the fixed revision. |
| One 1.5-cup source serving as one dinner portion | Owner/editorial | Approve as an adequate meal; require a modeled side/protein; or exclude as dinner | Required for fresh dinner recommendation. The 209 kcal publisher estimate is context, not a calorie gate. |
| 25 active/25 elapsed minutes, continuous attention | Owner/editorial | Approve for planning; correct; or block | Required for cooking-window feasibility. |
| Factual-metadata use | Factual-metadata rights | Approve factual metadata only; restrict; or defer | Required for any automatic recommendation. |
| Storage/reheating | Food safety | Obtain recipe-specific evidence before approving | Not required for a fresh dinner; refrigerated/frozen allocations remain blocked. |
| Household appeal | Owner, browser-local | Mark interested/saved/passed after confirmation | Do not infer preference from source stars. |

**Shortest path:** three production records against this exact revision: source-facts approval for the fixed ingredient set, owner approval for portion and effort, and factual-metadata-rights approval. Original-batch scaling is already finalized. This creates a fresh-use-only revision; it does not approve leftovers.

### Overnight Oats Base Recipe — useful breakfast, stored-route decision still needed

Source: <https://www.budgetbytes.com/overnight-oats-base-recipe-plus-variations/>  
Base revision: `revision-10000000-0000-4000-8000-000000000015-g2a-1`  
Evidence: `evidence-overnight-oats-base-recipe-g2a-source`, `evidence-overnight-oats-base-recipe-g2a-editorial`

| Decision | Authority | Options | Effect |
|---|---|---|---|
| Nonquantified pinch of salt and fixed base ingredients | Source facts | Approve current nonquantified representation; correct; or block | Required for grocery/ingredient approval. Variations remain outside this revision. |
| One 8 oz jar as one breakfast | Owner/editorial | Approve adequacy; require companion food; or block | Required for breakfast recommendation. |
| 5 active + 480 passive minutes | Owner/editorial | Approve overnight planning interpretation; correct; or block | Required for cooking-window feasibility. |
| Factual-metadata use | Factual-metadata rights | Approve factual metadata only; restrict; or defer | Required for recommendation. |
| Maximum refrigerator window | Food safety | Add version-specific duration evidence; otherwise defer | Required for multi-day prep/allocation. “Overnight” does not establish a multi-day maximum. |

### Banana Flax Muffins — blocked on conversion and optional-branch grocery handling

Source: <https://www.budgetbytes.com/banana-flax-muffins/>  
Base revision: `revision-10000000-0000-4000-8000-000000000008-g2a-1`  
Evidence: `evidence-banana-flax-muffins-g2a-source`, `evidence-banana-flax-muffins-g2a-editorial`

| Decision | Authority | Options | Effect |
|---|---|---|---|
| 120 g flour conversion | Source facts | Substantiate and approve; replace with supported quantity; or block | Required for shopping-complete ingredient normalization. |
| Optional walnuts | Source facts + future grocery integration | Integrate explicit include/exclude branch downstream; do not generic-approve now | Current approval application rejects unresolved optional branches. |
| Two muffins as one breakfast | Owner/editorial | Approve adequacy; choose one muffin; add companion food; or block | Required for breakfast portions. Publisher nutrition is per serving and does not prove meal adequacy. |
| 15 active + 20 passive minutes | Owner/editorial | Approve; correct; or block | Required for effort planning. |
| Rights and storage duration | Rights / food safety | Review separately | Rights blocks all use; unknown duration blocks stored allocations. |

### Greek Chicken Pasta Salad — strong prep evidence, multiple use-specific decisions

Source: <https://www.budgetbytes.com/greek-chicken-pasta-salad/>  
Base revision: `revision-10000000-0000-4000-8000-000000000009-g2a-1`  
Evidence: `evidence-greek-chicken-pasta-salad-g2a-source`, `evidence-greek-chicken-pasta-salad-g2a-editorial`

| Decision | Authority | Options | Effect |
|---|---|---|---|
| Two-thigh planning weight and tomato representation | Source facts | Substantiate current normalization; correct; or block | Required for ingredient/grocery approval. |
| Select 4 meal-sized or 6 side portions per batch | Owner/editorial, citing source range | Record exact batch selection policy | G1 still requires an exact source-yield selection per batch. |
| 60 active minutes and meal adequacy | Owner/editorial | Approve/correct/block | Required for fresh recommendation and cooking-window fit. |
| 72-hour refrigerated window | Food safety/source review | Retain only with the captured 3–4 day claim; revise if policy requires | Supports a maximum window, but categorical leftover quality remains unknown. |
| Office odor and practicality | Owner/editorial service assessment | Approve with claim-specific service record; or block office use | Missing odor remains a G1 office-lunch blocker. |
| Factual-metadata use | Factual-metadata rights | Approve/restrict/defer | Required for all recommendation routes. |

### Southwest Tofu Scramble — optional turmeric and unknown storage

Source: <https://www.budgetbytes.com/southwest-tofu-scramble/>  
Base revision: `revision-10000000-0000-4000-8000-000000000014-g2a-1`

- Source facts: resolve the optional turmeric branch before claiming shopping completeness.
- Owner/editorial: decide whether one cup is an adequate breakfast and whether 15 continuous active minutes is acceptable.
- Rights: approve/restrict factual metadata separately.
- Food safety: no recipe-specific storage or reheating policy is approved; stored use remains blocked.

### Beef and Cabbage Stir Fry — optional garnish and nonquantified seasoning remain open

Source: <https://www.budgetbytes.com/beef-cabbage-stir-fry/>  
Base revision: `revision-10000000-0000-4000-8000-000000000003-g2a-1`

- Source facts: resolve optional sesame/sriracha branches and nonquantified salt/pepper before shopping-complete approval.
- Owner/editorial: decide whether the publisher serving is adequate as dinner and approve/correct 30 continuous active minutes.
- Rights: approve/restrict factual metadata separately.
- Food safety: storage, quality, and reheating are unknown; only fresh use can be considered after universal approvals.

### Sheet Pan Chicken Fajitas — private preference confirmation required

Source: <https://www.budgetbytes.com/sheet-pan-chicken-fajitas/>  
Base revision: `revision-10000000-0000-4000-8000-000000000001-g2a-1`

- **Household preference:** Request confirmation through browser-local preferences before prioritizing this recipe. Do not encode the result as a public recipe fact or infer it from source ratings.
- Source facts/grocery: optional sour cream/cilantro and alternative branches are not selection-integrated downstream, so ingredient approval is rejected for now.
- Owner/editorial: two fajitas per serving and 20 active/55 elapsed minutes remain provisional.
- Rights: factual-metadata approval remains required.
- Food safety: the source has reheating methods but no captured maximum storage duration or categorical leftover-quality rating. Stored use remains blocked.

## Owner action order

1. Confirm whether Easy Vegetable Stir Fry is an acceptable, adequate fresh dinner with the fixed captured ingredients. If not, do not approve it merely because it is technically shortest.
2. Name the source-facts, owner/editorial, and factual-metadata-rights reviewers and their authority references.
3. Record decisions against the exact G2A revision fingerprints. Applying the bundle creates a new immutable revision.
4. Keep storage and office decisions deferred unless a food-safety or service reviewer supplies specific evidence.
5. Review each candidate's browser-local preference status before prioritization; never put a personal taste decision in the public approval manifest.

No production approval record exists in this PR. Synthetic records demonstrate the complete path in tests but are rejected by the production readiness report.
