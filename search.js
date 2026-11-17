const ACTIVITY_SEARCH_LABELS = {
  run: 'lari',
  cycling: 'sepeda bersepeda',
  swimming: 'renang berenang',
  walking: 'jalan jalan kaki',
  hiking: 'hiking mendaki',
  rowing: 'dayung',
  strength: 'free training gym',
  pushups: 'push up',
  yoga: 'yoga',
  other: 'olahraga lainnya',
};

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('id-ID')
    .trim();
}

export function parseFitnessSearchQuery(query) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) return { kind: 'empty' };

  const tokens = trimmedQuery.split(/\s+/);
  const distanceIndex = tokens.findIndex((token) => /^\d+(?:[.,]\d+)?(?:km)?$/i.test(token));
  if (distanceIndex >= 0) {
    const distanceMatch = tokens[distanceIndex].match(/^(\d+(?:[.,]\d+)?)(km)?$/i);
    const minimumDistanceKm = Number(distanceMatch[1].replace(',', '.'));
    let distanceEndIndex = distanceIndex;
    if (!distanceMatch[2] && tokens[distanceIndex + 1]?.toLocaleLowerCase('id-ID') === 'km') {
      distanceEndIndex += 1;
    }

    if (Number.isFinite(minimumDistanceKm)) {
      const terms = tokens
        .filter((_, index) => index < distanceIndex || index > distanceEndIndex)
        .flatMap((token) => normalizeSearchText(token).split(/\s+/))
        .filter(Boolean);
      return terms.length
        ? { kind: 'combined', minimumDistanceKm, terms }
        : { kind: 'distance', minimumDistanceKm };
    }
  }
  return {
    kind: 'text',
    terms: normalizeSearchText(trimmedQuery).split(/\s+/).filter(Boolean),
  };
}

export function filterFitnessRecords(records, query) {
  const parsed = parseFitnessSearchQuery(query);
  if (parsed.kind === 'empty') return records;
  if (parsed.kind === 'distance') {
    return records.filter((record) => record.type === 'workout'
      && Number(record.distanceKm) >= parsed.minimumDistanceKm);
  }

  return records.filter((record) => {
    if (parsed.kind === 'combined'
      && !(record.type === 'workout' && Number(record.distanceKm) >= parsed.minimumDistanceKm)) {
      return false;
    }
    const searchable = normalizeSearchText([
      record.title,
      record.activityName,
      record.activityType,
      ACTIVITY_SEARCH_LABELS[record.activityType] || '',
      record.activityUnit,
      record.type === 'meal' ? 'makanan food meal' : 'olahraga workout activity',
    ].join(' '));
    return parsed.terms.every((term) => searchable.includes(term));
  });
}
