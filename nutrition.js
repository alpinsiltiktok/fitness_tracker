const AKG_PROFILE_LABEL = 'AKG laki-laki usia 19–29 tahun';
const NUTRIENTS = [
  { key: 'calories', label: 'Energi', unit: 'kcal', reference: 2650, group: 'Makro' },
  { key: 'protein', label: 'Protein', unit: 'g', reference: 65, group: 'Makro' },
  { key: 'carbs', label: 'Karbohidrat', unit: 'g', reference: 430, group: 'Makro' },
  { key: 'fat', label: 'Lemak', unit: 'g', reference: 75, group: 'Makro' },
  { key: 'fiberG', label: 'Serat', unit: 'g', reference: 37, group: 'Lainnya' },
  { key: 'sugarG', label: 'Gula', unit: 'g', reference: 50, group: 'Lainnya', limit: true },
  { key: 'sodiumMg', label: 'Natrium', unit: 'mg', reference: 1500, group: 'Mineral' },
  { key: 'vitaminAMcg', label: 'Vitamin A', unit: 'mcg', reference: 650, group: 'Vitamin' },
  { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', reference: 15, group: 'Vitamin' },
  { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg', reference: 15, group: 'Vitamin' },
  { key: 'vitaminKMcg', label: 'Vitamin K', unit: 'mcg', reference: 65, group: 'Vitamin' },
  { key: 'vitaminB1Mg', label: 'Vitamin B1', unit: 'mg', reference: 1.2, group: 'Vitamin' },
  { key: 'vitaminB2Mg', label: 'Vitamin B2', unit: 'mg', reference: 1.3, group: 'Vitamin' },
  { key: 'vitaminB3Mg', label: 'Vitamin B3', unit: 'mg', reference: 16, group: 'Vitamin' },
  { key: 'vitaminB5Mg', label: 'Vitamin B5', unit: 'mg', reference: 5, group: 'Vitamin' },
  { key: 'vitaminB6Mg', label: 'Vitamin B6', unit: 'mg', reference: 1.3, group: 'Vitamin' },
  { key: 'folateMcg', label: 'Folat (B9)', unit: 'mcg', reference: 400, group: 'Vitamin' },
  { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', reference: 4, group: 'Vitamin' },
  { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', reference: 90, group: 'Vitamin' },
  { key: 'calciumMg', label: 'Kalsium', unit: 'mg', reference: 1000, group: 'Mineral' },
  { key: 'phosphorusMg', label: 'Fosfor', unit: 'mg', reference: 700, group: 'Mineral' },
  { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', reference: 360, group: 'Mineral' },
  { key: 'ironMg', label: 'Zat besi', unit: 'mg', reference: 9, group: 'Mineral' },
  { key: 'iodineMcg', label: 'Iodium', unit: 'mcg', reference: 150, group: 'Mineral' },
  { key: 'zincMg', label: 'Seng (zinc)', unit: 'mg', reference: 11, group: 'Mineral' },
  { key: 'potassiumMg', label: 'Kalium', unit: 'mg', reference: 4700, group: 'Mineral' },
  { key: 'copperMcg', label: 'Tembaga', unit: 'mcg', reference: 900, group: 'Mineral' },
  { key: 'seleniumMcg', label: 'Selenium', unit: 'mcg', reference: 30, group: 'Mineral' },
  { key: 'manganeseMg', label: 'Mangan', unit: 'mg', reference: 2.3, group: 'Mineral' },
];

const NUTRIENT_FIELDS = NUTRIENTS
  .filter(({ key }) => !['calories', 'protein', 'carbs', 'fat'].includes(key))
  .map(({ key }) => key);

export { AKG_PROFILE_LABEL, NUTRIENTS, NUTRIENT_FIELDS };
