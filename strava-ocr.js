const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const SPORT_PATTERNS = [
  { type: 'run', pattern: /\b(run|running|trail run)\b/i },
  { type: 'cycling', pattern: /\b(ride|riding|cycling|bike|biking|virtual ride)\b/i },
  { type: 'swimming', pattern: /\b(swim|swimming|pool swim|open water swim)\b/i },
  { type: 'walking', pattern: /\b(walk|walking)\b/i },
  { type: 'hiking', pattern: /\b(hike|hiking|mountaineering)\b/i },
  { type: 'rowing', pattern: /\b(row|rowing|virtual row)\b/i },
  { type: 'strength', pattern: /\b(workout|free training|weight training|strength training|crossfit)\b/i },
  { type: 'yoga', pattern: /\byoga\b/i },
];

function parseLocalDate(value) {
  const cleaned = value
    .replace(/\b(at|pukul)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) return '';
  const two = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function parseMetricNumber(value) {
  const normalized = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)
    ? value.replace(/,/g, '')
    : value.replace(',', '.');
  return Number(normalized);
}

function parseStravaText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const extracted = {
    title: '',
    date: '',
    activityType: '',
    distanceKm: '',
    pace: '',
    movingTime: '',
    elevationM: '',
  };

  const dateMatch = String(text || '').match(
    new RegExp(`\\b${MONTHS}\\s+\\d{1,2},?\\s+\\d{4}(?:\\s+(?:at\\s+)?\\d{1,2}:\\d{2}\\s*(?:AM|PM))?`, 'i'),
  );
  const isoDateMatch = String(text || '').match(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?/);
  const numericDateMatch = String(text || '').match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
  const rawDate = dateMatch?.[0] || isoDateMatch?.[0] || numericDateMatch?.[0];
  if (rawDate) extracted.date = parseLocalDate(rawDate);

  for (const line of lines) {
    const detectedSport = SPORT_PATTERNS.find(({ pattern }) => pattern.test(line));
    if (detectedSport) {
      extracted.activityType = detectedSport.type;
      break;
    }
  }

  const metricLines = new Set();
  for (const line of lines) {
    const isNonDistanceMetric = /\b(?:speed|pace|elev(?:ation)?|gain)\b/i.test(line);
    const distance = !isNonDistanceMetric && (
      line.match(/(?:distance\D{0,8})?(\d{1,4}(?:[.,]\d{1,3})?)\s*(km|mi)\b/i)
      || line.match(/(?:distance|pool length)\D{0,10}(\d{1,6}(?:[.,]\d+)?)\s*(m)\b/i)
    );
    if (distance) {
      const rawValue = distance[1];
      let value = parseMetricNumber(rawValue);
      if (Number.isFinite(value)) {
        const unit = distance[2].toLowerCase();
        if (/^\d{3}$/.test(rawValue) && (unit === 'km' || unit === 'mi')) {
          value /= 100;
        }
        const km = unit === 'mi' ? value * 1.609344 : unit === 'm' ? value / 1000 : value;
        extracted.distanceKm = km.toFixed(2);
        metricLines.add(line);
      }
    }

    const swimPace = line.match(/(\d{1,2}):([0-5]\d)\s*(?:min(?:utes?)?\s*)?\/\s*(100\s*m|100m)\b/i);
    const speed = line.match(/(\d{1,3}(?:[.,]\d+)?)\s*(km\/h|kmh|kph|mi\/h|mph)\b/i);
    const pace = line.match(/(\d{1,2}):([0-5]\d)\s*(?:min(?:utes?)?\s*)?\/\s*(km|mi)\b/i)
      || line.match(/(\d{1,2}):([0-5]\d)\s*(km|mi)\b/i);
    if (swimPace) {
      extracted.pace = `${Number(swimPace[1])}:${String(swimPace[2]).padStart(2, '0')} /100m`;
      metricLines.add(line);
    } else if (speed) {
      const unit = speed[2].toLowerCase();
      const normalizedUnit = unit.startsWith('mi') ? 'mph' : 'km/h';
      extracted.pace = `${speed[1].replace(',', '.')} ${normalizedUnit}`;
      metricLines.add(line);
    } else if (pace) {
      let paceSeconds = Number(pace[1]) * 60 + Number(pace[2]);
      if (pace[3].toLowerCase() === 'mi') paceSeconds /= 1.609344;
      const minutes = Math.floor(paceSeconds / 60);
      const seconds = Math.round(paceSeconds % 60);
      extracted.pace = `${minutes}:${String(seconds).padStart(2, '0')} /km`;
      metricLines.add(line);
    }

    const duration = line.match(/(?:moving time|elapsed time|duration|time)\D{0,10}((?:(\d{1,2}):)?([0-5]?\d):([0-5]\d))\b/i)
      || line.match(/\b((?:(\d{1,2}):)?([0-5]?\d):([0-5]\d))\b/);
    if (duration && !/\/\s*(?:km|mi)\b/i.test(line)) {
      const rawDuration = duration[1];
      extracted.movingTime = /^\d{1,2}:\d{2}:\d{2}$/.test(rawDuration)
        ? rawDuration
        : `${Number(duration[3])}:${String(duration[4]).padStart(2, '0')}`;
      metricLines.add(line);
    }

    const elevation = line.match(/(?:elev(?:ation)?(?:\s+gain)?|gain)\D{0,12}(\d{1,6}(?:[.,]\d+)?)\s*(m|ft)\b/i);
    if (elevation) {
      const value = parseMetricNumber(elevation[1]);
      const meters = elevation[2].toLowerCase() === 'ft' ? value * 0.3048 : value;
      extracted.elevationM = String(Math.round(meters));
      metricLines.add(line);
    }
  }

  const titleLine = lines.find((line) => {
    if (metricLines.has(line) || line.length < 2 || line.length > 100) return false;
    if (/^(run|running|trail run|ride|riding|cycling|bike|biking|virtual ride|swim|swimming|pool swim|open water swim|walk|walking|hike|hiking|mountaineering|row|rowing|virtual row|workout|free training|weight training|strength training|crossfit|yoga)$/i.test(line)) return false;
    if (new RegExp(`\\b${MONTHS}\\s+\\d{1,2}`, 'i').test(line)) return false;
    if (/^(distance|pace|average pace|avg\.? pace|average speed|avg\.? speed|moving time|elapsed time|elevation|elevation gain|map|photos?|activity|overview|share|edit|more|today|ride|cycling|run|swim|workout)\b/i.test(line)) return false;
    if (/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(line)) return false;
    return !/^\d+(?:[.,]\d+)?\s*(?:km|mi|m|ft)\b/i.test(line);
  });
  if (titleLine) extracted.title = titleLine;

  return extracted;
}

async function recognizeStravaScreenshot(file, onProgress = () => {}) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Pilih file gambar screenshot Strava.');
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
  return { text: result.data.text, fields: parseStravaText(result.data.text) };
}

export { parseStravaText, recognizeStravaScreenshot };
