import { recognizeStravaScreenshot } from './strava-ocr.js';
import { parseStravaZip } from './strava-import.js';
import { prepareFoodPhoto, recognizeFoodLabel } from './food-scan.js';
import { AKG_PROFILE_LABEL, NUTRIENTS, NUTRIENT_FIELDS } from './nutrition.js';

const STORAGE_KEY = 'stride-spoon.logs.v1';
const BODY_STORAGE_KEY = 'stride-spoon.body-measurements.v1';
const GOALS_KEY = 'stride-spoon.goals.v1';
const GEMINI_NEXT_MODEL_KEY = 'stride-spoon.gemini-next-model.v1';
const API_URL = '/.netlify/functions/sheets';
const ACTIVITY_MET = {
  run: 8.3, cycling: 6.8, swimming: 6, walking: 3.8, hiking: 6,
  rowing: 7, strength: 5, pushups: 8, yoga: 3, other: 5, custom: 5,
};
const ACTIVITY_CHART_COLORS = ['#c8f169', '#78b9ff', '#c0a3ff', '#ff8872', '#f4c86a', '#69d6c6', '#e88cc5', '#9caa9f'];
const DEFAULT_GOALS = {
  calories: 2650, protein: 65, carbs: 430, fat: 75, weeklyKm: 25,
  weeklyCyclingKm: 20, dailyPushups: 50, goalPeriods: {
    weeklyKm: 'weekly', weeklyCyclingKm: 'weekly', dailyPushups: 'daily',
  }, customTargets: [],
};
const TARGET_PERIODS = [
  ['daily', 'Harian'],
  ['weekly', 'Mingguan'],
  ['monthly', 'Bulanan'],
  ['yearly', 'Tahunan'],
];
const VALID_TARGET_PERIODS = new Set(TARGET_PERIODS.map(([value]) => value));

function normalizeTargetPeriod(period, fallback = 'daily') {
  return VALID_TARGET_PERIODS.has(period) ? period : fallback;
}
const GOAL_SETTINGS = {
  calories: { label: 'Kalori', defaultValue: DEFAULT_GOALS.calories },
  protein: { label: 'Protein', defaultValue: DEFAULT_GOALS.protein },
  carbs: { label: 'Karbohidrat', defaultValue: DEFAULT_GOALS.carbs },
  fat: { label: 'Lemak', defaultValue: DEFAULT_GOALS.fat },
  weeklyKm: { label: 'Target lari', defaultValue: DEFAULT_GOALS.weeklyKm },
  weeklyCyclingKm: { label: 'Target sepeda', defaultValue: DEFAULT_GOALS.weeklyCyclingKm },
  dailyPushups: { label: 'Target push-up', defaultValue: DEFAULT_GOALS.dailyPushups },
};
const ACTIVITY_TYPES = {
  run: { label: 'Lari', icon: '↗', distance: true, pace: true, elevation: true },
  cycling: { label: 'Sepeda', icon: '🚴', distance: true, pace: true, elevation: true },
  swimming: { label: 'Renang', icon: '🏊', distance: true, pace: true, elevation: false },
  walking: { label: 'Jalan kaki', icon: '🚶', distance: true, pace: true, elevation: true },
  hiking: { label: 'Hiking', icon: '🥾', distance: true, pace: true, elevation: true },
  rowing: { label: 'Dayung', icon: '🚣', distance: true, pace: true, elevation: false },
  strength: { label: 'Free training', icon: '🏋', distance: false, pace: false, elevation: false },
  pushups: { label: 'Push-up', icon: '💪', distance: false, pace: false, elevation: false },
  yoga: { label: 'Yoga', icon: '🧘', distance: false, pace: false, elevation: false },
  other: { label: 'Olahraga lainnya', icon: '🏅', distance: true, pace: true, elevation: true },
  custom: { label: 'Custom', icon: '✳', distance: true, pace: true, elevation: true },
};
const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const MAX_CHART_RANGE_DAYS = 1827;
const LONG_CHART_RANGE_DAYS = 90;
let records = readStoredRecords();
let bodyMeasurements = readStoredBodyMeasurements();
let goals = readGoals();
let visibleRecords = 8;
let visibleMeasurements = 5;
let selectedWeekOffset = 0;
let activityChartDateRange = null;
let paceChartDateRange = null;
let calorieHistoryDateRange = null;
const selectedActivityChartTypes = new Set(Object.keys(ACTIVITY_TYPES));
const selectedPaceChartTypes = new Set(['run', 'trailrun', 'virtualrun']);
let toastTimer;
let syncInProgress = false;
let bodySyncInProgress = false;
let previewUrl = '';
let editingRecordId = null;
let editingMeasurementId = null;

const $ = (selector) => document.querySelector(selector);
const logForm = $('#log-form');
const syncState = $('#sync-state');

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateTimeValue(date = new Date()) {
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dateKey(value) {
  return String(value || '').slice(0, 10);
}

function activityType(record) {
  if (record.type !== 'workout') return '';
  return ACTIVITY_TYPES[record.activityType] ? record.activityType : 'run';
}

function activityLabel(record) {
  const type = activityType(record);
  if (type === 'custom') return record.activityName || 'Custom';
  return ACTIVITY_TYPES[type]?.label || 'Olahraga lainnya';
}

function readStoredRecords() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((item) => item && item.id && item.date) : [];
  } catch (error) {
    console.warn('Local backup catatan tidak dapat dibaca:', error);
    return [];
  }
}

function readStoredBodyMeasurements() {
  try {
    const stored = JSON.parse(localStorage.getItem(BODY_STORAGE_KEY) || '[]');
    return Array.isArray(stored)
      ? stored.filter((item) => item && item.id && /^\d{4}-\d{2}-\d{2}$/.test(item.date))
      : [];
  } catch (error) {
    console.warn('Backup lokal pengukuran tubuh tidak dapat dibaca:', error);
    return [];
  }
}

function persistRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.error('Gagal menyimpan backup lokal:', error);
    throw new Error('Catatan gagal disimpan ke perangkat. Periksa ruang penyimpanan browser.');
  }
}

function persistBodyMeasurements() {
  try {
    localStorage.setItem(BODY_STORAGE_KEY, JSON.stringify(bodyMeasurements));
  } catch (error) {
    console.error('Gagal menyimpan backup pengukuran tubuh:', error);
    throw new Error('Pengukuran gagal disimpan ke perangkat. Periksa ruang penyimpanan browser.');
  }
}

function activeRecords() {
  return records.filter((record) => !record.deleted);
}

function activeMeasurements() {
  return bodyMeasurements.filter((measurement) => !measurement.deleted);
}

function readGoals() {
  try {
    const stored = JSON.parse(localStorage.getItem(GOALS_KEY) || '{}');
    return {
      ...DEFAULT_GOALS,
      ...stored,
      goalPeriods: Object.fromEntries(Object.entries(DEFAULT_GOALS.goalPeriods).map(([key, fallback]) => [
        key,
        normalizeTargetPeriod(stored.goalPeriods?.[key], fallback),
      ])),
      customTargets: Array.isArray(stored.customTargets)
        ? stored.customTargets.map((target) => ({ ...target, period: normalizeTargetPeriod(target.period) }))
        : [],
    };
  } catch (error) {
    console.warn('Target tersimpan tidak dapat dibaca:', error);
    return { ...DEFAULT_GOALS };
  }
}

function persistGoals() {
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
}

function notify(message, kind = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function setSyncState(state, message) {
  syncState.dataset.state = state;
  $('#sync-label').textContent = message;
}

function showSyncError(error) {
  const message = error?.message || '';
  if (/belum dikonfigurasi/i.test(message)) {
    setSyncState('config', 'Google Sheets belum dikonfigurasi');
    return;
  }
  setSyncState('offline', 'Gagal sinkron · tersimpan lokal');
}

async function requestApi(method, params = {}, payload = null, timeoutMs = 15000) {
  const url = new URL(API_URL, window.location.href);
  if (method === 'GET') {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  const response = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok
      ? 'Server sinkronisasi mengirim respons yang tidak dapat dibaca.'
      : `Endpoint sinkronisasi belum tersedia (HTTP ${response.status}).`);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Server sinkronisasi mengirim respons yang tidak dapat dibaca.');
  }
  if (!response.ok || result.error) {
    const error = new Error(result.error || `Sinkronisasi gagal (HTTP ${response.status}).`);
    error.response = result;
    throw error;
  }
  return result;
}

function mergeRecords(incoming) {
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const record of incoming) {
    if (!record?.id) continue;
    const previous = byId.get(record.id);
    byId.set(record.id, previous?.pending
      ? previous
      : { ...previous, ...record, pending: false });
  }
  records = [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  persistRecords();
}

function mergeBodyMeasurements(incoming) {
  const byId = new Map(bodyMeasurements.map((measurement) => [measurement.id, measurement]));
  for (const measurement of incoming) {
    if (!measurement?.id || !/^\d{4}-\d{2}-\d{2}$/.test(measurement.date)) continue;
    const previous = byId.get(measurement.id);
    byId.set(measurement.id, previous?.pending
      ? previous
      : { ...previous, ...measurement, pending: false });
  }
  bodyMeasurements = [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  persistBodyMeasurements();
}

async function syncPendingRecords() {
  if (syncInProgress || !navigator.onLine) return;
  const pending = records.filter((record) => record.pending);
  if (!pending.length) return;

  syncInProgress = true;
  try {
    const stravaPending = pending.filter((record) => record.id.startsWith('strava-')
      && (record.pendingAction || 'append') === 'append');
    let stravaIds = new Set();
    if (stravaPending.length) {
      try {
        await syncStravaRecords(stravaPending);
        stravaIds = new Set(stravaPending.map((record) => record.id));
      } catch (error) {
        if (!/aksi(?: sinkronisasi)? tidak dikenal/i.test(error.message)) throw error;
      }
    }
    for (const record of pending) {
      if (stravaIds.has(record.id)) continue;
      const { pending: _pending, pendingAction, ...log } = record;
      if (pendingAction === 'delete') {
        await requestApi('POST', {}, { action: 'delete', id: record.id });
        records = records.filter((item) => item.id !== record.id);
        persistRecords();
        continue;
      }
      const result = await requestApi('POST', {}, { action: pendingAction || 'append', log });
      records = records.map((item) => item.id === record.id
        ? { ...item, ...(result.log || {}), pending: false, pendingAction: undefined }
        : item);
      persistRecords();
    }
    notify(`${pending.length} catatan offline berhasil disinkronkan.`);
  } finally {
    syncInProgress = false;
  }
}

async function syncStravaRecords(items) {
  let importedCount = 0;
  let duplicateCount = 0;
  let updatedCount = 0;
  let updatedDistanceCount = 0;
  let updatedDateCount = 0;
  for (let offset = 0; offset < items.length; offset += 100) {
    const batch = items.slice(offset, offset + 100);
    const logs = batch.map(({ pending: _pending, pendingAction: _pendingAction, ...log }) => log);
    const result = await requestApi('POST', {}, { action: 'importLogs', logs });
    if (!Number.isInteger(result.importedCount) || !Number.isInteger(result.duplicateCount)
      || !Array.isArray(result.updatedIds) || !Array.isArray(result.updatedDistanceIds)
      || !Array.isArray(result.updatedDateIds)) {
      throw new Error('Respons impor dari server tidak valid.');
    }
    const batchIds = new Set(batch.map((record) => record.id));
    records = records.map((record) => batchIds.has(record.id)
      ? {
        ...record,
        calories: result.updatedIds.includes(record.id) ? Number(batch.find((item) => item.id === record.id)?.calories || 0) : record.calories,
        distanceKm: result.updatedDistanceIds.includes(record.id) ? Number(batch.find((item) => item.id === record.id)?.distanceKm || 0) : record.distanceKm,
        date: result.updatedDateIds.includes(record.id) ? String(batch.find((item) => item.id === record.id)?.date || record.date) : record.date,
        pending: false,
        pendingAction: undefined,
      }
      : record);
    persistRecords();
    importedCount += result.importedCount;
    duplicateCount += result.duplicateCount;
    updatedCount += result.updatedIds.length;
    updatedDistanceCount += result.updatedDistanceIds.length;
    updatedDateCount += result.updatedDateIds.length;
  }
  return { importedCount, duplicateCount, updatedCount, updatedDistanceCount, updatedDateCount };
}

async function syncPendingBodyMeasurements() {
  if (bodySyncInProgress || !navigator.onLine) return;
  const pending = bodyMeasurements.filter((measurement) => measurement.pending);
  if (!pending.length) return;

  bodySyncInProgress = true;
  try {
    for (const measurement of pending) {
      if (measurement.pendingAction === 'delete') {
        await requestApi('POST', {}, { action: 'deleteMeasurement', id: measurement.id });
        bodyMeasurements = bodyMeasurements.filter((item) => item.id !== measurement.id);
      } else {
        const { pending: _pending, pendingAction: _pendingAction, ...payload } = measurement;
        const result = await requestApi('POST', {}, { action: 'saveMeasurement', measurement: payload });
        bodyMeasurements = bodyMeasurements.map((item) => item.id === measurement.id
          ? { ...item, ...(result.measurement || {}), pending: false, pendingAction: undefined }
          : item);
      }
      persistBodyMeasurements();
    }
    renderBodyTracking();
  } finally {
    bodySyncInProgress = false;
  }
}

async function loadFromSheet() {
  if (!navigator.onLine) {
    setSyncState('offline', 'Offline · tersimpan di perangkat');
    return;
  }
  try {
    const result = await requestApi('GET', { action: 'logs' });
    mergeRecords(Array.isArray(result.logs) ? result.logs : []);
    render();
    const measurementResult = await requestApi('GET', { action: 'measurements' });
    mergeBodyMeasurements(Array.isArray(measurementResult.measurements) ? measurementResult.measurements : []);
    renderBodyTracking();
    setSyncState('online', 'Tersinkron ke Google Sheets');
    await syncPendingRecords();
    await syncPendingBodyMeasurements();
    render();
  } catch (error) {
    showSyncError(error);
    console.warn('Google Sheets tidak dapat dihubungi:', error);
  }
}

function setEntryType(type) {
  $('#entry-type').value = type;
  document.querySelectorAll('[data-entry-tab]').forEach((tab) => {
    const active = tab.dataset.entryTab === type;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-entry-fields]').forEach((panel) => {
    const active = panel.dataset.entryFields === type;
    panel.classList.toggle('hidden', !active);
    panel.querySelectorAll('input').forEach((input) => { input.disabled = !active; });
  });
  if (type === 'workout') updateWorkoutFields();
  $('#save-button span:first-child').textContent = type === 'meal' ? 'Simpan makanan' : 'Simpan aktivitas';
}

function updateWorkoutFields() {
  const subtype = $('#workout-type').value;
  const settings = ACTIVITY_TYPES[subtype] || ACTIVITY_TYPES.run;
  const isCustom = subtype === 'custom';
  const distanceInput = logForm.elements.namedItem('distanceKm');
  const paceInput = logForm.elements.namedItem('pace');
  const elevationInput = logForm.elements.namedItem('elevationM');
  const customNameInput = logForm.elements.namedItem('activityName');
  const activityValueInput = logForm.elements.namedItem('activityValue');
  const activityUnitInput = logForm.elements.namedItem('activityUnit');
  const toggleField = (selector, input, visible, required = false) => {
    const field = $(selector);
    field.classList.toggle('hidden', !visible);
    input.disabled = !visible;
    input.required = visible && required;
  };

  toggleField('#custom-activity-field', customNameInput, isCustom, isCustom);
  toggleField('#activity-value-field', activityValueInput, isCustom || subtype === 'pushups', isCustom || subtype === 'pushups');
  $('#activity-unit-field').classList.toggle('hidden', !isCustom);
  activityUnitInput.disabled = !isCustom;
  activityUnitInput.required = isCustom;
  $('#activity-value-label').firstChild.textContent = subtype === 'pushups' ? 'Jumlah repetisi' : 'Jumlah target';
  if (subtype === 'pushups') activityUnitInput.value = 'repetisi';
  else if (isCustom && activityUnitInput.value === 'repetisi') activityUnitInput.value = '';
  else if (!isCustom) activityUnitInput.value = '';
  toggleField('#distance-field', distanceInput, settings.distance);
  toggleField('#pace-field', paceInput, settings.pace);
  toggleField('#elevation-field', elevationInput, settings.elevation);
  $('#ocr-box').classList.remove('hidden');
  const label = subtype === 'cycling' ? 'Waktu bersepeda'
    : subtype === 'swimming' ? 'Waktu berenang'
      : subtype === 'strength' ? 'Durasi latihan'
        : subtype === 'yoga' ? 'Durasi yoga'
          : 'Durasi olahraga';
  $('#duration-field').firstChild.textContent = label;
  const paceLabel = subtype === 'swimming' ? 'Pace (menit/100 m)'
    : subtype === 'cycling' ? 'Kecepatan atau pace'
      : 'Pace (menit/km)';
  $('#pace-field').firstChild.textContent = paceLabel;
  updateCalorieEstimate();
}

function formNumber(formData, name) {
  const value = formData.get(name);
  return value === null || value === '' ? 0 : Number(value);
}

function createId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function saveLog(event) {
  event.preventDefault();
  const button = $('#save-button');
  button.disabled = true;
  const formData = new FormData(logForm);
  const type = String(formData.get('type'));
  const selectedActivityType = type === 'workout' ? String(formData.get('activityType')) : '';
  const existingRecord = editingRecordId
    ? activeRecords().find((record) => record.id === editingRecordId)
    : null;
  const customActivityName = selectedActivityType === 'custom'
    ? String(formData.get('activityName') || '').trim()
    : '';
  const log = {
    id: existingRecord?.id || createId(),
    type,
    activityType: selectedActivityType,
    activityName: customActivityName,
    activityValue: type === 'workout' && (selectedActivityType === 'custom' || selectedActivityType === 'pushups')
      ? formNumber(formData, 'activityValue')
      : 0,
    activityUnit: type === 'workout' && selectedActivityType === 'pushups'
      ? 'repetisi'
      : type === 'workout' && selectedActivityType === 'custom'
        ? String(formData.get('activityUnit') || '').trim()
        : '',
    title: String(formData.get('title') || '').trim(),
    date: String(formData.get('date') || ''),
    calories: formNumber(formData, 'calories'),
    protein: type === 'meal' ? formNumber(formData, 'protein') : 0,
    carbs: type === 'meal' ? formNumber(formData, 'carbs') : 0,
    fat: type === 'meal' ? formNumber(formData, 'fat') : 0,
    ...Object.fromEntries(NUTRIENT_FIELDS.map((key) => [key, type === 'meal' ? formNumber(formData, key) : 0])),
    distanceKm: type === 'workout' && ACTIVITY_TYPES[selectedActivityType]?.distance
      ? formNumber(formData, 'distanceKm')
      : 0,
    pace: type === 'workout' && ACTIVITY_TYPES[selectedActivityType]?.pace
      ? String(formData.get('pace') || '').trim()
      : '',
    movingTime: type === 'workout' ? String(formData.get('movingTime') || '').trim() : '',
    elevationM: type === 'workout' ? formNumber(formData, 'elevationM') : 0,
    createdAt: existingRecord?.createdAt || new Date().toISOString(),
    pending: true,
    pendingAction: existingRecord ? 'update' : 'append',
  };

  try {
    records = existingRecord
      ? records.map((record) => record.id === log.id ? log : record)
      : [log, ...records];
    records.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    persistRecords();
    render();
    resetLogForm(type);

    if (!navigator.onLine) {
      setSyncState('offline', 'Offline · catatan tersimpan');
      notify(existingRecord
        ? 'Perubahan tersimpan di perangkat dan akan disinkronkan saat online.'
        : 'Catatan tersimpan di perangkat dan akan disinkronkan saat online.');
      return;
    }

    const { pending: _pending, pendingAction, ...payload } = log;
    try {
      const result = await requestApi('POST', {}, { action: pendingAction, log: payload });
      records = records.map((item) => item.id === log.id
        ? { ...item, ...(result.log || {}), pending: false, pendingAction: undefined }
        : item);
      persistRecords();
      setSyncState('online', 'Tersinkron ke Google Sheets');
      notify(existingRecord
        ? 'Perubahan catatan berhasil disimpan.'
        : type === 'meal' ? 'Catatan makanan tersimpan.' : 'Aktivitas olahraga tersimpan.');
    } catch (error) {
      showSyncError(error);
      notify(`${error.message} Catatan tetap tersimpan di perangkat.`, 'error');
    }
    render();
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function resetLogForm(entryType = 'meal') {
  logForm.reset();
  editingRecordId = null;
  setDefaultDates();
  $('#workout-type').value = 'run';
  $('#food-image-preview').classList.add('hidden');
  $('#image-preview').classList.add('hidden');
  document.querySelectorAll('.nutrition-inputs').forEach((details) => { details.open = false; });
  setEntryType(entryType);
  $('#cancel-edit-button').classList.add('hidden');
  $('#save-button span:first-child').textContent = entryType === 'meal' ? 'Simpan makanan' : 'Simpan aktivitas';
}

async function deleteRecord(record) {
  const label = record.type === 'workout' ? 'aktivitas' : 'catatan makanan';
  if (!window.confirm(`Hapus ${label} "${record.title}"? Tindakan ini juga akan menghapusnya dari Google Sheets.`)) return;
  if (editingRecordId === record.id) resetLogForm(record.type);
  records = records.map((item) => item.id === record.id
    ? { ...item, deleted: true, pending: true, pendingAction: 'delete' }
    : item);
  persistRecords();
  render();
  if (!navigator.onLine) {
    setSyncState('offline', 'Offline · penghapusan menunggu sinkronisasi');
    notify('Catatan dihapus dari tampilan dan akan disinkronkan saat online.');
    return;
  }
  try {
    await syncPendingRecords();
    setSyncState('online', 'Tersinkron ke Google Sheets');
    render();
    notify(`${label === 'aktivitas' ? 'Aktivitas' : 'Catatan makanan'} berhasil dihapus.`);
  } catch (error) {
    showSyncError(error);
    notify(`${error.message} Penghapusan akan dicoba lagi saat online.`, 'error');
  }
}

function startEditingRecord(record) {
  editingRecordId = record.id;
  logForm.reset();
  setEntryType(record.type);
  if (record.type === 'workout') {
    $('#workout-type').value = ACTIVITY_TYPES[record.activityType] ? record.activityType : 'run';
    updateWorkoutFields();
  }

  const fields = document.querySelector(`[data-entry-fields="${record.type}"]`);
  const values = {
    title: record.title,
    date: String(record.date || '').slice(0, 16),
    calories: record.calories,
    protein: record.protein,
    carbs: record.carbs,
    fat: record.fat,
    distanceKm: record.distanceKm,
    pace: record.pace,
    movingTime: record.movingTime,
    elevationM: record.elevationM,
    activityName: record.activityName,
    activityValue: record.activityValue,
    activityUnit: record.activityUnit,
    ...Object.fromEntries(NUTRIENT_FIELDS.map((key) => [key, record[key]])),
  };
  for (const [name, value] of Object.entries(values)) {
    const input = fields.querySelector(`[name="${name}"]`);
    if (input) input.value = value ?? '';
  }
  if (record.type === 'meal') {
    const nutrients = fields.querySelector('.nutrition-inputs');
    nutrients.open = NUTRIENT_FIELDS.some((key) => Number(record[key]) > 0);
  }

  $('#cancel-edit-button').classList.remove('hidden');
  $('#save-button span:first-child').textContent = 'Simpan perubahan';
  $('#cancel-edit-button').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setDefaultDates() {
  $('#meal-date').value = localDateTimeValue();
  $('#workout-date').value = localDateTimeValue();
}

function updateGoalsForm() {
  const form = $('#goals-form');
  for (const [key, value] of Object.entries(goals)) {
    if (key !== 'customTargets' && form.elements.namedItem(key)) {
      form.elements.namedItem(key).value = value;
    }
  }
  for (const [key, period] of Object.entries(goals.goalPeriods)) {
    const select = form.querySelector(`[data-goal-period="${key}"]`);
    if (select) select.value = period;
  }
  document.querySelectorAll('.goal-setting-row').forEach((row) => setGoalRowEditing(row, false));
  syncGoalSettings();
  renderCustomTargetInputs();
}

function setGoalRowEditing(row, editing) {
  row.dataset.editing = String(editing);
  row.querySelectorAll('input, select').forEach((field) => {
    if (field.tagName === 'SELECT') field.disabled = !editing;
    else field.readOnly = !editing;
  });
  const button = row.querySelector('[data-edit-goal]');
  if (button) {
    const defaultLabel = row.classList.contains('has-period') ? 'Edit target/periode' : 'Edit jumlah';
    button.textContent = editing ? 'Selesai' : defaultLabel;
  }
}

function syncGoalSettings() {
  const restore = $('#restore-goal-settings');
  if (!restore) return;
  restore.replaceChildren();
  for (const [key, setting] of Object.entries(GOAL_SETTINGS)) {
    const row = document.querySelector(`[data-goal-setting="${key}"]`);
    const input = row.querySelector(`[name="${key}"]`);
    const isActive = Number(input.value) > 0;
    row.classList.toggle('hidden', !isActive);
    if (isActive) continue;

    const button = document.createElement('button');
    button.className = 'restore-goal-button';
    button.type = 'button';
    button.dataset.restoreGoal = key;
    button.textContent = `＋ ${setting.label}`;
    restore.append(button);
  }
  restore.classList.toggle('hidden', !restore.childElementCount);
}

function addCustomTargetRow(target = {}) {
  const row = document.createElement('div');
  row.className = 'custom-target-row';
  row.dataset.targetId = target.id || createId();

  const name = document.createElement('input');
  name.className = 'text-input';
  name.dataset.targetField = 'name';
  name.placeholder = 'Nama target, mis. plank';
  name.maxLength = 50;
  name.value = target.name || '';
  name.setAttribute('aria-label', 'Nama target custom');

  const targetValue = document.createElement('input');
  targetValue.className = 'text-input';
  targetValue.dataset.targetField = 'target';
  targetValue.type = 'number';
  targetValue.min = '0.1';
  targetValue.max = '1000000';
  targetValue.step = 'any';
  targetValue.placeholder = 'Jumlah';
  targetValue.value = target.target || '';
  targetValue.setAttribute('aria-label', 'Jumlah target custom');

  const unit = document.createElement('input');
  unit.className = 'text-input';
  unit.dataset.targetField = 'unit';
  unit.placeholder = 'Satuan, mis. menit';
  unit.maxLength = 20;
  unit.value = target.unit || '';
  unit.setAttribute('aria-label', 'Satuan target custom');

  const period = document.createElement('select');
  period.className = 'text-input';
  period.dataset.targetField = 'period';
  period.setAttribute('aria-label', 'Periode target custom');
  for (const [value, label] of TARGET_PERIODS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    period.append(option);
  }
  period.value = normalizeTargetPeriod(target.period);

  const remove = document.createElement('button');
  remove.className = 'remove-target';
  remove.type = 'button';
  remove.textContent = 'Hapus';
  remove.addEventListener('click', () => row.remove());

  const actions = document.createElement('div');
  actions.className = 'custom-target-actions';
  const edit = document.createElement('button');
  edit.className = 'edit-target';
  edit.type = 'button';
  edit.textContent = 'Selesai';
  edit.setAttribute('aria-label', 'Edit detail target');
  edit.addEventListener('click', () => setCustomTargetEditing(row, row.dataset.editing !== 'true'));
  remove.classList.add('remove-target');

  for (const [label, input] of [['Nama', name], ['Target', targetValue], ['Satuan', unit], ['Periode', period]]) {
    const field = document.createElement('label');
    field.className = 'field-label';
    field.append(document.createTextNode(label), input);
    row.append(field);
  }
  actions.append(edit, remove);
  row.append(actions);
  $('#custom-target-list').append(row);
  setCustomTargetEditing(row, target.id ? false : true);
}

function setCustomTargetEditing(row, editing) {
  row.dataset.editing = String(editing);
  row.querySelectorAll('input').forEach((field) => { field.readOnly = !editing; });
  row.querySelector('select').disabled = !editing;
  const edit = row.querySelector('.edit-target');
  edit.textContent = editing ? 'Selesai' : 'Edit detail';
  edit.setAttribute('aria-label', editing ? 'Selesai mengedit target' : 'Edit nama, jumlah, satuan, dan periode target');
}

function renderCustomTargetInputs() {
  const list = $('#custom-target-list');
  if (!list) return;
  list.replaceChildren();
  goals.customTargets.forEach((target) => addCustomTargetRow(target));
}

function readCustomTargetsFromForm() {
  return [...document.querySelectorAll('.custom-target-row')].map((row) => {
    const read = (key) => row.querySelector(`[data-target-field="${key}"]`).value.trim();
    const name = read('name');
    const unit = read('unit');
    const target = Number(read('target'));
    if (!name || !unit || !Number.isFinite(target) || target <= 0) {
      throw new Error('Lengkapi nama, satuan, dan jumlah untuk setiap target custom.');
    }
    return {
      id: row.dataset.targetId || createId(),
      name: name.slice(0, 50),
      unit: unit.slice(0, 20),
      target,
      period: normalizeTargetPeriod(read('period')),
    };
  });
}

function saveGoals(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    goals = {
      ...goals,
      calories: Number(data.get('calories')),
      protein: Number(data.get('protein')),
      carbs: Number(data.get('carbs')),
      fat: Number(data.get('fat')),
      weeklyKm: Number(data.get('weeklyKm')),
      weeklyCyclingKm: Number(data.get('weeklyCyclingKm')),
      dailyPushups: Number(data.get('dailyPushups')),
      goalPeriods: Object.fromEntries([...event.currentTarget.querySelectorAll('[data-goal-period]')]
        .map((select) => [select.dataset.goalPeriod, select.value])),
      customTargets: readCustomTargetsFromForm(),
    };
    persistGoals();
    syncGoalSettings();
    render();
    notify('Target aktivitas dan nutrisi berhasil diperbarui.');
  } catch (error) {
    notify(`Gagal menyimpan target: ${error.message}`, 'error');
  }
}

function todayRecords() {
  const today = localDateKey();
  return activeRecords().filter((record) => dateKey(record.date) === today);
}

function sum(recordsToSum, key) {
  return recordsToSum.reduce((total, record) => total + (Number(record[key]) || 0), 0);
}

function setProgress(selector, value, target) {
  const percent = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  $(selector).style.width = `${percent}%`;
  return percent;
}

function renderSummary() {
  const today = todayRecords();
  const meals = today.filter((record) => record.type === 'meal');
  const workouts = today.filter((record) => record.type === 'workout');
  const intake = sum(meals, 'calories');
  const burned = sum(workouts, 'calories');
  const balance = intake - burned;

  $('#calories-in').textContent = numberFormat.format(intake);
  $('#calories-out').textContent = numberFormat.format(burned);
  $('#calorie-balance').textContent = numberFormat.format(balance);
  $('#calorie-balance').parentElement.classList.toggle('is-over', goals.calories > 0 && balance > goals.calories);
  $('#calorie-goal-label').textContent = goals.calories > 0
    ? `Target ${numberFormat.format(goals.calories)} kcal`
    : 'Target tidak diatur';
  $('#calorie-percent').textContent = goals.calories > 0
    ? `${Math.round(setProgress('#calorie-progress', intake, goals.calories))}%`
    : '—';
  if (!goals.calories) $('#calorie-progress').style.width = '0%';

  for (const [field, goal] of [['protein', goals.protein], ['carbs', goals.carbs], ['fat', goals.fat]]) {
    const amount = sum(meals, field);
    $(`#${field}-total`).textContent = numberFormat.format(amount);
    $(`#${field}-goal`).textContent = numberFormat.format(goal);
    $(`[data-macro-goal="${field}"]`).classList.toggle('hidden', goal <= 0);
    setProgress(`#${field}-progress`, amount, goal);
  }
  $('#macro-empty-state').classList.toggle('hidden', goals.protein > 0 || goals.carbs > 0 || goals.fat > 0);
  renderNutrientSummary(meals);
  renderActivityTargets();
}

function renderNutrientSummary(meals) {
  $('#akg-profile-label').textContent = AKG_PROFILE_LABEL;
  const container = $('#micronutrient-summary');
  container.replaceChildren();
  for (const group of ['Lainnya', 'Vitamin', 'Mineral']) {
    const nutrients = NUTRIENTS.filter((item) => item.group === group);
    if (!nutrients.length) continue;
    const section = document.createElement('section');
    section.className = 'nutrient-group';
    const heading = document.createElement('h3');
    heading.textContent = group;
    section.append(heading);

    for (const nutrient of nutrients) {
      const current = sum(meals, nutrient.key);
      const percent = nutrient.reference > 0 ? Math.round((current / nutrient.reference) * 100) : 0;
      const row = document.createElement('div');
      row.className = `nutrient-row${nutrient.limit && percent > 100 ? ' over-limit' : ''}`;
      const meta = document.createElement('div');
      meta.className = 'nutrient-meta';
      const label = document.createElement('span');
      label.textContent = nutrient.label;
      const value = document.createElement('span');
      value.textContent = `${numberFormat.format(current)} / ${numberFormat.format(nutrient.reference)} ${nutrient.unit} · ${percent}%`;
      meta.append(label, value);
      const track = document.createElement('div');
      track.className = 'progress-track nutrient-track';
      const fill = document.createElement('span');
      fill.style.width = `${Math.min(100, percent)}%`;
      track.append(fill);
      row.append(meta, track);
      section.append(row);
    }
    container.append(section);
  }
}

function sumWorkoutMetric(activity, dateKeys, metric) {
  return sum(activeRecords().filter((record) => record.type === 'workout'
    && activityType(record) === activity
    && dateKeys.includes(dateKey(record.date))), metric);
}

function customTargetProgress(target) {
  const dateKeys = targetPeriodDateKeys(target.period);
  return sum(activeRecords().filter((record) => record.type === 'workout'
    && activityType(record) === 'custom'
    && String(record.activityName || '').toLocaleLowerCase() === target.name.toLocaleLowerCase()
    && String(record.activityUnit || '').toLocaleLowerCase() === target.unit.toLocaleLowerCase()
    && dateKeys.includes(dateKey(record.date))), 'activityValue');
}

function renderActivityTargets() {
  const container = $('#activity-target-progress');
  container.replaceChildren();
  const targets = [
    { name: 'Lari', unit: 'km', target: goals.weeklyKm, period: goals.goalPeriods.weeklyKm, activity: 'run', metric: 'distanceKm' },
    { name: 'Sepeda', unit: 'km', target: goals.weeklyCyclingKm, period: goals.goalPeriods.weeklyCyclingKm, activity: 'cycling', metric: 'distanceKm' },
    { name: 'Push-up', unit: 'repetisi', target: goals.dailyPushups, period: goals.goalPeriods.dailyPushups, activity: 'pushups', metric: 'activityValue' },
    ...goals.customTargets.map((target) => ({ ...target, value: customTargetProgress(target) })),
  ].filter((target) => Number(target.target) > 0).map((target) => ({
    ...target,
    value: target.value ?? sumWorkoutMetric(target.activity, targetPeriodDateKeys(target.period), target.metric),
  }));
  $('#activity-target-empty').classList.toggle('hidden', targets.length > 0);

  for (const target of targets) {
    const percent = target.target > 0 ? Math.round((target.value / target.target) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'target-progress-row';
    const meta = document.createElement('div');
    meta.className = 'nutrient-meta';
    const label = document.createElement('span');
    label.textContent = `${target.name} · ${periodLabel(target.period)}`;
    const value = document.createElement('span');
    value.textContent = `${numberFormat.format(target.value)} / ${numberFormat.format(target.target)} ${target.unit}`;
    meta.append(label, value);
    const track = document.createElement('div');
    track.className = 'progress-track nutrient-track';
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, percent)}%`;
    track.append(fill);
    row.append(meta, track);
    container.append(row);
  }
}

function periodLabel(period) {
  return ({
    daily: 'hari ini',
    weekly: 'minggu ini',
    monthly: 'bulan ini',
    yearly: 'tahun ini',
  })[period] || 'hari ini';
}

function targetPeriodDateKeys(period) {
  const today = new Date();
  if (period === 'daily') return [localDateKey(today)];
  if (period === 'weekly') return weekDateKeys();

  const start = period === 'yearly'
    ? new Date(today.getFullYear(), 0, 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const end = period === 'yearly'
    ? new Date(today.getFullYear() + 1, 0, 1)
    : new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const keys = [];
  for (const date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
    keys.push(localDateKey(date));
  }
  return keys;
}

function weekDateKeys(offset = 0) {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return localDateKey(date);
  });
}

function formatWeekRange(keys) {
  const start = new Date(`${keys[0]}T12:00:00`);
  const end = new Date(`${keys[6]}T12:00:00`);
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = start.toLocaleDateString('id-ID', { day: 'numeric', month: sameMonth ? undefined : 'short' });
  const endLabel = end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `${startLabel}–${endLabel}`;
}

function dateRangeKeys(start, end) {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const days = Math.round((endDate - startDate) / 86400000) + 1;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index);
    return localDateKey(date);
  });
}

function formatDateRange(start, end) {
  const formatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${formatter.format(new Date(`${start}T12:00:00`))} – ${formatter.format(new Date(`${end}T12:00:00`))}`;
}

function setupChartDateRange(formId, statusId, onRangeChange) {
  $(`#${formId}`).addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const start = form.elements.namedItem('from').value;
    const end = form.elements.namedItem('to').value;
    const days = Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000) + 1;
    if (!start || !end || !Number.isFinite(days) || days < 1) {
      $(`#${statusId}`).textContent = 'Tanggal awal harus sama dengan atau sebelum tanggal akhir.';
      notify('Periksa rentang tanggal grafik.', 'error');
      return;
    }
    if (days > MAX_CHART_RANGE_DAYS) {
      $(`#${statusId}`).textContent = 'Rentang terlalu panjang. Pilih maksimal 5 tahun.';
      notify('Rentang grafik maksimal 5 tahun.', 'error');
      return;
    }
    onRangeChange({ start, end });
  });
}

function chartBuckets(start, end) {
  const keys = dateRangeKeys(start, end);
  if (keys.length <= LONG_CHART_RANGE_DAYS) {
    return keys.map((key) => ({ key, start: key, end: key }));
  }
  const groups = new Map();
  keys.forEach((key) => {
    const week = weekStartDate(key);
    const bucket = groups.get(week) || { key: week, start: key, end: key };
    bucket.end = key;
    groups.set(week, bucket);
  });
  return [...groups.values()];
}

function chartBucketLabel(bucket, longRange) {
  const start = new Date(`${bucket.start}T12:00:00`);
  if (bucket.start === bucket.end) {
    return longRange
      ? start.toLocaleDateString('id-ID', { day: 'numeric', month: 'numeric' })
      : start.toLocaleDateString('id-ID', { weekday: 'short' });
  }
  return start.toLocaleDateString('id-ID', { day: 'numeric', month: 'numeric' });
}

function chartBucketDescription(bucket) {
  if (bucket.start === bucket.end) {
    return new Date(`${bucket.start}T12:00:00`).toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
    });
  }
  const start = new Date(`${bucket.start}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  const end = new Date(`${bucket.end}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${start}–${end}`;
}

function setupChartActivityFilters(filterId, selectedTypes, redraw) {
  const fieldset = $(`#${filterId}`);
  fieldset.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.value === 'all') {
      fieldset.querySelectorAll('input[type="checkbox"]:not([value="all"])')
        .forEach((input) => { input.checked = checkbox.checked; });
      selectedTypes.clear();
      if (checkbox.checked) {
        fieldset.querySelectorAll('input[type="checkbox"]:not([value="all"])')
          .forEach((input) => selectedTypes.add(input.value));
      }
    } else {
      if (checkbox.checked) selectedTypes.add(checkbox.value);
      else selectedTypes.delete(checkbox.value);
      const all = fieldset.querySelector('input[value="all"]');
      const options = [...fieldset.querySelectorAll('input[type="checkbox"]:not([value="all"])')];
      all.checked = options.every((input) => input.checked);
    }
    redraw();
  });
}

function updateWeekNavigation(keys) {
  $('#selected-week-label').textContent = selectedWeekOffset === 0
    ? `Minggu ini · ${formatWeekRange(keys)}`
    : formatWeekRange(keys);
  $('#week-next').disabled = selectedWeekOffset >= 0;
  const earliestWorkout = activeRecords()
    .filter((record) => record.type === 'workout')
    .map((record) => dateKey(record.date))
    .filter(Boolean)
    .sort()[0];
  $('#week-previous').disabled = !earliestWorkout || keys[0] <= weekStartDate(earliestWorkout);
}

function weekStartDate(value) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return localDateKey(date);
}

function drawCanvas(canvas, draw) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw(context, bounds.width, bounds.height);
}

function chartColor(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

function drawMileageChart() {
  const canvas = $('#mileage-chart');
  const tooltip = $('#mileage-chart-tooltip');
  const keys = weekDateKeys(selectedWeekOffset);
  updateWeekNavigation(keys);
  const heading = canvas.closest('.chart-panel').querySelector('h2');
  heading.textContent = selectedWeekOffset === 0 ? 'Jarak minggu ini' : `Jarak ${formatWeekRange(keys)}`;
  const daily = keys.map((key) => sum(
    activeRecords().filter((record) => record.type === 'workout' && activityType(record) === 'run' && dateKey(record.date) === key),
    'distanceKm',
  ));
  const total = daily.reduce((value, distance) => value + distance, 0);
  const weeklyGoal = goals.goalPeriods.weeklyKm === 'weekly' ? goals.weeklyKm : 0;
  $('#weekly-distance').textContent = numberFormat.format(total);
  $('#weekly-goal-caption').textContent = goals.weeklyKm > 0
    ? `Target lari ${numberFormat.format(goals.weeklyKm)} km/${({ daily: 'hari', weekly: 'minggu', monthly: 'bulan', yearly: 'tahun' })[goals.goalPeriods.weeklyKm]}`
    : 'Target lari tidak diatur';
  $('#weekly-progress-caption').textContent = weeklyGoal > 0
    ? `${Math.round((total / weeklyGoal) * 100)}% tercapai`
    : goals.weeklyKm > 0 ? 'Progres di kartu target' : '—';

  drawCanvas(canvas, (context, width, height) => {
    const left = 5;
    const right = 5;
    const top = 10;
    const bottom = 25;
    const plotHeight = height - top - bottom;
    const slot = (width - left - right) / 7;
    const max = Math.max(1, ...daily, weeklyGoal / 7) * 1.2;
    context.font = '9px "DM Sans", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const fraction of [0, 0.5, 1]) {
      const y = top + plotHeight * fraction;
      context.strokeStyle = '#2a382e';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
    }
    daily.forEach((value, index) => {
      const barWidth = Math.min(24, slot * 0.48);
      const barHeight = (value / max) * plotHeight;
      const x = left + index * slot + (slot - barWidth) / 2;
      const y = top + plotHeight - barHeight;
      context.fillStyle = value > 0 ? chartColor('--lime') : '#354238';
      context.beginPath();
      context.roundRect(x, y, barWidth, Math.max(3, barHeight), 5);
      context.fill();
      context.fillStyle = '#9aa79b';
      const day = new Date(`${keys[index]}T12:00:00`).toLocaleDateString('id-ID', { weekday: 'short' });
      context.fillText(day, x + barWidth / 2, height - 9);
    });
  });

  const bounds = canvas.getBoundingClientRect();
  const left = 5;
  const slot = (bounds.width - left - 5) / keys.length;
  const weeklyProgress = weeklyGoal > 0 ? `${Math.round((total / weeklyGoal) * 100)}% dari target` : 'Target mingguan tidak diatur';
  canvas.onpointermove = (event) => {
    const pointerX = event.clientX - canvas.getBoundingClientRect().left;
    const dayIndex = Math.floor((pointerX - left) / slot);
    if (dayIndex < 0 || dayIndex >= keys.length) {
      tooltip.classList.add('hidden');
      return;
    }
    const date = new Date(`${keys[dayIndex]}T12:00:00`);
    const dateLabel = date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
    const distance = daily[dayIndex];
    chartTooltip(canvas, tooltip, event,
      `${dateLabel}\n${numberFormat.format(distance)} km lari\nTotal minggu: ${numberFormat.format(total)} km · ${weeklyProgress}`);
  };
  canvas.onpointerleave = () => tooltip.classList.add('hidden');
}

function chartTooltip(canvas, tooltip, event, text) {
  tooltip.textContent = text;
  tooltip.classList.remove('hidden');
  const wrap = canvas.parentElement;
  const wrapBounds = wrap.getBoundingClientRect();
  const left = event.clientX - wrapBounds.left + wrap.scrollLeft + 10;
  const top = event.clientY - wrapBounds.top + wrap.scrollTop + 10;
  tooltip.style.left = `${Math.max(4, Math.min(left, wrap.scrollWidth - tooltip.offsetWidth - 4))}px`;
  tooltip.style.top = `${Math.max(4, Math.min(top, wrapBounds.height - tooltip.offsetHeight - 4))}px`;
}

function activityChartLabel(record) {
  const type = activityType(record);
  return type === 'custom' ? record.activityName || 'Custom' : ACTIVITY_TYPES[type]?.label || 'Olahraga lainnya';
}

function chartActivityType(record) {
  const type = activityType(record);
  return ACTIVITY_TYPES[type] ? type : 'other';
}

function drawActivityChart() {
  const canvas = $('#activity-chart');
  const tooltip = $('#activity-chart-tooltip');
  const currentWeek = weekDateKeys(0);
  const range = activityChartDateRange || { start: currentWeek[0], end: currentWeek[6] };
  const buckets = chartBuckets(range.start, range.end);
  const chartWidth = Math.max(canvas.parentElement.clientWidth, buckets.length * 36);
  canvas.style.width = `${chartWidth}px`;
  $('#activity-chart-title').textContent = `Kalori olahraga · ${formatDateRange(range.start, range.end)}`;
  const longRange = dateRangeKeys(range.start, range.end).length > LONG_CHART_RANGE_DAYS;
  $('#activity-chart-range-status').textContent = `${formatDateRange(range.start, range.end)} · ${longRange ? 'ringkasan mingguan' : 'data harian'} · Maksimal 5 tahun per tampilan.`;
  const workouts = activeRecords().filter((record) => record.type === 'workout'
    && dateKey(record.date) >= range.start && dateKey(record.date) <= range.end
    && selectedActivityChartTypes.has(chartActivityType(record)));
  const labels = [...new Set(workouts.map(activityChartLabel))];
  const series = labels.map((label, index) => ({
    label,
    color: ACTIVITY_CHART_COLORS[index % ACTIVITY_CHART_COLORS.length],
    values: buckets.map((bucket) => sum(workouts.filter((record) => dateKey(record.date) >= bucket.start
      && dateKey(record.date) <= bucket.end
      && activityChartLabel(record) === label), 'calories')),
  }));
  const dailyTotals = buckets.map((_, dayIndex) => sum(series.map((item) => ({ value: item.values[dayIndex] })), 'value'));
  const legend = $('#activity-chart-legend');
  legend.replaceChildren();
  series.forEach((item) => {
    const entry = document.createElement('span');
    entry.className = 'chart-legend-item';
    const dot = document.createElement('i');
    dot.style.backgroundColor = item.color;
    entry.append(dot, document.createTextNode(item.label));
    legend.append(entry);
  });

  const hitAreas = [];
  drawCanvas(canvas, (context, width, height) => {
    const left = 5;
    const right = 5;
    const top = 10;
    const bottom = 25;
    const plotHeight = height - top - bottom;
    const slot = (width - left - right) / buckets.length;
    const max = Math.max(100, ...dailyTotals) * 1.15;
    context.font = '9px "DM Sans", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const fraction of [0, 0.5, 1]) {
      const y = top + plotHeight * fraction;
      context.strokeStyle = '#2a382e';
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
    }

    if (!workouts.length) {
      context.fillStyle = '#9aa79b';
      context.fillText('Tidak ada aktivitas pada rentang tanggal ini', width / 2, height / 2);
    }

    const labelEvery = Math.max(1, Math.ceil(buckets.length / 14));
    buckets.forEach((bucket, dayIndex) => {
      const barWidth = Math.min(28, slot * 0.52);
      const x = left + dayIndex * slot + (slot - barWidth) / 2;
      let stackHeight = 0;
      series.forEach((item) => {
        const value = item.values[dayIndex];
        if (value <= 0) return;
        const segmentHeight = (value / max) * plotHeight;
        context.fillStyle = item.color;
        context.beginPath();
        context.roundRect(x, top + plotHeight - stackHeight - segmentHeight, barWidth, segmentHeight, 4);
        context.fill();
        stackHeight += segmentHeight;
      });
      context.fillStyle = '#9aa79b';
      if (dayIndex % labelEvery === 0 || dayIndex === buckets.length - 1) {
        context.fillText(chartBucketLabel(bucket, longRange), x + barWidth / 2, height - 9);
      }
      const dayWorkouts = workouts.filter((record) => dateKey(record.date) >= bucket.start
        && dateKey(record.date) <= bucket.end);
      const detailLines = dayWorkouts.map((record) => {
        const details = [`${activityChartLabel(record)}: ${numberFormat.format(record.calories || 0)} kcal`];
        if (record.movingTime) details.push(record.movingTime);
        if (Number(record.distanceKm)) details.push(`${numberFormat.format(record.distanceKm)} km`);
        return details.join(' · ');
      });
      hitAreas.push({
        left: x - (slot - barWidth) / 2,
        right: x + barWidth + (slot - barWidth) / 2,
        text: dayWorkouts.length
          ? `${chartBucketDescription(bucket)}\n${detailLines.join('\n')}`
          : `${chartBucketDescription(bucket)}\nTidak ada aktivitas`,
      });
    });
  });

  canvas.onpointermove = (event) => {
    const x = event.clientX - canvas.getBoundingClientRect().left;
    const hit = hitAreas.find((area) => x >= area.left && x <= area.right);
    if (hit) chartTooltip(canvas, tooltip, event, hit.text);
    else tooltip.classList.add('hidden');
  };
  canvas.onpointerleave = () => tooltip.classList.add('hidden');
}

function drawCalorieHistoryChart() {
  const canvas = $('#calorie-history-chart');
  const tooltip = $('#calorie-history-tooltip');
  const range = calorieHistoryDateRange;
  const dates = dateRangeKeys(range.start, range.end);
  const longRange = dates.length > LONG_CHART_RANGE_DAYS;
  const buckets = chartBuckets(range.start, range.end);
  const visibleRecords = activeRecords().filter((record) => {
    const key = dateKey(record.date);
    return (record.type === 'meal' || record.type === 'workout')
      && key >= range.start && key <= range.end;
  });
  const intake = buckets.map((bucket) => sum(visibleRecords.filter((record) =>
    record.type === 'meal' && dateKey(record.date) >= bucket.start && dateKey(record.date) <= bucket.end), 'calories'));
  const burned = buckets.map((bucket) => sum(visibleRecords.filter((record) =>
    record.type === 'workout' && dateKey(record.date) >= bucket.start && dateKey(record.date) <= bucket.end), 'calories'));
  const series = [
    { label: 'Asupan', values: intake, color: chartColor('--lime') },
    { label: 'Terbakar', values: burned, color: chartColor('--coral') },
  ];
  const legend = $('#calorie-history-legend');
  legend.replaceChildren();
  series.forEach((item) => {
    const entry = document.createElement('span');
    entry.className = 'chart-legend-item';
    const dot = document.createElement('i');
    dot.style.backgroundColor = item.color;
    entry.append(dot, document.createTextNode(item.label));
    legend.append(entry);
  });
  canvas.style.width = `${Math.max(canvas.parentElement.clientWidth, buckets.length * 36)}px`;
  $('#calorie-history-title').textContent = `Asupan dan kalori terbakar · ${formatDateRange(range.start, range.end)}`;
  $('#calorie-history-range-status').textContent = `${formatDateRange(range.start, range.end)} · ${longRange ? 'ringkasan mingguan' : 'data harian'} · Maksimal 5 tahun per tampilan.`;

  const hitAreas = [];
  drawCanvas(canvas, (context, width, height) => {
    const left = 38;
    const right = 7;
    const top = 10;
    const bottom = 25;
    const plotHeight = height - top - bottom;
    const slot = (width - left - right) / buckets.length;
    const maximum = Math.max(100, ...intake, ...burned);
    const scaleMax = Math.ceil(maximum / 250) * 250;
    context.font = '9px "DM Sans", sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';

    for (const fraction of [0, 0.5, 1]) {
      const y = top + plotHeight * fraction;
      context.strokeStyle = '#2a382e';
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = '#9aa79b';
      context.fillText(numberFormat.format(Math.round(scaleMax * (1 - fraction))), left - 6, y);
    }

    if (!visibleRecords.length) {
      context.fillStyle = '#9aa79b';
      context.textAlign = 'center';
      context.fillText('Belum ada catatan kalori pada rentang ini', width / 2, height / 2);
    }

    const labelEvery = Math.max(1, Math.ceil(buckets.length / 14));
    buckets.forEach((bucket, index) => {
      const barWidth = Math.min(16, slot * 0.3);
      const groupWidth = barWidth * 2 + 3;
      const groupLeft = left + index * slot + (slot - groupWidth) / 2;
      const values = [intake[index], burned[index]];
      series.forEach((item, seriesIndex) => {
        const value = values[seriesIndex];
        if (value <= 0) return;
        const barHeight = (value / scaleMax) * plotHeight;
        const x = groupLeft + seriesIndex * (barWidth + 3);
        context.fillStyle = item.color;
        context.beginPath();
        context.roundRect(x, top + plotHeight - barHeight, barWidth, Math.max(3, barHeight), 3);
        context.fill();
      });
      if (index % labelEvery === 0 || index === buckets.length - 1) {
        context.fillStyle = '#9aa79b';
        context.textAlign = 'center';
        context.fillText(chartBucketLabel(bucket, longRange), left + index * slot + slot / 2, height - 9);
      }

      const recordsInBucket = visibleRecords.filter((record) =>
        dateKey(record.date) >= bucket.start && dateKey(record.date) <= bucket.end);
      const bucketIntake = intake[index];
      const bucketBurned = burned[index];
      const detailLines = recordsInBucket.map((record) =>
        `${record.type === 'meal' ? 'Asupan' : 'Terbakar'} · ${record.title || (record.type === 'meal' ? 'Makanan' : activityLabel(record))}: ${numberFormat.format(record.calories || 0)} kcal`);
      hitAreas.push({
        left: left + index * slot,
        right: left + (index + 1) * slot,
        text: `${chartBucketDescription(bucket)}\nAsupan: ${numberFormat.format(bucketIntake)} kcal · Terbakar: ${numberFormat.format(bucketBurned)} kcal\nKalori bersih: ${numberFormat.format(bucketIntake - bucketBurned)} kcal${detailLines.length ? `\n${detailLines.slice(0, 6).join('\n')}${detailLines.length > 6 ? `\n+${detailLines.length - 6} catatan lain` : ''}` : '\nTidak ada catatan kalori'}`,
      });
    });
  });

  canvas.onpointermove = (event) => {
    const x = event.clientX - canvas.getBoundingClientRect().left;
    const hit = hitAreas.find((area) => x >= area.left && x <= area.right);
    if (hit) chartTooltip(canvas, tooltip, event, hit.text);
    else tooltip.classList.add('hidden');
  };
  canvas.onpointerleave = () => tooltip.classList.add('hidden');
}

function paceSeconds(value) {
  const match = String(value || '').match(/(\d{1,2}):([0-5]\d)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function paceActivityType(record) {
  const title = `${record.title || ''} ${record.activityName || ''}`.toLowerCase();
  if (/trail/.test(title)) return 'trailrun';
  if (/virtual/.test(title)) return 'virtualrun';
  return 'run';
}

function drawPaceChart() {
  const canvas = $('#pace-chart');
  const tooltip = $('#pace-chart-tooltip');
  const currentWeek = weekDateKeys(0);
  const range = paceChartDateRange || { start: currentWeek[0], end: currentWeek[6] };
  const buckets = chartBuckets(range.start, range.end);
  const longRange = dateRangeKeys(range.start, range.end).length > LONG_CHART_RANGE_DAYS;
  const runs = activeRecords()
    .filter((record) => record.type === 'workout' && activityType(record) === 'run'
      && dateKey(record.date) >= range.start && dateKey(record.date) <= range.end
      && paceSeconds(record.pace) !== null
      && selectedPaceChartTypes.has(paceActivityType(record)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const plotPoints = longRange
    ? buckets.map((bucket) => {
      const bucketRuns = runs.filter((run) => dateKey(run.date) >= bucket.start && dateKey(run.date) <= bucket.end);
      if (!bucketRuns.length) return null;
      const average = Math.round(bucketRuns.reduce((total, run) => total + paceSeconds(run.pace), 0) / bucketRuns.length);
      return { value: average, records: bucketRuns, bucket };
    }).filter(Boolean)
    : runs.map((record) => ({
      value: paceSeconds(record.pace),
      records: [record],
      bucket: { start: dateKey(record.date), end: dateKey(record.date) },
    }));
  canvas.style.width = `${Math.max(canvas.parentElement.clientWidth, buckets.length * 36)}px`;
  $('#pace-chart-range-status').textContent = `${formatDateRange(range.start, range.end)} · ${longRange ? 'ringkasan pace mingguan' : 'data per aktivitas'} · Maksimal 5 tahun per tampilan.`;
  const points = [];
  drawCanvas(canvas, (context, width, height) => {
    const left = 37;
    const right = 10;
    const top = 13;
    const bottom = 24;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    context.font = '9px "DM Sans", sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';

    if (!plotPoints.length) {
      context.fillStyle = '#9aa79b';
      context.textAlign = 'center';
      context.fillText('Tidak ada aktivitas lari dengan pace pada rentang ini', width / 2, height / 2);
      return;
    }

    const values = plotPoints.map((point) => point.value);
    const min = Math.max(0, Math.min(...values) - 30);
    const max = Math.max(min + 60, Math.max(...values) + 30);
    const pointX = (index) => plotPoints.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (plotPoints.length - 1);
    const pointY = (value) => top + ((max - value) / (max - min)) * plotHeight;

    for (const fraction of [0, 0.5, 1]) {
      const value = max - (max - min) * fraction;
      const y = top + plotHeight * fraction;
      context.strokeStyle = '#2a382e';
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = '#9aa79b';
      context.fillText(`${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}`, left - 6, y);
    }

    context.strokeStyle = chartColor('--lime');
    context.lineWidth = 2;
    context.beginPath();
    values.forEach((value, index) => {
      const x = pointX(index);
      const y = pointY(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    const labelEvery = Math.max(1, Math.ceil(plotPoints.length / 14));
    values.forEach((value, index) => {
      const x = pointX(index);
      const y = pointY(value);
      points.push({ x, y, ...plotPoints[index] });
      context.fillStyle = chartColor('--lime');
      context.beginPath();
      context.arc(x, y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#9aa79b';
      if (index % labelEvery === 0 || index === plotPoints.length - 1) {
        context.textAlign = 'center';
        context.fillText(chartBucketLabel(plotPoints[index].bucket, longRange), x, height - 9);
      }
    });
  });
  canvas.onpointermove = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width ? canvas.width / bounds.width : 1;
    const scaleY = canvas.height ? canvas.height / bounds.height : 1;
    const pointerX = (event.clientX - bounds.left) * scaleX;
    const pointerY = (event.clientY - bounds.top) * scaleY;
    const hit = points.reduce((nearest, point) => {
      const distance = Math.hypot(point.x - pointerX, point.y - pointerY);
      return distance < nearest.distance ? { point, distance } : nearest;
    }, { point: null, distance: 18 * Math.max(scaleX, scaleY) });
    if (!hit.point) {
      tooltip.classList.add('hidden');
      return;
    }
    const label = chartBucketDescription(hit.point.bucket);
    const details = hit.point.records.map((record) =>
      `${record.title || 'Lari'} · ${record.pace}${record.distanceKm ? ` · ${numberFormat.format(record.distanceKm)} km` : ''}`);
    if (longRange) {
      const averagePace = `${Math.floor(hit.point.value / 60)}:${String(hit.point.value % 60).padStart(2, '0')} /km`;
      chartTooltip(canvas, tooltip, event,
        `${label}\nRata-rata ${averagePace} · ${hit.point.records.length} aktivitas\n${details.slice(0, 5).join('\n')}${details.length > 5 ? `\n+${details.length - 5} aktivitas lain` : ''}`);
    } else {
      chartTooltip(canvas, tooltip, event, `${label}\n${details[0]}`);
    }
  };
  canvas.onpointerleave = () => tooltip.classList.add('hidden');
}

function measurementForDate(date) {
  const key = dateKey(date);
  return activeMeasurements()
    .filter((measurement) => measurement.date <= key)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function parseDurationMinutes(value) {
  const match = String(value || '').trim().match(/^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const total = hours * 60 + minutes + seconds / 60;
  return total > 0 ? total : null;
}

function estimateWorkoutCalories(type, movingTime, weightKg) {
  const durationMinutes = parseDurationMinutes(movingTime);
  const met = ACTIVITY_MET[type] || ACTIVITY_MET.other;
  if (!durationMinutes || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  return Math.round((met * 3.5 * weightKg * durationMinutes) / 200);
}

function updateCalorieEstimate() {
  const type = $('#workout-type').value;
  const weight = measurementForDate($('#workout-date').value);
  const estimate = weight
    ? estimateWorkoutCalories(type, $('#log-form').elements.namedItem('movingTime').value, Number(weight.weightKg))
    : null;
  const note = $('#calorie-estimate-note');
  const button = $('#estimate-calories');
  if (estimate === null) {
    note.textContent = weight
      ? 'Isi durasi dengan format MM:SS atau HH:MM:SS untuk menghitung estimasi.'
      : 'Catat berat badan pada atau sebelum tanggal olahraga untuk menghitung estimasi.';
    button.disabled = true;
    delete button.dataset.estimate;
    return;
  }
  note.textContent = `Perkiraan sekitar ${numberFormat.format(estimate)} kcal · berat ${numberFormat.format(weight.weightKg)} kg. Hasil dapat berbeda dari kalori aktual.`;
  button.disabled = false;
  button.dataset.estimate = String(estimate);
}

function renderBodyTracking() {
  const measurements = activeMeasurements().sort((a, b) => b.date.localeCompare(a.date));
  const latest = measurements[0];
  if (latest) {
    const bmi = Number(latest.weightKg) / ((Number(latest.heightCm) / 100) ** 2);
    $('#current-bmi').textContent = Number.isFinite(bmi) ? numberFormat.format(bmi) : '—';
  } else {
    $('#current-bmi').textContent = '—';
  }
  const list = $('#body-measurement-list');
  if (!editingMeasurementId && latest && !$('#body-form').elements.namedItem('heightCm').value) {
    $('#body-form').elements.namedItem('heightCm').value = latest.heightCm;
  }
  list.replaceChildren();
  measurements.slice(0, visibleMeasurements).forEach((measurement) => {
    const item = document.createElement('div');
    item.className = 'body-measurement-item';
    const detail = document.createElement('div');
    detail.className = 'body-measurement-detail';
    const value = document.createElement('strong');
    value.textContent = `${numberFormat.format(measurement.weightKg)} kg · ${numberFormat.format(measurement.heightCm)} cm`;
    const date = document.createElement('small');
    date.textContent = new Date(`${measurement.date}T12:00:00`).toLocaleDateString('id-ID', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
    if (measurement.pending) date.textContent += ' · belum sinkron';
    detail.append(value, date);
    const actions = document.createElement('div');
    actions.className = 'body-measurement-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit pengukuran ${date.textContent}`);
    edit.addEventListener('click', () => startEditingMeasurement(measurement));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-measurement';
    remove.textContent = 'Hapus';
    remove.setAttribute('aria-label', `Hapus pengukuran ${date.textContent}`);
    remove.addEventListener('click', () => deleteMeasurement(measurement));
    actions.append(edit, remove);
    item.append(detail, actions);
    list.append(item);
  });
  $('#empty-body-history').classList.toggle('hidden', measurements.length > 0);
  $('#load-more-body').classList.toggle('hidden', visibleMeasurements >= measurements.length);
  drawBodyChart(measurements);
  updateCalorieEstimate();
}

function drawBodyChart(measurements) {
  const canvas = $('#body-chart');
  const tooltip = $('#body-chart-tooltip');
  const points = measurements.slice().reverse();
  const caption = $('#body-chart-caption');
  if (points.length > 1) {
    const change = Number(points[points.length - 1].weightKg) - Number(points[0].weightKg);
    const sign = change > 0 ? '+' : '';
    caption.textContent = `${numberFormat.format(points[points.length - 1].weightKg)} kg · ${sign}${numberFormat.format(change)} kg sejak pengukuran pertama`;
  } else if (points.length === 1) {
    caption.textContent = `${numberFormat.format(points[0].weightKg)} kg · catat lagi untuk melihat perubahan`;
  } else {
    caption.textContent = 'Masukkan pengukuran untuk melihat progres.';
  }
  const hitAreas = [];
  drawCanvas(canvas, (context, width, height) => {
    const left = 35;
    const right = 10;
    const top = 14;
    const bottom = 25;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    context.font = '9px "DM Sans", sans-serif';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    if (!points.length) {
      context.fillStyle = '#9aa79b';
      context.textAlign = 'center';
      context.fillText('Belum ada data berat badan', width / 2, height / 2);
      return;
    }
    const values = points.map((point) => Number(point.weightKg));
    const min = Math.max(0, Math.floor(Math.min(...values) - 2));
    const max = Math.max(min + 4, Math.ceil(Math.max(...values) + 2));
    const pointX = (index) => points.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (points.length - 1);
    const pointY = (value) => top + ((max - value) / (max - min)) * plotHeight;
    for (const fraction of [0, 0.5, 1]) {
      const value = max - (max - min) * fraction;
      const y = top + plotHeight * fraction;
      context.strokeStyle = '#2a382e';
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = '#9aa79b';
      context.fillText(numberFormat.format(value), left - 6, y);
    }
    context.strokeStyle = chartColor('--blue');
    context.lineWidth = 2;
    context.beginPath();
    values.forEach((value, index) => {
      const x = pointX(index);
      const y = pointY(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    values.forEach((value, index) => {
      const x = pointX(index);
      const y = pointY(value);
      context.fillStyle = chartColor('--blue');
      context.beginPath();
      context.arc(x, y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#9aa79b';
      context.textAlign = 'center';
      const date = new Date(`${points[index].date}T12:00:00`);
      if (points.length <= 8 || index === 0 || index === points.length - 1
        || index % Math.ceil(points.length / 6) === 0) {
        context.fillText(date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }), x, height - 9);
      }
      const bmi = Number(points[index].weightKg) / ((Number(points[index].heightCm) / 100) ** 2);
      hitAreas.push({
        x,
        y,
        text: `${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\nBerat: ${numberFormat.format(value)} kg\nTinggi: ${numberFormat.format(points[index].heightCm)} cm · BMI ${numberFormat.format(bmi)}`,
      });
    });
  });
  canvas.onpointermove = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const hit = hitAreas.find((point) => Math.hypot(point.x - x, point.y - y) < 14);
    if (hit) chartTooltip(canvas, tooltip, event, hit.text);
    else tooltip.classList.add('hidden');
  };
  canvas.onpointerleave = () => tooltip.classList.add('hidden');
}

function startEditingMeasurement(measurement) {
  editingMeasurementId = measurement.id;
  $('#body-date').value = measurement.date;
  $('#body-form').elements.namedItem('heightCm').value = measurement.heightCm;
  $('#body-form').elements.namedItem('weightKg').value = measurement.weightKg;
  $('#save-body span:first-child').textContent = 'Simpan perubahan';
  $('#cancel-body-edit').classList.remove('hidden');
  $('#body-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetMeasurementForm() {
  $('#body-form').reset();
  $('#body-date').value = localDateKey();
  const latest = activeMeasurements().sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) $('#body-form').elements.namedItem('heightCm').value = latest.heightCm;
  editingMeasurementId = null;
  $('#save-body span:first-child').textContent = 'Simpan pengukuran';
  $('#cancel-body-edit').classList.add('hidden');
}

async function saveMeasurement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const previous = editingMeasurementId
    ? activeMeasurements().find((measurement) => measurement.id === editingMeasurementId)
    : null;
  const measurement = {
    id: previous?.id || createId(),
    date: form.elements.namedItem('date').value,
    heightCm: Number(form.elements.namedItem('heightCm').value),
    weightKg: Number(form.elements.namedItem('weightKg').value),
    createdAt: previous?.createdAt || new Date().toISOString(),
    pending: true,
    pendingAction: 'saveMeasurement',
  };
  const button = $('#save-body');
  button.disabled = true;
  try {
    bodyMeasurements = previous
      ? bodyMeasurements.map((item) => item.id === measurement.id ? measurement : item)
      : [measurement, ...bodyMeasurements];
    bodyMeasurements.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    persistBodyMeasurements();
    resetMeasurementForm();
    renderBodyTracking();
    renderSummary();
    if (!navigator.onLine) {
      setSyncState('offline', 'Offline · pengukuran tersimpan');
      notify('Pengukuran tersimpan di perangkat dan akan disinkronkan saat online.');
      return;
    }
    await syncPendingBodyMeasurements();
    setSyncState('online', 'Tersinkron ke Google Sheets');
    render();
    notify(previous ? 'Pengukuran berhasil diperbarui.' : 'Pengukuran berhasil disimpan.');
  } catch (error) {
    showSyncError(error);
    notify(`${error.message} Pengukuran tetap dicadangkan di perangkat.`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function deleteMeasurement(measurement) {
  if (!window.confirm(`Hapus pengukuran ${numberFormat.format(measurement.weightKg)} kg pada ${measurement.date}?`)) return;
  if (editingMeasurementId === measurement.id) resetMeasurementForm();
  bodyMeasurements = bodyMeasurements.map((item) => item.id === measurement.id
    ? { ...item, deleted: true, pending: true, pendingAction: 'deleteMeasurement' }
    : item);
  persistBodyMeasurements();
  render();
  if (!navigator.onLine) {
    setSyncState('offline', 'Offline · penghapusan menunggu sinkronisasi');
    notify('Pengukuran dihapus dari tampilan dan akan disinkronkan saat online.');
    return;
  }
  try {
    await syncPendingBodyMeasurements();
    setSyncState('online', 'Tersinkron ke Google Sheets');
    render();
    notify('Pengukuran berhasil dihapus.');
  } catch (error) {
    showSyncError(error);
    notify(`${error.message} Penghapusan akan dicoba lagi saat online.`, 'error');
  }
}

function formatActivityDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function filteredRecords() {
  const filter = $('#history-filter').value;
  const visible = activeRecords();
  if (filter === 'all') return visible;
  const days = Number(filter);
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() - (days - 1));
  const earliestKey = localDateKey(earliest);
  return visible.filter((record) => dateKey(record.date) >= earliestKey);
}

function renderHistory() {
  const list = $('#activity-list');
  const filtered = filteredRecords();
  const shown = filtered.slice(0, visibleRecords);
  list.replaceChildren();

  for (const record of shown) {
    const subtype = activityType(record);
    const activity = ACTIVITY_TYPES[subtype];
    const item = document.createElement('article');
    item.className = 'activity-item';
    const icon = document.createElement('span');
    icon.className = `activity-icon${record.type === 'workout' ? ' workout' : ''}`;
    icon.textContent = record.type === 'workout' ? activity.icon : '＋';
    icon.setAttribute('aria-hidden', 'true');

    const main = document.createElement('div');
    main.className = 'activity-main';
    const title = document.createElement('strong');
    title.textContent = record.title || (record.type === 'workout' ? activityLabel(record) : 'Makanan');
    if (record.pending) {
      const pending = document.createElement('span');
      pending.className = 'pending-badge';
      pending.textContent = 'belum sinkron';
      title.append(pending);
    }
    const details = document.createElement('small');
    const detailParts = [formatActivityDate(record.date)];
    if (record.type === 'workout') detailParts.push(activityLabel(record));
    if (record.type === 'workout' && Number(record.distanceKm)) detailParts.push(`${numberFormat.format(record.distanceKm)} km`);
    if (record.type === 'workout' && Number(record.activityValue)) {
      detailParts.push(`${numberFormat.format(record.activityValue)} ${record.activityUnit || ''}`.trim());
    }
    if (record.type === 'workout' && record.pace) detailParts.push(`${record.pace}`);
    if (record.type === 'meal') detailParts.push(`${numberFormat.format(record.protein || 0)}g protein`);
    details.textContent = detailParts.join(' · ');
    main.append(title, details);

    const value = document.createElement('div');
    value.className = 'activity-value';
    const calories = document.createElement('strong');
    calories.textContent = `${record.type === 'workout' ? '−' : '+'}${numberFormat.format(record.calories || 0)} kcal`;
    const kind = document.createElement('small');
    kind.textContent = record.type === 'workout' ? 'Terbakar' : 'Asupan';
    const edit = document.createElement('button');
    edit.className = 'edit-record';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${record.type === 'workout' ? 'aktivitas' : 'makanan'} ${record.title || ''}`);
    edit.addEventListener('click', () => startEditingRecord(record));
    const remove = document.createElement('button');
    remove.className = 'delete-record';
    remove.type = 'button';
    remove.textContent = 'Hapus';
    remove.setAttribute('aria-label', `Hapus ${record.type === 'workout' ? 'aktivitas' : 'makanan'} ${record.title || ''}`);
    remove.addEventListener('click', () => deleteRecord(record));
    const actions = document.createElement('div');
    actions.className = 'record-actions';
    actions.append(edit, remove);
    value.append(calories, kind, actions);
    item.append(icon, main, value);
    list.append(item);
  }

  $('#empty-history').classList.toggle('hidden', filtered.length > 0);
  $('#load-more').classList.toggle('hidden', shown.length >= filtered.length);
}

function render() {
  $('#today-label').textContent = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date());
  renderSummary();
  drawMileageChart();
  drawActivityChart();
  drawCalorieHistoryChart();
  drawPaceChart();
  renderBodyTracking();
  renderHistory();
}

function applyOcrFields(fields) {
  if (fields.title) $('#workout-title').value = fields.title;
  if (fields.date) $('#workout-date').value = fields.date;
  if (fields.activityType && $('#workout-type').value !== 'custom') {
    $('#workout-type').value = fields.activityType;
    updateWorkoutFields();
  }
  if (fields.distanceKm) logForm.elements.namedItem('distanceKm').value = fields.distanceKm;
  if (fields.pace) logForm.elements.namedItem('pace').value = fields.pace;
  if (fields.movingTime) logForm.elements.namedItem('movingTime').value = fields.movingTime;
  if (fields.elevationM) logForm.elements.namedItem('elevationM').value = fields.elevationM;
}

function setupOcr() {
  const imageInputs = [$('#strava-image-file'), $('#strava-image-camera')];
  const imagePreview = $('#image-preview');
  const button = $('#ocr-button');
  const status = $('#ocr-status');
  const progressTrack = $('#ocr-progress-track');
  const progressBar = $('#ocr-progress');
  let selectedImageFile = null;

  const runOcr = async (file) => {
    button.disabled = true;
    progressTrack.classList.remove('hidden');
    status.textContent = 'Membaca screenshot...';
    progressBar.style.width = '0%';
    try {
      const result = await recognizeStravaScreenshot(file, (progress) => {
        progressBar.style.width = `${Math.round(progress * 100)}%`;
      });
      applyOcrFields(result.fields);
      const fieldLabels = {
        title: 'judul',
        date: 'tanggal',
        activityType: 'jenis olahraga',
        distanceKm: 'jarak',
        pace: 'pace',
        movingTime: 'waktu',
        elevationM: 'elevasi',
      };
      const found = Object.entries(result.fields)
        .filter(([, value]) => value)
        .map(([key]) => fieldLabels[key]);
      status.textContent = found.length
        ? `Otomatis terisi: ${found.join(', ')}. Periksa kembali sebelum menyimpan.`
        : 'Gambar terbaca, tetapi data aktivitas belum dikenali. Isi formulir secara manual atau coba gambar lain.';
      notify(
        found.length ? 'Data screenshot terisi otomatis. Periksa kembali hasilnya.' : 'Data aktivitas tidak ditemukan pada screenshot.',
        found.length ? 'success' : 'error',
      );
    } catch (error) {
      status.textContent = error.message;
      notify(error.message, 'error');
    } finally {
      button.disabled = false;
      progressTrack.classList.add('hidden');
    }
  };

  imageInputs.forEach((imageInput) => imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    imageInput.value = '';
    if (!file) return;
    selectedImageFile = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    imagePreview.src = previewUrl;
    imagePreview.classList.remove('hidden');
    button.classList.remove('hidden');
    status.textContent = 'Screenshot dipilih. Membaca data aktivitas secara otomatis...';
    runOcr(file);
  }));

  button.addEventListener('click', async () => {
    if (!selectedImageFile) return;
    await runOcr(selectedImageFile);
  });
}

function stravaDateValue(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
    : null;
}

function isSevenHourStravaDateCorrection(previousDate, importedDate) {
  const previous = stravaDateValue(previousDate);
  const imported = stravaDateValue(importedDate);
  return previous !== null && imported !== null && imported - previous === 7 * 60 * 60 * 1000;
}

function setupStravaImport() {
  const fileInput = $('#strava-archive');
  const button = $('#strava-import-button');
  const status = $('#strava-import-status');
  button.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    button.disabled = true;
    status.textContent = 'Memeriksa arsip Strava...';
    try {
      const { activities: parsedActivities, duplicateRows } = await parseStravaZip(file);
      if (navigator.onLine) {
        try {
          const result = await requestApi('GET', { action: 'logs' });
          mergeRecords(Array.isArray(result.logs) ? result.logs : []);
        } catch (error) {
          console.warn('Pemeriksaan duplikasi Google Sheets gagal; server akan memeriksa ID saat impor:', error);
        }
        try {
          const result = await requestApi('GET', { action: 'measurements' });
          mergeBodyMeasurements(Array.isArray(result.measurements) ? result.measurements : []);
        } catch (error) {
          console.warn('Pengukuran Google Sheets tidak dapat diambil; estimasi kalori memakai backup lokal:', error);
        }
      }

      const existingIds = new Set(records.map((record) => record.id));
      const activities = parsedActivities.map((activity) => {
        if (Number(activity.calories) > 0) return activity;
        const measurement = measurementForDate(activity.date);
        const estimate = measurement
          ? estimateWorkoutCalories(activity.activityType, activity.movingTime, Number(measurement.weightKg))
          : null;
        return estimate ? { ...activity, calories: estimate } : activity;
      });
      const existingById = new Map(records.map((record) => [record.id, record]));
      const newActivities = activities.filter((activity) => !existingIds.has(activity.id));
      const archiveIds = new Set(activities.map((activity) => activity.id));
      const pendingActivities = records.filter((record) => record.pending
        && record.id.startsWith('strava-') && archiveIds.has(record.id));
      const pendingIds = new Set(pendingActivities.map((record) => record.id));
      const calorieCorrections = activities.filter((activity) => {
        const existing = existingById.get(activity.id);
        return existing && Number(existing.calories) <= 0 && Number(activity.calories) > 0;
      });
      const distanceCorrections = activities.filter((activity) => {
        const existing = existingById.get(activity.id);
        const oldDistance = Number(existing?.distanceKm) || 0;
        const importedDistance = Number(activity.distanceKm) || 0;
        return existing && importedDistance > 0 && oldDistance <= importedDistance / 100;
      });
      const dateCorrections = activities.filter((activity) => {
        const existing = existingById.get(activity.id);
        return existing && activity.id.startsWith('strava-')
          && isSevenHourStravaDateCorrection(existing.date, activity.date);
      });
      const queuedById = new Map([...newActivities, ...pendingActivities, ...calorieCorrections, ...distanceCorrections, ...dateCorrections]
        .map((activity) => [activity.id, activity]));
      const queuedActivities = [...queuedById.values()];
      const localDuplicates = activities.filter((activity) => existingIds.has(activity.id)
        && !pendingIds.has(activity.id)
        && !calorieCorrections.some((item) => item.id === activity.id)
        && !distanceCorrections.some((item) => item.id === activity.id)
        && !dateCorrections.some((item) => item.id === activity.id)).length;
      if (!queuedActivities.length) {
        const duplicates = duplicateRows + localDuplicates;
        const missingCalories = activities.filter((activity) => !Number(activity.calories)
          && !(Number(existingById.get(activity.id)?.calories) > 0)).length;
        status.textContent = `Tidak ada aktivitas baru. ${duplicates} aktivitas sudah ada atau berulang di arsip${missingCalories ? `; ${missingCalories} aktivitas tanpa kalori belum bisa dihitung karena durasi atau berat badan tidak tersedia` : ''}.`;
        notify('Semua aktivitas dari arsip ini sudah pernah diimpor.', 'success');
        return;
      }

      records = [...newActivities, ...records].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const calorieCorrectionById = new Map(calorieCorrections.map((activity) => [activity.id, activity.calories]));
      const distanceCorrectionById = new Map(distanceCorrections.map((activity) => [activity.id, activity.distanceKm]));
      const dateCorrectionById = new Map(dateCorrections.map((activity) => [activity.id, activity.date]));
      const retryIds = new Set([...pendingActivities, ...calorieCorrections, ...distanceCorrections, ...dateCorrections]
        .map((activity) => activity.id));
      if (retryIds.size) {
        records = records.map((record) => retryIds.has(record.id)
          ? {
            ...record,
            ...(calorieCorrectionById.has(record.id) ? { calories: calorieCorrectionById.get(record.id) } : {}),
            ...(distanceCorrectionById.has(record.id) ? { distanceKm: distanceCorrectionById.get(record.id) } : {}),
            ...(dateCorrectionById.has(record.id) ? { date: dateCorrectionById.get(record.id) } : {}),
            pending: true,
            pendingAction: 'append',
          }
          : record);
      }
      persistRecords();
      render();

      if (!navigator.onLine) {
        status.textContent = `${queuedActivities.length} aktivitas tersimpan di perangkat dan menunggu koneksi untuk disinkronkan.`;
        setSyncState('offline', 'Offline · impor Strava menunggu sinkronisasi');
        notify(`${queuedActivities.length} aktivitas disimpan lokal; akan disinkronkan saat online.`);
        return;
      }

      try {
        const result = await syncStravaRecords(queuedActivities);
        const duplicates = duplicateRows + localDuplicates + result.duplicateCount;
        const missingCalories = activities.filter((activity) => !Number(activity.calories)
          && !(Number(existingById.get(activity.id)?.calories) > 0)).length;
        const outcomes = [
          result.importedCount ? `${result.importedCount} aktivitas baru` : '',
          result.updatedCount ? `${result.updatedCount} aktivitas diperbarui dengan estimasi kalori` : '',
          result.updatedDistanceCount ? `${result.updatedDistanceCount} aktivitas diperbaiki jaraknya` : '',
          result.updatedDateCount ? `${result.updatedDateCount} waktu aktivitas dikoreksi ke WIB` : '',
          duplicates ? `${duplicates} duplikat dilewati` : '',
          missingCalories ? `${missingCalories} aktivitas tetap 0 kcal karena durasi atau berat badan tidak tersedia` : '',
        ].filter(Boolean);
        status.textContent = `Selesai: ${outcomes.join('; ') || 'tidak ada perubahan'}.`;
        setSyncState('online', 'Tersinkron ke Google Sheets');
        notify(`Impor Strava selesai: ${outcomes.join('; ') || 'tidak ada perubahan'}.`);
      } catch (error) {
        status.textContent = `${newActivities.length} aktivitas tersimpan di perangkat, tetapi sinkronisasi gagal: ${error.message}`;
        showSyncError(error);
        notify(`Aktivitas tersimpan lokal; sinkronisasi Strava tertunda: ${error.message}`, 'error');
      }
    } catch (error) {
      status.textContent = error.message || 'Arsip Strava tidak dapat dibaca.';
      notify(status.textContent, 'error');
    } finally {
      fileInput.value = '';
      button.disabled = false;
    }
  });
}

function applyNutritionFields(fields) {
  for (const key of ['calories', 'protein', 'carbs', 'fat', ...NUTRIENT_FIELDS]) {
    if (fields[key] !== '' && fields[key] !== null && fields[key] !== undefined) {
      const input = key === 'calories' ? $('#meal-calories') : logForm.elements.namedItem(key);
      if (input instanceof HTMLInputElement) input.value = fields[key];
    }
  }
  if (fields.foodName) $('#meal-title').value = fields.servingDescription
    ? `${fields.foodName} (${fields.servingDescription})`
    : fields.foodName;
}

function setupFoodScanner() {
  const labelInputs = [$('#food-label-file'), $('#food-label-camera')];
  const photoInputs = [$('#food-photo-file'), $('#food-photo-camera')];
  const preview = $('#food-image-preview');
  const status = $('#food-scan-status');
  const progressTrack = $('#food-scan-progress-track');
  const progressBar = $('#food-scan-progress');
  const retryButton = $('#food-label-retry');
  let selectedLabelFile = null;

  const showPreview = (file) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.classList.remove('hidden');
  };

  const scanLabel = async (file) => {
    retryButton.disabled = true;
    progressTrack.classList.remove('hidden');
    status.textContent = 'Membaca label gizi...';
    progressBar.style.width = '0%';
    try {
      const { fields } = await recognizeFoodLabel(file, (progress) => {
        progressBar.style.width = `${Math.round(progress * 100)}%`;
      });
      applyNutritionFields(fields);
      const found = Object.entries(fields).filter(([, value]) => value).length;
      status.textContent = found
        ? `Label dibaca. ${found} nilai gizi terisi; cocokkan dengan takaran saji pada kemasan.`
        : 'Angka gizi belum terbaca. Coba foto label lebih dekat dan terang, atau isi manual.';
      notify(
        found ? 'Hasil scan label siap diperiksa.' : 'Nilai gizi tidak terbaca dari label.',
        found ? 'success' : 'error',
      );
    } catch (error) {
      status.textContent = error.message;
      notify(error.message, 'error');
    } finally {
      retryButton.disabled = false;
      progressTrack.classList.add('hidden');
    }
  };

  labelInputs.forEach((input) => input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    selectedLabelFile = file;
    showPreview(file);
    retryButton.classList.remove('hidden');
    scanLabel(file);
  }));
  retryButton.addEventListener('click', () => {
    if (selectedLabelFile) scanLabel(selectedLabelFile);
  });

  photoInputs.forEach((input) => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    showPreview(file);
    progressTrack.classList.add('hidden');
    status.textContent = 'Mengirim foto untuk estimasi nutrisi...';
    try {
      const image = await prepareFoodPhoto(file);
      const request = { action: 'estimateFood', image };
      try {
        const preferredModel = localStorage.getItem(GEMINI_NEXT_MODEL_KEY);
        if (preferredModel) request.preferredModel = preferredModel;
      } catch (error) {
        console.warn('Preferensi rotasi model Gemini tidak dapat dibaca:', error);
      }
      const result = await requestApi('POST', {}, request);
      if (result.nextModel) {
        try {
          localStorage.setItem(GEMINI_NEXT_MODEL_KEY, result.nextModel);
        } catch (error) {
          console.warn('Preferensi rotasi model Gemini tidak dapat disimpan:', error);
        }
      }
      applyNutritionFields(result.food || {});
      const confidence = Number(result.food?.confidence);
      const confidenceText = Number.isFinite(confidence)
        ? ` Tingkat keyakinan AI: ${Math.round(confidence * 100)}%.`
        : '';
      const modelText = result.model
        ? result.fallbackUsed
          ? ` Model sebelumnya sedang tidak tersedia; otomatis dialihkan ke ${result.model}.`
          : ` Model: ${result.model}.`
        : '';
      status.textContent = `${result.food?.notes || 'Estimasi selesai.'}${confidenceText}${modelText} Periksa porsi dan nilai sebelum menyimpan.`;
      notify('Estimasi gizi terisi. Pastikan periksa porsi dan hasilnya.', 'success');
    } catch (error) {
      if (error.response?.nextModel) {
        try {
          localStorage.setItem(GEMINI_NEXT_MODEL_KEY, error.response.nextModel);
        } catch (storageError) {
          console.warn('Preferensi rotasi model Gemini tidak dapat disimpan:', storageError);
        }
      }
      status.textContent = error.message;
      notify(error.message, 'error');
    }
  }));
}

function buildFitnessCoachSummary() {
  const today = localDateKey();
  const workoutStart = weekDateKeys(-7)[0];
  const nutritionStartDate = new Date(`${today}T12:00:00`);
  nutritionStartDate.setDate(nutritionStartDate.getDate() - 13);
  const nutritionStart = localDateKey(nutritionStartDate);
  const recentWorkouts = activeRecords().filter((record) => record.type === 'workout'
    && dateKey(record.date) >= workoutStart && dateKey(record.date) <= today);
  const weeklyActivity = Array.from({ length: 8 }, (_, index) => {
    const week = weekDateKeys(index - 7);
    const entries = recentWorkouts.filter((record) => dateKey(record.date) >= week[0]
      && dateKey(record.date) <= week[6]);
    const runs = entries.filter((record) => activityType(record) === 'run');
    const paces = runs
      .filter((record) => /\/\s*km\b/i.test(String(record.pace || '')))
      .map((record) => paceSeconds(record.pace))
      .filter((value) => value !== null);
    const averagePaceSeconds = paces.length
      ? Math.round(paces.reduce((total, value) => total + value, 0) / paces.length)
      : null;
    return {
      weekOf: week[0],
      activityCount: entries.length,
      runCount: runs.length,
      runDistanceKm: Number(sum(runs, 'distanceKm').toFixed(2)),
      longestRunKm: runs.length
        ? Number(Math.max(...runs.map((run) => Number(run.distanceKm) || 0)).toFixed(2))
        : null,
      averageRunPacePerKm: averagePaceSeconds !== null
        ? `${Math.floor(averagePaceSeconds / 60)}:${String(averagePaceSeconds % 60).padStart(2, '0')} /km`
        : null,
    };
  });
  const sportCounts = {};
  for (const workout of recentWorkouts) {
    const type = activityType(workout);
    const label = type === 'custom' ? 'Custom' : ACTIVITY_TYPES[type]?.label || 'Olahraga lainnya';
    sportCounts[label] = (sportCounts[label] || 0) + 1;
  }

  const recentMeals = activeRecords().filter((record) => record.type === 'meal'
    && dateKey(record.date) >= nutritionStart && dateKey(record.date) <= today);
  const mealDays = new Set(recentMeals.map((record) => dateKey(record.date)));
  const nutritionKeys = ['calories', 'protein', 'carbs', 'fat', 'fiberG', 'sugarG', 'sodiumMg'];
  const nutritionAverages = Object.fromEntries(nutritionKeys.map((key) => [
    key,
    mealDays.size ? Number((sum(recentMeals, key) / mealDays.size).toFixed(1)) : null,
  ]));

  return {
    period: { from: workoutStart, to: today },
    workouts: {
      activityCount: recentWorkouts.length,
      activeDays: new Set(recentWorkouts.map((record) => dateKey(record.date))).size,
      bySport: sportCounts,
      weeklyRunning: weeklyActivity,
      runningGoal: {
        value: goals.weeklyKm,
        period: goals.goalPeriods?.weeklyKm || 'weekly',
      },
    },
    nutrition: {
      periodDays: 14,
      loggedDays: mealDays.size,
      averagesPerLoggedDay: nutritionAverages,
      dataQualityNote: 'Kolom nutrisi yang tidak diisi tersimpan sebagai 0; rerata makro dan mikronutrien dapat lebih rendah jika pencatatan tidak lengkap.',
      dailyTargets: {
        calories: goals.calories,
        protein: goals.protein,
        carbs: goals.carbs,
        fat: goals.fat,
      },
    },
  };
}

function setupFitnessCoach() {
  const form = $('#fitness-coach-form');
  const questionInput = $('#fitness-coach-question');
  const sendButton = $('#fitness-coach-send');
  const messagesElement = $('#fitness-coach-messages');
  const status = $('#fitness-coach-status');
  const conversation = [];

  const appendFormattedText = (parent, text) => {
    const formatting = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|`([^`\n]+)`)/g;
    let lastIndex = 0;
    for (const match of text.matchAll(formatting)) {
      if (match.index > lastIndex) {
        parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const element = document.createElement(match[5] ? 'code' : match[4] ? 'em' : 'strong');
      element.textContent = match[2] || match[3] || match[4] || match[5];
      parent.append(element);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parent.append(document.createTextNode(text.slice(lastIndex)));
    }
  };

  const renderCoachAnswer = (element, text) => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line) {
        index += 1;
        continue;
      }

      const heading = line.match(/^#{1,3}\s+(.+?)\s*#*$/);
      if (heading) {
        const title = document.createElement('h3');
        appendFormattedText(title, heading[1]);
        element.append(title);
        index += 1;
        continue;
      }

      const listItem = line.match(/^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/);
      if (listItem) {
        const ordered = /^\d+[.)]\s+/.test(line);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length) {
          const item = lines[index].trim().match(/^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/);
          if (!item || /^\d+[.)]\s+/.test(lines[index].trim()) !== ordered) break;
          const entry = document.createElement('li');
          appendFormattedText(entry, item[1]);
          list.append(entry);
          index += 1;
        }
        element.append(list);
        continue;
      }

      const paragraphLines = [line];
      index += 1;
      while (index < lines.length && lines[index].trim()
        && !/^#{1,3}\s+/.test(lines[index].trim())
        && !/^(?:[-*•]\s+|\d+[.)]\s+)/.test(lines[index].trim())) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      const paragraph = document.createElement('p');
      appendFormattedText(paragraph, paragraphLines.join(' '));
      element.append(paragraph);
    }
  };

  const addMessage = (role, text) => {
    messagesElement.querySelector('.fitness-coach-empty')?.remove();
    const message = document.createElement('div');
    message.className = 'fitness-coach-message';
    message.dataset.role = role;
    if (role === 'assistant') renderCoachAnswer(message, text);
    else message.textContent = text;
    messagesElement.append(message);
    while (messagesElement.children.length > 20) messagesElement.firstElementChild.remove();
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return message;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = questionInput.value.trim();
    if (!question) return;
    sendButton.disabled = true;
    questionInput.disabled = true;
    status.dataset.kind = '';
    status.textContent = 'AI sedang membaca ringkasan progresmu...';
    const pendingQuestion = addMessage('user', question);
    try {
      const result = await requestApi('POST', {}, {
        action: 'fitnessCoach',
        question,
        history: conversation.slice(-8),
        summary: buildFitnessCoachSummary(),
      }, 45000);
      if (typeof result.answer !== 'string' || !result.answer.trim()) {
        throw new Error('AI mengirim jawaban kosong. Coba tanyakan lagi.');
      }
      conversation.push({ role: 'user', text: question }, { role: 'model', text: result.answer });
      while (conversation.length > 8) conversation.splice(0, 2);
      addMessage('assistant', result.answer.trim());
      questionInput.value = '';
      status.textContent = result.model ? `Dijawab oleh ${result.model}.` : 'Jawaban AI siap.';
    } catch (error) {
      pendingQuestion.remove();
      status.dataset.kind = 'error';
      status.textContent = error.message || 'AI tidak dapat menjawab saat ini.';
    } finally {
      sendButton.disabled = false;
      questionInput.disabled = false;
      questionInput.focus();
    }
  });

  document.querySelectorAll('.coach-prompt').forEach((button) => {
    button.addEventListener('click', () => {
      questionInput.value = button.textContent.trim();
      form.requestSubmit();
    });
  });
}

function initialize() {
  setDefaultDates();
  const currentWeek = weekDateKeys(0);
  activityChartDateRange = { start: currentWeek[0], end: currentWeek[6] };
  paceChartDateRange = { ...activityChartDateRange };
  const calorieHistoryEnd = localDateKey();
  const calorieHistoryStartDate = new Date(`${calorieHistoryEnd}T12:00:00`);
  calorieHistoryStartDate.setDate(calorieHistoryStartDate.getDate() - 29);
  calorieHistoryDateRange = { start: localDateKey(calorieHistoryStartDate), end: calorieHistoryEnd };
  $('#activity-chart-from').value = activityChartDateRange.start;
  $('#activity-chart-to').value = activityChartDateRange.end;
  $('#pace-chart-from').value = paceChartDateRange.start;
  $('#pace-chart-to').value = paceChartDateRange.end;
  $('#calorie-history-from').value = calorieHistoryDateRange.start;
  $('#calorie-history-to').value = calorieHistoryDateRange.end;
  setupChartDateRange('calorie-history-range-form', 'calorie-history-range-status', (range) => {
    calorieHistoryDateRange = range;
    drawCalorieHistoryChart();
  });
  setupChartActivityFilters('activity-chart-filters', selectedActivityChartTypes, drawActivityChart);
  setupChartActivityFilters('pace-chart-filters', selectedPaceChartTypes, drawPaceChart);
  setupFitnessCoach();
  resetMeasurementForm();
  updateGoalsForm();
  setEntryType('meal');
  document.querySelectorAll('[data-entry-tab]').forEach((tab) => {
    tab.addEventListener('click', () => setEntryType(tab.dataset.entryTab));
  });
  $('#workout-type').addEventListener('change', updateWorkoutFields);
  $('#workout-date').addEventListener('change', updateCalorieEstimate);
  logForm.elements.namedItem('movingTime').addEventListener('input', updateCalorieEstimate);
  $('#estimate-calories').addEventListener('click', () => {
    const estimate = Number($('#estimate-calories').dataset.estimate);
    if (!Number.isFinite(estimate) || estimate <= 0) {
      notify('Lengkapi durasi dan berat badan untuk menghitung estimasi kalori.', 'error');
      return;
    }
    document.querySelector('[data-entry-fields="workout"] [name="calories"]').value = String(estimate);
    notify('Estimasi kalori terisi. Nilai ini masih bisa Anda ubah.');
  });
  $('#body-form').addEventListener('submit', saveMeasurement);
  $('#cancel-body-edit').addEventListener('click', resetMeasurementForm);
  $('#load-more-body').addEventListener('click', () => {
    visibleMeasurements += 5;
    renderBodyTracking();
  });
  $('#week-previous').addEventListener('click', () => {
    selectedWeekOffset -= 1;
    render();
  });
  $('#week-next').addEventListener('click', () => {
    selectedWeekOffset = Math.min(0, selectedWeekOffset + 1);
    render();
  });
  setupChartDateRange('activity-chart-range-form', 'activity-chart-range-status', (range) => {
    activityChartDateRange = range;
    drawActivityChart();
  });
  setupChartDateRange('pace-chart-range-form', 'pace-chart-range-status', (range) => {
    paceChartDateRange = range;
    drawPaceChart();
  });
  $('#add-custom-target').addEventListener('click', () => addCustomTargetRow());
  $('#cancel-edit-button').addEventListener('click', () => {
    const type = editingRecordId
      ? activeRecords().find((record) => record.id === editingRecordId)?.type || 'meal'
      : 'meal';
    resetLogForm(type);
  });
  $('#custom-activity-name').addEventListener('input', (event) => {
    const target = goals.customTargets.find((item) => item.name.toLocaleLowerCase() === event.currentTarget.value.trim().toLocaleLowerCase());
    if (target) $('#activity-unit').value = target.unit;
  });
  logForm.addEventListener('submit', saveLog);
  $('#goals-form').addEventListener('submit', saveGoals);
  $('#goals-form').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-goal]');
    if (edit) {
      const row = edit.closest('.goal-setting-row');
      setGoalRowEditing(row, row.dataset.editing !== 'true');
      return;
    }
    const remove = event.target.closest('[data-remove-goal]');
    if (remove) {
      const key = remove.dataset.removeGoal;
      $('#goals-form').elements.namedItem(key).value = '0';
      syncGoalSettings();
      return;
    }
    const restore = event.target.closest('[data-restore-goal]');
    if (restore) {
      const key = restore.dataset.restoreGoal;
      $('#goals-form').elements.namedItem(key).value = GOAL_SETTINGS[key].defaultValue;
      syncGoalSettings();
      const row = document.querySelector(`[data-goal-setting="${key}"]`);
      setGoalRowEditing(row, true);
    }
  });
  $('#history-filter').addEventListener('change', () => {
    visibleRecords = 8;
    renderHistory();
  });
  $('#load-more').addEventListener('click', () => {
    visibleRecords += 8;
    renderHistory();
  });
  window.addEventListener('resize', () => {
    drawMileageChart();
    drawActivityChart();
    drawPaceChart();
    renderBodyTracking();
  });
  window.addEventListener('online', async () => {
    setSyncState('loading', 'Menyinkronkan...');
    try {
      await syncPendingRecords();
      await syncPendingBodyMeasurements();
      await loadFromSheet();
    } catch (error) {
      showSyncError(error);
      notify(error.message, 'error');
    }
  });
  setupOcr();
  setupStravaImport();
  setupFoodScanner();
  render();
  loadFromSheet();
}

document.addEventListener('DOMContentLoaded', initialize);
