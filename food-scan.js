const FOOD_NUTRIENT_KEYS = [
  'fiberG', 'sugarG', 'sodiumMg', 'vitaminAMcg', 'vitaminDMcg', 'vitaminEMg',
  'vitaminKMcg', 'vitaminB1Mg', 'vitaminB2Mg', 'vitaminB3Mg', 'vitaminB5Mg',
  'vitaminB6Mg', 'folateMcg', 'vitaminB12Mcg', 'vitaminCMg', 'calciumMg',
  'phosphorusMg', 'magnesiumMg', 'ironMg', 'iodineMcg', 'zincMg',
  'potassiumMg', 'copperMcg', 'seleniumMcg', 'manganeseMg',
];

function parseFoodLabelText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const fields = Object.fromEntries(
    ['calories', 'protein', 'carbs', 'fat', ...FOOD_NUTRIENT_KEYS].map((key) => [key, '']),
  );
  const patterns = {
    calories: /(?:energy(?!\s+from\s+fat)\s*(?:total)?|energi(?!\s+dari\s+lemak)\s*(?:total)?|calories?|kalori)\D{0,16}(\d{1,4}(?:[.,]\d+)?)\s*(?:kcal|kkal)?\b/i,
    protein: /\bprotein\D{0,12}(\d{1,4}(?:[.,]\d+)?)\s*(?:g|gram)?\b/i,
    carbs: /\b(?:total\s+carbohydrate|carbohydrates?|carbs?|karbohidrat(?:\s+total)?)\D{0,12}(\d{1,4}(?:[.,]\d+)?)\s*(?:g|gram)?\b/i,
    fat: /\b(?:(?:total|jenuh|tak\s+jenuh)\s+)?(?:fat|lemak)\D{0,12}(\d{1,4}(?:[.,]\d+)?)\s*(?:g|gram)?\b/i,
    fiberG: /\b(?:dietary\s+fiber|fiber|fibre|serat)\D{0,12}(\d{1,4}(?:[.,]\d+)?)\s*(?:g|gram)?\b/i,
    sugarG: /\b(?:total\s+sugars?|sugars?|gula)\D{0,12}(\d{1,4}(?:[.,]\d+)?)\s*(?:g|gram)?\b/i,
    sodiumMg: /\b(?:sodium|natrium)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg)?\b/i,
    vitaminAMcg: /\bvitamin\s*a\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    vitaminDMcg: /\bvitamin\s*d(?:\s*3)?\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    vitaminEMg: /\bvitamin\s*e\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    vitaminKMcg: /\bvitamin\s*k(?:\s*1)?\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    vitaminB1Mg: /\b(?:vitamin\s*b1|thiamin(?:e)?)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    vitaminB2Mg: /\b(?:vitamin\s*b2|riboflavin)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    vitaminB3Mg: /\b(?:vitamin\s*b3|niacin)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    vitaminB5Mg: /\b(?:vitamin\s*b5|pantothenic\s+acid)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    vitaminB6Mg: /\b(?:vitamin\s*b6|pyridoxine)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    folateMcg: /\b(?:folate|folic\s+acid|folat|vitamin\s*b9)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    vitaminB12Mcg: /\b(?:vitamin\s*b12|cobalamin)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    vitaminCMg: /\b(?:vitamin\s*c|ascorbic\s+acid)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    calciumMg: /\b(?:calcium|kalsium)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    phosphorusMg: /\b(?:phosphorus|fosfor)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    magnesiumMg: /\b(?:magnesium|magnesium)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    ironMg: /\b(?:iron|zat\s+besi)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    iodineMcg: /\b(?:iodine|iodium)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    zincMg: /\b(?:zinc|seng)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    potassiumMg: /\b(?:potassium|kalium)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
    copperMcg: /\b(?:copper|tembaga)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    seleniumMcg: /\bselenium\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mcg|µg|ug|mg)?\b/i,
    manganeseMg: /\b(?:manganese|mangan)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(?:mg|mcg|µg|ug)?\b/i,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (!match) continue;
      if (/%/.test(line.slice(match.index + match[0].length).trimStart())) continue;
      let value = Number(match[1].replace(',', '.'));
      const unit = match[0].match(/(mcg|µg|ug|mg|gram|g|kcal|kkal)\s*$/i)?.[1]?.toLowerCase();
      if (key.endsWith('Mcg') && unit === 'mg') value *= 1000;
      if (key.endsWith('Mg') && ['mcg', 'µg', 'ug'].includes(unit)) value /= 1000;
      if (Number.isFinite(value) && value >= 0 && value <= 100000) {
        fields[key] = String(value);
        break;
      }
    }
  }
  return fields;
}

async function recognizeFoodLabel(file, onProgress = () => {}) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Pilih gambar label gizi.');
  }
  if (!globalThis.Tesseract?.recognize) {
    throw new Error('Library OCR belum siap. Periksa koneksi internet lalu coba lagi.');
  }
  const result = await globalThis.Tesseract.recognize(file, 'eng', {
    logger: (event) => {
      if (event.status === 'recognizing text' && Number.isFinite(event.progress)) {
        onProgress(event.progress);
      }
    },
  });
  return { text: result.data.text, fields: parseFoodLabelText(result.data.text) };
}

async function prepareFoodPhoto(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Pilih gambar makanan.');
  }
  if (!globalThis.createImageBitmap) {
    throw new Error('Browser ini belum mendukung pemrosesan gambar. Gunakan browser terbaru.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Foto gagal diproses. Coba pilih gambar lain.'));
      }, 'image/jpeg', 0.82);
    });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Foto gagal dibaca oleh browser.'));
      reader.readAsDataURL(blob);
    });
    return {
      mimeType: 'image/jpeg',
      data: String(dataUrl).split(',')[1],
    };
  } finally {
    bitmap.close();
  }
}

export { parseFoodLabelText, prepareFoodPhoto, recognizeFoodLabel };
