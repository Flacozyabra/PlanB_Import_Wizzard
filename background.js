/**
 * PlanB Orthanc Wizzard - Background Service Worker
 * Handles network requests to Orthanc REST API bypassing CORS & Mixed Content restrictions.
 */

const DEFAULT_CONFIG = {
  orthancUrl: 'http://192.168.5.155:4242',
  username: 'admin',
  password: 'admin',
  limit: 50
};

// Retrieve stored settings
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['planb_wizzard_config'], (result) => {
      resolve({ ...DEFAULT_CONFIG, ...(result.planb_wizzard_config || {}) });
    });
  });
}

// Build Authorization header if credentials exist
function getHeaders(config) {
  const headers = { 
    'Accept': 'application/json'
  };
  if (config.username || config.password) {
    const user = config.username || 'admin';
    const pass = config.password || 'admin';
    const auth = btoa(`${user}:${pass}`);
    headers['Authorization'] = `Basic ${auth}`;
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
async function tryFetchEndpoint(baseUrl, path, options) {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const targetUrl = `${cleanBase}${path}`;
  try {
    const res = await fetch(targetUrl, options);
    return { ok: res.ok, status: res.status, res, url: targetUrl };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, url: targetUrl };
  }
}

// Fetch studies from Orthanc with fallback URLs & ports
async function fetchStudies(config) {
  const headers = getHeaders(config);
  
  // List candidate URLs to try if primary fails
  const candidateUrls = [config.orthancUrl];
  
  // If primary port is 4242, also try 8042 (standard Orthanc HTTP port)
  if (config.orthancUrl.includes(':4242')) {
    candidateUrls.push(config.orthancUrl.replace(':4242', ':8042'));
    candidateUrls.push(config.orthancUrl.replace(':4242', ''));
  } else if (!config.orthancUrl.includes(':8042')) {
    candidateUrls.push(config.orthancUrl.replace(/\/$/, '') + ':8042');
  }

  let lastError = '';
  let successfulUrl = null;
  let studiesData = null;

  for (const baseUrl of candidateUrls) {
    // Attempt 1: GET /studies?expand
    let result = await tryFetchEndpoint(baseUrl, '/studies?expand', { method: 'GET', headers });
    
    if (result.status === 401) {
      return { success: false, error: 'Ошибка 401 (Unauthorized): Неверный логин или пароль для Orthanc' };
    }

    if (result.ok) {
      try {
        studiesData = await result.res.json();
        successfulUrl = baseUrl;
        break;
      } catch (e) {
        lastError = 'Ошибка парсинга JSON: ' + e.message;
      }
    }

    // Attempt 2: POST /tools/find
    const postHeaders = { ...headers, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ Level: 'Study', Query: {}, Expand: true, Limit: config.limit || 50 });
    result = await tryFetchEndpoint(baseUrl, '/tools/find', { method: 'POST', headers: postHeaders, body });

    if (result.status === 401) {
      return { success: false, error: 'Ошибка 401 (Unauthorized): Неверный логин или пароль для Orthanc' };
    }

    if (result.ok) {
      try {
        studiesData = await result.res.json();
        successfulUrl = baseUrl;
        break;
      } catch (e) {
        lastError = 'Ошибка парсинга JSON: ' + e.message;
      }
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
      error: `${lastError}. Обратите внимание: порт 4242 обычно используется для протокола DICOM, а веб REST API Orthanc работает на порту 8042.`
    };
  }

  // Transform into clean study records
  try {
    const parsedStudies = studiesData.map((study) => {
      // Handle array of strings (if /studies returned unexpanded IDs)
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
      const studyDateParsed = formatDicomDate(rawStudyDate);

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

    // Sort by studyDate descending
    parsedStudies.sort((a, b) => (b.studyDate.iso || '').localeCompare(a.studyDate.iso || ''));

    return { success: true, studies: parsedStudies, usedUrl: successfulUrl };
  } catch (err) {
    return { success: false, error: 'Ошибка обработки списка исследований: ' + err.message };
  }
}

// Test connection to Orthanc
async function testConnection(config) {
  const candidateUrls = [config.orthancUrl];
  if (config.orthancUrl.includes(':4242')) {
    candidateUrls.push(config.orthancUrl.replace(':4242', ':8042'));
    candidateUrls.push(config.orthancUrl.replace(':4242', ''));
  }

  const headers = getHeaders(config);

  for (const baseUrl of candidateUrls) {
    const result = await tryFetchEndpoint(baseUrl, '/system', { method: 'GET', headers });
    if (result.status === 401) {
      return { success: false, error: 'Ошибка 401: Неверный логин или пароль' };
    }
    if (result.ok) {
      try {
        const data = await result.res.json();
        return { success: true, version: data.Version || 'OK', workingUrl: baseUrl };
      } catch (e) {}
    }
  }

  return { success: false, error: 'Не удалось подключиться ни к 4242, ни к 8042 порту' };
}

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_CONFIG') {
    getConfig().then(sendResponse);
    return true;
  }

  if (request.action === 'SET_CONFIG') {
    chrome.storage.local.set({ planb_wizzard_config: request.config }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'TEST_CONNECTION') {
    testConnection(request.config || DEFAULT_CONFIG).then(sendResponse);
    return true;
  }

  if (request.action === 'GET_STUDIES') {
    getConfig().then((config) => {
      fetchStudies(config).then(sendResponse);
    });
    return true;
  }
});
