export const legacyFixtureKnownIssues = [
  { slug: 'lemon-herb-orzo', missingMethodIngredients: ['olive oil', 'parsley'], disposition: 'Preserved as schema-v1 synthetic data; excluded from the real pilot.' },
  { slug: 'miso-mushroom-toast', missingMethodIngredients: ['herbs'], disposition: 'Generic finishing herb is not represented or quantified.' },
  { slug: 'cardamom-pear-oats', missingMethodIngredients: ['seeds'], disposition: 'Unspecified topping is mentioned only in the method.' },
  { slug: 'olive-oil-chocolate-cake', missingMethodIngredients: ['eggs', 'coffee', 'flaky salt'], disposition: 'Multiple method ingredients are absent; record is not migrated silently.' },
] as const
