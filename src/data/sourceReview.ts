export type SourceReviewEntry = {
  slug: string
  sourceIngredientLines: number
  recordRequirementLines: number
  status: 'complete' | 'complete-with-exception'
  exception: string | null
}

// Separate second-pass comparison against the publisher pages on 2026-11-13.
// Counts follow visible source ingredient lines, not inferred pantry items.
export const sourceReviewReport: SourceReviewEntry[] = [
  { slug:'smoky-black-bean-soup',sourceIngredientLines:10,recordRequirementLines:10,status:'complete',exception:null },
  { slug:'simply-perfect-pancakes',sourceIngredientLines:8,recordRequirementLines:8,status:'complete',exception:'Milk range and butter/sugar alternatives are preserved structurally; the selected planning branches are explicit.' },
  { slug:'white-bean-soup',sourceIngredientLines:16,recordRequirementLines:16,status:'complete',exception:'Fresh herbs and kale are the selected branches; dried herbs and spinach remain structured alternatives.' },
  { slug:'best-lentil-soup',sourceIngredientLines:16,recordRequirementLines:16,status:'complete',exception:'Kale is the selected branch and collards remain an alternative; lemon range is preserved.' },
  { slug:'chickpea-coriander-lime-soup',sourceIngredientLines:12,recordRequirementLines:12,status:'complete-with-exception',exception:'The source supplies two 410g net cans but no drained mass; 240g usable per can is explicitly hypothetical.' },
  { slug:'sheet-pan-chicken-fajitas',sourceIngredientLines:16,recordRequirementLines:16,status:'complete-with-exception',exception:'Optional cilantro bunch size is nonquantified; both onion-size branches are preserved.' },
  { slug:'creamy-pesto-chicken',sourceIngredientLines:8,recordRequirementLines:8,status:'complete-with-exception',exception:'The source pint of grape tomatoes is preserved without inventing an item count.' },
  { slug:'beef-and-cabbage-stir-fry',sourceIngredientLines:14,recordRequirementLines:14,status:'complete-with-exception',exception:'The combined salt-and-pepper source line remains one nonquantified requirement.' },
  { slug:'one-pot-cheeseburger-pasta',sourceIngredientLines:10,recordRequirementLines:10,status:'complete-with-exception',exception:'Flour and shredded-cheddar planning conversions are explicitly approximate.' },
  { slug:'hearty-black-bean-quesadillas',sourceIngredientLines:8,recordRequirementLines:8,status:'complete-with-exception',exception:'The linked taco-seasoning sub-recipe is not expanded and remains nonquantified.' },
  { slug:'one-pot-creamy-cajun-chicken-pasta',sourceIngredientLines:17,recordRequirementLines:17,status:'complete-with-exception',exception:'Tablespoon butter is represented by an explicitly approximate gram value.' },
  { slug:'spinach-feta-grilled-cheese',sourceIngredientLines:8,recordRequirementLines:8,status:'complete-with-exception',exception:'The combined salt-and-pepper source line remains one nonquantified requirement.' },
  { slug:'banana-flax-muffins',sourceIngredientLines:10,recordRequirementLines:10,status:'complete-with-exception',exception:'Cup flour is represented by an explicitly approximate gram value.' },
  { slug:'greek-chicken-pasta-salad',sourceIngredientLines:14,recordRequirementLines:14,status:'complete-with-exception',exception:'Two chicken thighs use an explicit planning weight assumption; grape-tomato mass is not converted to count.' },
  { slug:'sesame-tempeh-bowls',sourceIngredientLines:13,recordRequirementLines:13,status:'complete',exception:null },
  { slug:'beef-burrito-casserole',sourceIngredientLines:11,recordRequirementLines:11,status:'complete-with-exception',exception:'A pinch of salt remains nonquantified.' },
  { slug:'classic-tuna-salad',sourceIngredientLines:8,recordRequirementLines:8,status:'complete',exception:null },
  { slug:'bacon-ranch-turkey-burgers',sourceIngredientLines:9,recordRequirementLines:9,status:'complete',exception:null },
  { slug:'southwest-tofu-scramble',sourceIngredientLines:10,recordRequirementLines:10,status:'complete',exception:null },
  { slug:'overnight-oats-base-recipe',sourceIngredientLines:6,recordRequirementLines:6,status:'complete-with-exception',exception:'This record covers the labeled base recipe only; three optional variation groups remain outside the record.' },
  { slug:'easy-vegetable-stir-fry',sourceIngredientLines:15,recordRequirementLines:15,status:'complete',exception:null },
  { slug:'easy-sesame-chicken',sourceIngredientLines:16,recordRequirementLines:16,status:'complete-with-exception',exception:'The combined salt-and-pepper source line remains one nonquantified requirement.' },
  { slug:'smothered-pork-chops',sourceIngredientLines:12,recordRequirementLines:12,status:'complete-with-exception',exception:'Cup flour and tablespoon butter use explicitly approximate planning masses.' },
  { slug:'salmon-patties',sourceIngredientLines:8,recordRequirementLines:8,status:'complete-with-exception',exception:'Quarter-cup diced onion uses an explicit approximate item fraction.' },
  { slug:'avocado-toast',sourceIngredientLines:7,recordRequirementLines:7,status:'complete',exception:null },
]
