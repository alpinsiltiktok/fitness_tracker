const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const MAX_CSV_SIZE = 10 * 1024 * 1024;
const MAX_ACTIVITIES = 5000;

async function readEntryBytes(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error('Arsip Strava rusak: header activities.csv tidak valid.');
  }
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) {
    throw new Error('Arsip Strava rusak: isi activities.csv terpotong.');
  }
  const compressed = bytes.slice(dataStart, dataEnd);
  if (entry.method === 0) {
    if (compressed.byteLength !== entry.uncompressedSize) {
      throw new Error('Arsip Strava rusak: ukuran activities.csv tidak cocok.');
    }
    return compressed;
  }
  if (entry.method !== 8 || typeof DecompressionStream !== 'function') {
    throw new Error('Format kompresi ZIP tidak didukung browser ini. Coba Chrome/Edge terbaru.');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_CSV_SIZE) {
      await reader.cancel();
      throw new Error('File activities.csv terlalu besar untuk diimpor.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(totalSize);
  let resultOffset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, resultOffset);
    resultOffset += chunk.byteLength;
  });
  if (result.byteLength !== entry.uncompressedSize) {
    throw new Error('Arsip Strava rusak: ukuran activities.csv tidak cocok.');
  }
  return result;
}

function findActivitiesEntry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.byteLength - 22 - 65535);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('File bukan arsip ZIP Strava yang valid.');

  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber || directoryDisk || diskEntries !== totalEntries || totalEntries === 0xffff
    || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('Arsip ZIP multi-disk atau ZIP64 belum didukung. Unduh ulang arsip Strava standar.');
  }

  let offset = directoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Arsip Strava rusak: daftar file ZIP tidak valid.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (name.split('/').pop().toLowerCase() === 'activities.csv') {
      if (flags & 1) throw new Error('activities.csv terkunci dengan password dan tidak dapat dibaca.');
      if (uncompressedSize > MAX_CSV_SIZE) throw new Error('File activities.csv terlalu besar untuk diimpor.');
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        throw new Error('File activities.csv menggunakan ZIP64 yang tidak didukung.');
      }
      return { compressedSize, method, localHeaderOffset, uncompressedSize };
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('File activities.csv tidak ditemukan. Pilih arsip ekspor data Strava lengkap.');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('activities.csv berisi kutipan teks yang tidak lengkap.');
  if (row.length || value) {
    row.push(value);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  if (rows.length < 2) throw new Error('activities.csv tidak berisi aktivitas.');
  return rows;
}

function numericValue(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const raw = String(value).trim();
  const normalized = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function localDateTime(value) {
  const exportDate = String(value || '').match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  const offsetMilliseconds = 7 * 60 * 60 * 1000;
  const two = (number) => String(number).padStart(2, '0');
  const formatUtcDate = (date) => `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}T${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
  if (exportDate) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(exportDate[1].toLowerCase());
    if (month < 0) return '';
    let hours = Number(exportDate[4]) % 12;
    if (exportDate[7].toUpperCase() === 'PM') hours += 12;
    const parsed = new Date(Date.UTC(
      Number(exportDate[3]), month, Number(exportDate[2]), hours, Number(exportDate[5]), Number(exportDate[6]),
    ) + offsetMilliseconds);
    return formatUtcDate(parsed);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatUtcDate(new Date(parsed.getTime() + offsetMilliseconds));
}

function durationValue(seconds) {
  if (seconds <= 0) return '';
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function normalizeActivityType(value) {
  const type = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (/run|trailrun/.test(type)) return 'run';
  if (/ride|cycling|bik(?:e|ing)|handcycle/.test(type)) return 'cycling';
  if (/swim/.test(type)) return 'swimming';
  if (/walk/.test(type)) return 'walking';
  if (/hike|mountaineering/.test(type)) return 'hiking';
  if (/row/.test(type)) return 'rowing';
  if (/yoga/.test(type)) return 'yoga';
  if (/workout|weighttraining|strength|crossfit/.test(type)) return 'strength';
  return 'other';
}

function createActivity(row, columnIndexes, index, seenIds) {
  const get = (name) => row[columnIndexes[name]] || '';
  const externalId = String(get('Activity ID')).trim();
  const date = localDateTime(get('Activity Date'));
  const title = String(get('Activity Name')).trim();
  if (!/^\d+$/.test(externalId)) throw new Error(`ID aktivitas tidak valid pada baris ${index + 2}.`);
  if (!date) throw new Error(`Tanggal aktivitas tidak valid pada baris ${index + 2}.`);
  if (!title) throw new Error(`Nama aktivitas kosong pada baris ${index + 2}.`);
  if (seenIds.has(externalId)) return null;
  seenIds.add(externalId);

  const rawActivityType = get('Activity Type') || get('Type');
  let activityType = normalizeActivityType(rawActivityType);
  if (/^(workout|free training)$/i.test(String(rawActivityType).trim())) {
    const specificType = [get('Type'), title]
      .map(normalizeActivityType)
      .find((type) => type !== 'other' && type !== 'strength');
    if (specificType) activityType = specificType;
  }
  const distanceKm = Math.max(0, numericValue(get('Distance')) / 1000);
  const movingSeconds = numericValue(get('Moving Time')) || numericValue(get('Elapsed Time'));
  const movingTime = durationValue(movingSeconds);
  const averageSpeed = numericValue(get('Average Speed'));
  let pace = '';
  if (distanceKm > 0 && movingSeconds > 0 && ['run', 'walking', 'hiking'].includes(activityType)) {
    const paceSeconds = Math.round(movingSeconds / distanceKm);
    pace = `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, '0')} /km`;
  } else if (averageSpeed > 0 && activityType === 'cycling') {
    pace = `${(averageSpeed * 3.6).toFixed(1)} km/h`;
  } else if (distanceKm > 0 && movingSeconds > 0 && activityType === 'swimming') {
    const paceSeconds = Math.round((movingSeconds / (distanceKm * 1000)) * 100);
    pace = `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, '0')} /100m`;
  }

  return {
    id: `strava-${externalId}`,
    type: 'workout',
    activityType,
    activityName: '',
    activityValue: 0,
    activityUnit: '',
    title: title.slice(0, 120),
    date,
    calories: Math.max(0, numericValue(get('Calories'))),
    protein: 0,
    carbs: 0,
    fat: 0,
    distanceKm,
    pace,
    movingTime,
    elevationM: Math.max(0, numericValue(get('Elevation Gain'))),
    createdAt: new Date().toISOString(),
    pending: true,
    pendingAction: 'append',
  };
}

function parseStravaCsvText(text) {
  const rows = parseCsv(String(text || '').replace(/^\uFEFF/, ''));
  if (rows.length - 1 > MAX_ACTIVITIES) throw new Error('Arsip berisi terlalu banyak aktivitas untuk sekali impor.');

  const headers = rows[0].map((header) => header.trim());
  const required = ['Activity ID', 'Activity Date', 'Activity Name', 'Activity Type'];
  const columnIndexes = {};
  const distanceColumnIndexes = [];
  headers.forEach((header, index) => {
    if (columnIndexes[header] === undefined) columnIndexes[header] = index;
    if (header === 'Distance') distanceColumnIndexes.push(index);
  });
  const missing = required.filter((header) => columnIndexes[header] === undefined);
  if (missing.length) throw new Error(`Kolom wajib tidak ditemukan di activities.csv: ${missing.join(', ')}.`);
  if (!distanceColumnIndexes.length) throw new Error('Kolom Distance tidak ditemukan di activities.csv.');
  if (distanceColumnIndexes.length > 1) columnIndexes.Distance = distanceColumnIndexes[1];

  const seenIds = new Set();
  const activities = rows.slice(1).map((row, index) => createActivity(row, columnIndexes, index, seenIds))
    .filter(Boolean);
  if (!activities.length) throw new Error('Tidak ada aktivitas valid yang dapat diimpor.');
  return { activities, duplicateRows: rows.length - 1 - seenIds.size };
}

async function parseStravaZip(file) {
  if (!file || !/\.zip$/i.test(file.name || '')) {
    throw new Error('Pilih file ZIP arsip ekspor Strava.');
  }
  if (file.size > MAX_ZIP_SIZE) throw new Error('Arsip Strava melebihi batas ukuran 100 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entry = findActivitiesEntry(bytes);
  const csvBytes = await readEntryBytes(bytes, entry);
  const csvText = new TextDecoder('utf-8', { fatal: false }).decode(csvBytes);
  return parseStravaCsvText(csvText);
}

export { parseStravaCsvText, parseStravaZip };
