/**
 * PlanB Orthanc Wizzard - Background Service Worker
 * Handles network requests to Orthanc REST API bypassing CORS & Mixed Content restrictions.
 */

console.log('[PlanB Background Worker] Service worker initialized.');

const DEFAULT_CONFIG = {
  orthancUrl: 'http://localhost:8042',
  username: '',
  password: '',
  limit: 50
};

// Normalize URL (automatically prepends http:// if missing and strips trailing slashes)
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return 'http://localhost:8042';
  let trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = 'http://' + trimmed;
  }
  return trimmed.replace(/\/+$/, '');
}

// Retrieve stored settings from chrome.storage.local
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['planb_wizzard_config'], (result) => {
      const stored = result.planb_wizzard_config || {};
      const config = { ...DEFAULT_CONFIG, ...stored };
      config.orthancUrl = normalizeUrl(config.orthancUrl);
      resolve(config);
    });
  });
}

// Build Headers object for fetch
function createFetchHeaders(config) {
  const headers = new Headers();
  headers.append('Accept', 'application/json');

  const user = config.username !== undefined ? config.username : '';
  const pass = config.password !== undefined ? config.password : '';
  if (user || pass) {
    const auth = btoa(`${user}:${pass}`);
    headers.append('Authorization', `Basic ${auth}`);
  }
  return headers;
}

// Helper to format DICOM date (YYYYMMDD -> YYYY-MM-DD and DD.MM.YYYY)
function formatDicomDate(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return { iso: '', ru: '' };
  const cleaned = rawDate.replace(/\D/g, '');
  if (cleaned.length < 8) return { iso: rawDate, ru: rawDate };

  const year = cleaned.substring(0, 4);
  const month = cleaned.substring(4, 6);
  const day = cleaned.substring(6, 8);

  return {
    iso: `${year}-${month}-${day}`,
    ru: `${day}.${month}.${year}`
  };
}

// Helper to parse DICOM PatientName (LAST^FIRST^MIDDLE or LAST FIRST MIDDLE)
function parsePatientName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return { fullName: '', lastName: '', firstName: '', middleName: '' };
  }

  const cleaned = rawName.replace(/=/g, '').trim();
  let parts = [];

  if (cleaned.includes('^')) {
    parts = cleaned.split('^').map(p => p.trim()).filter(Boolean);
  } else {
    parts = cleaned.split(/\s+/).map(p => p.trim()).filter(Boolean);
  }

  const lastName = parts[0] || '';
  const firstName = parts[1] || '';
  const middleName = parts[2] || '';

  const fullNameComponents = [lastName, firstName, middleName].filter(Boolean);
  const fullName = fullNameComponents.join(' ');

  return {
    fullName,
    lastName,
    firstName,
    middleName
  };
}

// Helper to format Gender
function formatGender(rawSex) {
  if (!rawSex) return { raw: '', textRu: '', textEn: '', code: '' };
  const sex = rawSex.toUpperCase().trim();
  if (sex === 'M' || sex === 'MALE' || sex === 'М') {
    return { raw: rawSex, textRu: 'Мужской', textEn: 'Male', code: 'M' };
  }
  if (sex === 'F' || sex === 'FEMALE' || sex === 'Ж') {
    return { raw: rawSex, textRu: 'Женский', textEn: 'Female', code: 'F' };
  }
  return { raw: rawSex, textRu: 'Другой', textEn: 'Other', code: 'O' };
}

// Try fetching endpoint with candidate base URLs
async function tryFetchEndpoint(baseUrl, path, config, extraOptions = {}) {
  const cleanBase = normalizeUrl(baseUrl);
  const targetUrl = `${cleanBase}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const headers = createFetchHeaders(config);
  if (extraOptions.body) {
    headers.append('Content-Type', 'application/json');
  }

  try {
    const fetchOptions = {
      method: extraOptions.method || 'GET',
      headers,
      cache: 'no-cache',
      signal: controller.signal
    };
    if (extraOptions.body) fetchOptions.body = extraOptions.body;

    console.log('[PlanB Background] Fetching:', targetUrl);
    const res = await fetch(targetUrl, fetchOptions);
    if (!res.ok) {
      clearTimeout(timeoutId);
      console.warn('[PlanB Background] HTTP Error:', res.status, 'for', targetUrl);
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, url: targetUrl };
    }
    const data = await res.json();
    clearTimeout(timeoutId);
    console.log('[PlanB Background] Fetch SUCCESS for:', targetUrl);
    return { ok: true, status: res.status, data, url: targetUrl };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError' ? 'Превышено время ожидания ответа (12 сек)' : err.message;
    console.error('[PlanB Background] Fetch Exception for', targetUrl, ':', msg);
    return { ok: false, status: 0, error: msg, url: targetUrl };
  }
}

// Fetch studies from Orthanc using user-configured settings from storage
async function fetchStudies(config) {
  config.orthancUrl = normalizeUrl(config.orthancUrl);
  
  const rawCandidates = [config.orthancUrl];
  if (config.orthancUrl.includes(':4242')) {
    rawCandidates.push(config.orthancUrl.replace(':4242', ':8042'));
  }

  const candidateUrls = [];
  for (const url of rawCandidates) {
    if (!url) continue;
    const norm = normalizeUrl(url);
    if (!candidateUrls.includes(norm)) candidateUrls.push(norm);
  }

  let lastError = '';
  let successfulUrl = null;
  let studiesData = null;

  const postBody = JSON.stringify({ Level: 'Study', Query: {}, Expand: true });

  for (const baseUrl of candidateUrls) {
    // Attempt 1: POST /tools/find
    let result = await tryFetchEndpoint(baseUrl, '/tools/find', config, { method: 'POST', body: postBody });

    if (result.ok && result.data) {
      studiesData = result.data;
      successfulUrl = baseUrl;
      break;
    }

    // Attempt 2: GET /studies?expand (Fallback)
    result = await tryFetchEndpoint(baseUrl, '/studies?expand', config, { method: 'GET' });

    if (result.ok && result.data) {
      studiesData = result.data;
      successfulUrl = baseUrl;
      break;
    }

    if (result.error) {
      lastError = `Не удалось подключиться к ${baseUrl} (${result.error})`;
    } else {
      lastError = `HTTP ${result.status} на ${baseUrl}`;
    }
  }

  if (!studiesData) {
    return {
      success: false,
      error: `Ошибка подключения к Orthanc: ${lastError}`
    };
  }

  // Transform into clean study records
  try {
    const parsedStudies = studiesData.map((study) => {
      if (typeof study === 'string') {
        return {
          orthancId: study,
          patientId: study,
          patientName: { fullName: 'Исследование ' + study, lastName: '', firstName: '', middleName: '' },
          patientBirthDate: { iso: '', ru: '' },
          patientSex: { raw: '', textRu: '', textEn: '', code: '' },
          studyDate: { iso: '', ru: '' },
          studyDescription: 'КТ исследование',
          accessionNumber: '',
          modality: 'CT',
          seriesCount: 1
        };
      }

      const mainTags = study.MainDicomTags || {};
      const patientMainTags = study.PatientMainDicomTags || {};

      const rawName = mainTags.PatientName || patientMainTags.PatientName || '';
      const nameParsed = parsePatientName(rawName);

      const rawBirth = mainTags.PatientBirthDate || patientMainTags.PatientBirthDate || '';
      const birthParsed = formatDicomDate(rawBirth);

      const rawStudyDate = mainTags.StudyDate || '';
      let studyDateParsed = formatDicomDate(rawStudyDate);
      if (!studyDateParsed.iso && study.LastUpdate) {
        const rawLastUpdate = String(study.LastUpdate).replace(/\D/g, '').substring(0, 8);
        if (rawLastUpdate) studyDateParsed = formatDicomDate(rawLastUpdate);
      }

      const rawSex = mainTags.PatientSex || patientMainTags.PatientSex || '';
      const sexParsed = formatGender(rawSex);

      return {
        orthancId: study.ID || '',
        patientId: mainTags.PatientID || patientMainTags.PatientID || '',
        patientName: nameParsed,
        patientBirthDate: birthParsed,
        patientSex: sexParsed,
        studyDate: studyDateParsed,
        studyDescription: mainTags.StudyDescription || 'КТ исследование',
        accessionNumber: mainTags.AccessionNumber || '',
        modality: mainTags.Modality || 'CT',
        seriesCount: (study.Series || []).length
      };
    });

    // Sort by studyDate descending (newest / current date first)
    parsedStudies.sort((a, b) => (b.studyDate.iso || '').localeCompare(a.studyDate.iso || ''));

    // Limit after sorting so top N newest studies are returned
    const maxLimit = config.limit && config.limit > 0 ? config.limit : 50;
    const finalStudies = parsedStudies.slice(0, maxLimit);

    return { success: true, studies: finalStudies, usedUrl: successfulUrl };
  } catch (err) {
    return { success: false, error: 'Ошибка обработки списка исследований: ' + err.message };
  }
}

// Test connection to Orthanc
async function testConnection(config) {
  const norm = normalizeUrl(config.orthancUrl);
  const candidateUrls = [norm];
  if (norm.includes(':4242')) {
    candidateUrls.push(norm.replace(':4242', ':8042'));
  }

  for (const baseUrl of candidateUrls) {
    const result = await tryFetchEndpoint(baseUrl, '/system', config, { method: 'GET' });
    if (result.ok) {
      return { success: true, version: (result.data && result.data.Version) || 'OK', workingUrl: baseUrl };
    }
  }

  return { success: false, error: 'Не удалось подключиться к Orthanc. Проверьте адрес, порт и логин/пароль.' };
}

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[PlanB Background] Received message action:', request.action);

  if (request.action === 'GET_CONFIG') {
    getConfig()
      .then((cfg) => sendResponse(cfg))
      .catch(() => sendResponse(DEFAULT_CONFIG));
    return true;
  }

  if (request.action === 'SET_CONFIG') {
    const cleanConfig = { ...request.config };
    cleanConfig.orthancUrl = normalizeUrl(cleanConfig.orthancUrl);
    chrome.storage.local.set({ planb_wizzard_config: cleanConfig }, () => {
      sendResponse({ success: true, config: cleanConfig });
    });
    return true;
  }

  if (request.action === 'TEST_CONNECTION') {
    testConnection(request.config || DEFAULT_CONFIG)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'GET_STUDIES') {
    getConfig()
      .then((config) => fetchStudies(config))
      .then((result) => {
        console.log('[PlanB Background] GET_STUDIES returning result success:', result.success);
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[PlanB Background] GET_STUDIES error:', err);
        sendResponse({ success: false, error: 'Ошибка Service Worker: ' + (err.message || String(err)) });
      });
    return true;
  }
});
