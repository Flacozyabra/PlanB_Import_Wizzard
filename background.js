/**
 * PlanB Orthanc Wizzard - Background Service Worker
 * Handles network requests to Orthanc REST API bypassing CORS & Mixed Content restrictions.
 */

const DEFAULT_CONFIG = {
  orthancUrl: 'http://192.168.5.155:4242',
  username: '',
  password: '',
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
  const headers = { 'Accept': 'application/json' };
  if (config.username && config.password) {
    const auth = btoa(`${config.username}:${config.password}`);
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

  // Remove potential DICOM caret encodings
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

// Fetch studies from Orthanc using /tools/find or /studies
async function fetchStudies(config) {
  const url = `${config.orthancUrl.replace(/\/$/, '')}/tools/find`;
  const headers = getHeaders(config);
  headers['Content-Type'] = 'application/json';

  const body = JSON.stringify({
    Level: 'Study',
    Query: {
      Modality: 'CT'
    },
    Expand: true,
    Limit: config.limit || 50
  });

  try {
    let response = await fetch(url, { method: 'POST', headers, body });
    if (!response.ok) {
      // Fallback to GET /studies?expand
      const fallbackUrl = `${config.orthancUrl.replace(/\/$/, '')}/studies?expand`;
      response = await fetch(fallbackUrl, { method: 'GET', headers: getHeaders(config) });
    }

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const studiesData = await response.json();
    
    // Transform into clean study records
    const parsedStudies = studiesData.map((study) => {
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
        orthancId: study.ID,
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

    return { success: true, studies: parsedStudies };
  } catch (err) {
    console.error('[PlanB Wizzard] Error fetching studies from Orthanc:', err);
    return { success: false, error: err.message };
  }
}

// Test connection to Orthanc
async function testConnection(config) {
  const url = `${config.orthancUrl.replace(/\/$/, '')}/system`;
  try {
    const response = await fetch(url, { method: 'GET', headers: getHeaders(config) });
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }
    const data = await response.json();
    return { success: true, version: data.Version || 'OK' };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
