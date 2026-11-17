import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFitnessRecords, parseFitnessSearchQuery } from './search.js';

const records = [
  { type: 'workout', title: 'Lari pagi', activityType: 'run', distanceKm: 5 },
  { type: 'workout', title: 'Lari sore', activityType: 'run', distanceKm: 4.99 },
  { type: 'workout', title: 'Jalan santai', activityType: 'walking', distanceKm: 6 },
  { type: 'meal', title: 'Nasi ayam', calories: 650 },
];

test('angka atau angka dengan km berarti jarak minimum olahraga', () => {
  assert.deepEqual(parseFitnessSearchQuery('5'), {
    kind: 'distance',
    minimumDistanceKm: 5,
  });
  assert.deepEqual(parseFitnessSearchQuery('5 km'), {
    kind: 'distance',
    minimumDistanceKm: 5,
  });
  assert.deepEqual(parseFitnessSearchQuery('5,5km'), {
    kind: 'distance',
    minimumDistanceKm: 5.5,
  });
  assert.deepEqual(
    filterFitnessRecords(records, '5 km').map((record) => record.title),
    ['Lari pagi', 'Jalan santai'],
  );
});

test('teks mencari nama makanan serta nama dan jenis aktivitas', () => {
  assert.deepEqual(
    filterFitnessRecords(records, 'nasi ayam').map((record) => record.title),
    ['Nasi ayam'],
  );
  assert.deepEqual(
    filterFitnessRecords(records, 'lari pagi').map((record) => record.title),
    ['Lari pagi'],
  );
  assert.deepEqual(
    filterFitnessRecords(records, 'jalan').map((record) => record.title),
    ['Jalan santai'],
  );
});
