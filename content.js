/**
 * PlanB Orthanc Wizzard - Content Script
 * Fast, non-blocking injector for Wizzard button right next to "+ Добавить пациента".
 * Automates opening PlanB's native "Добавление пациента" modal and filling starred DICOM fields.
 */

(function () {
  'use strict';

  let allStudies = [];
  let modalContainer = null;
  let isInjecting = false;
  let planbNativeAddButton = null;
  let pendingStudy = null; // DICOM data waiting to fill the next PlanB modal that opens

  // SVG Icons
  const WIZARD_ICON = `<svg viewBox="0 0 24 24"><path d="M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7 7.5 5.6zm12 9.8l-2.5 1.4 1.4 2.5-2.5-1.4-2.5 1.4 1.4-2.5-1.4-2.5 2.5 1.4 2.5-1.4-1.4 2.5 1.4 2.5zM19.5 2l-1.4 2.5 2.5 1.4-2.5 1.4 1.4 2.5-2.5-1.4-2.5 1.4 1.4-2.5-1.4-2.5 2.5 1.4L19.5 2zM9.24 10.19l7.07-7.07c.39-.39 1.02-.39 1.41 0l2.83 2.83c.39.39.39 1.02 0 1.41l-7.07 7.07-4.24-4.24zm-1.41 1.42l4.24 4.24-6.36 6.36H1.5v-4.24l6.33-6.36z"/></svg>`;
  const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
  const CLOSE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // Initialize Modal UI in document
  function createModalDOM() {
    if (document.getElementById('pbw-modal-overlay')) return;

    modalContainer = document.createElement('div');
    modalContainer.id = 'pbw-modal-overlay';
    modalContainer.className = 'pbw-overlay';

    modalContainer.innerHTML = `
      <div class="pbw-modal">
        <div class="pbw-header">
          <div class="pbw-title-container">
            <div class="pbw-title-icon">${WIZARD_ICON}</div>
            <div>
              <h3 class="pbw-title">Orthanc CT Wizzard</h3>
              <div class="pbw-subtitle">Выберите исследование для автоматического создания пациента в PlanB</div>
            </div>
          </div>
          <button class="pbw-close-btn" id="pbw-close-btn">${CLOSE_ICON}</button>
        </div>

        <div class="pbw-toolbar">
          <div class="pbw-search-box">
            ${SEARCH_ICON}
            <input type="text" id="pbw-search-input" class="pbw-search-input" placeholder="Поиск по ФИО, ID пациента или дате..." />
          </div>
          <button class="pbw-refresh-btn" id="pbw-refresh-btn">
            ${REFRESH_ICON}
            <span>Обновить</span>
          </button>
        </div>

        <div class="pbw-body" id="pbw-body">
          <div class="pbw-status-box">
            <div class="pbw-spinner"></div>
            <div>Загрузка исследований из Orthanc...</div>
          </div>
        </div>

        <div class="pbw-footer">
          <div class="pbw-footer-info">
            <span class="pbw-status-dot"></span>
            <span id="pbw-orthanc-status">Orthanc...</span>
          </div>
          <div id="pbw-count-info">Записей: 0</div>
        </div>
      </div>
    `;

    document.body.appendChild(modalContainer);

    // Event listeners
    document.getElementById('pbw-close-btn').addEventListener('click', closeModal);
    document.getElementById('pbw-refresh-btn').addEventListener('click', () => loadStudies(false));
    document.getElementById('pbw-search-input').addEventListener('input', handleSearch);

    // Close on clicking backdrop
    modalContainer.addEventListener('click', (e) => {
      if (e.target === modalContainer) closeModal();
    });
  }

  function openModal() {
    createModalDOM();
    modalContainer.style.display = 'flex';
    // Force reflow so transition plays
    modalContainer.getBoundingClientRect();
    modalContainer.classList.add('pbw-active');
    loadStudies(false);
  }

  function closeModal() {
    if (modalContainer) {
      modalContainer.classList.remove('pbw-active');
      // Instantly remove from event-interception flow — don't wait for CSS transition
      modalContainer.style.display = 'none';
    }
  }

  // Load studies from background script or fallback
  function loadStudies(isRetry) {
    const body = document.getElementById('pbw-body');
    if (!body) return;

    body.innerHTML = `
      <div class="pbw-status-box">
        <div class="pbw-spinner"></div>
        <div>Загрузка КТ-исследований из Orthanc...</div>
      </div>
    `;

    try {
      chrome.runtime.sendMessage({ action: 'GET_STUDIES' }, async (response) => {
        if (chrome.runtime.lastError) {
          const lastErr = chrome.runtime.lastError.message || '';
          console.warn('[PlanB Content] sendMessage lastError:', lastErr);
          
          const directResult = await directFetchStudiesFallback();
          if (directResult.success) {
            const statusEl = document.getElementById('pbw-orthanc-status');
            if (statusEl) statusEl.textContent = `Orthanc: ${directResult.usedUrl}`;
            allStudies = directResult.studies || [];
            renderStudiesTable(allStudies);
            return;
          }

          if (!isRetry && (lastErr.includes('Receiving end') || lastErr.includes('Could not establish'))) {
            setTimeout(() => loadStudies(true), 350);
            return;
          }

          renderReloadPageRequired(
            'Сессия расширения обновилась в настройках браузера. Пожалуйста, обновите эту страницу (нажмите F5).'
          );
          return;
        }

        if (!response || !response.success) {
          const errMsg = response && response.error ? response.error : 'Ошибка получения данных из Orthanc';
          
          const directResult = await directFetchStudiesFallback();
          if (directResult.success) {
            const statusEl = document.getElementById('pbw-orthanc-status');
            if (statusEl) statusEl.textContent = `Orthanc: ${directResult.usedUrl}`;
            allStudies = directResult.studies || [];
            renderStudiesTable(allStudies);
            return;
          }

          renderError(errMsg);
          return;
        }

        if (response.usedUrl) {
          const statusEl = document.getElementById('pbw-orthanc-status');
          if (statusEl) statusEl.textContent = `Orthanc: ${response.usedUrl}`;
        }

        allStudies = response.studies || [];
        renderStudiesTable(allStudies);
      });
    } catch (err) {
      console.error('[PlanB Content] Exception sending message:', err);
      directFetchStudiesFallback().then((directResult) => {
        if (directResult.success) {
          const statusEl = document.getElementById('pbw-orthanc-status');
          if (statusEl) statusEl.textContent = `Orthanc: ${directResult.usedUrl}`;
          allStudies = directResult.studies || [];
          renderStudiesTable(allStudies);
        } else {
          renderReloadPageRequired('Требуется обновление страницы (Ctrl+F5).');
        }
      });
    }
  }

  // Direct fetch fallback from content script
  async function directFetchStudiesFallback() {
    let config = { orthancUrl: 'http://localhost:8042', username: '', password: '', limit: 50 };
    try {
      const stored = await new Promise((res) => chrome.storage.local.get(['planb_wizzard_config'], res));
      if (stored && stored.planb_wizzard_config) {
        config = { ...config, ...stored.planb_wizzard_config };
      }
    } catch (e) {}

    const candidateUrls = [config.orthancUrl];
    if (config.orthancUrl && config.orthancUrl.includes(':4242')) {
      candidateUrls.push(config.orthancUrl.replace(':4242', ':8042'));
    }

    const headers = { 'Accept': 'application/json' };
    if (config.username || config.password) {
      headers['Authorization'] = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    }

    const postBody = JSON.stringify({ Level: 'Study', Query: {}, Expand: true, Limit: config.limit || 50 });

    for (let baseUrl of candidateUrls) {
      if (!baseUrl) continue;
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) baseUrl = 'http://' + baseUrl;
      baseUrl = baseUrl.replace(/\/$/, '');

      try {
        const res = await fetch(`${baseUrl}/tools/find`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: postBody });
        if (res.ok) {
          const data = await res.json();
          return parseStudiesClientSide(data, baseUrl);
        }
      } catch (e) {}

      try {
        const res = await fetch(`${baseUrl}/studies?expand`, { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json();
          return parseStudiesClientSide(data, baseUrl);
        }
      } catch (e) {}
    }

    return { success: false, error: 'Не удалось подключиться к Orthanc' };
  }

  function renderReloadPageRequired(message) {
    const body = document.getElementById('pbw-body');
    if (!body) return;
    body.innerHTML = `
      <div class="pbw-status-box" style="color: #f87171;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">🔄 Требуется обновление страницы</div>
        <div style="max-width: 550px; line-height: 1.5; font-size: 13px; margin-bottom: 18px; color: #cbd5e1;">
          ${escapeHtml(message)}
        </div>
        <button id="pbw-reload-page-btn" style="
          background: #3b82f6;
          color: #ffffff;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        ">Обновить страницу (F5)</button>
      </div>
    `;

    const reloadBtn = document.getElementById('pbw-reload-page-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }
  }

  function renderError(message) {
    const body = document.getElementById('pbw-body');
    if (!body) return;
    body.innerHTML = `
      <div class="pbw-status-box" style="color: #f87171;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">⚠️ Не удалось загрузить исследования</div>
        <div style="max-width: 650px; line-height: 1.5; font-size: 13px;">${escapeHtml(message)}</div>
      </div>
    `;
  }

  function renderStudiesTable(studies) {
    const body = document.getElementById('pbw-body');
    const countInfo = document.getElementById('pbw-count-info');
    if (!body) return;

    if (countInfo) countInfo.textContent = `Записей: ${studies.length}`;

    if (studies.length === 0) {
      body.innerHTML = `
        <div class="pbw-status-box">
          <div>Исследования КТ не найдены на сервере Orthanc</div>
        </div>
      `;
      return;
    }

    let html = `
      <table class="pbw-table">
        <thead>
          <tr>
            <th>ФИО Пациента</th>
            <th>ID Пациента</th>
            <th>Дата рожд.</th>
            <th>Пол</th>
            <th>Исследование</th>
            <th>Дата КТ</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
    `;

    studies.forEach((s, index) => {
      const name = s.patientName.fullName || 'Без имени';
      const pid = s.patientId || '—';
      const dob = s.patientBirthDate.ru || '—';
      const sex = s.patientSex.textRu || '—';
      const desc = s.studyDescription || 'КТ';
      const date = s.studyDate.ru || '—';

      html += `
        <tr>
          <td>
            <div class="pbw-patient-name">${escapeHtml(name)}</div>
          </td>
          <td><code>${escapeHtml(pid)}</code></td>
          <td>${escapeHtml(dob)}</td>
          <td>${escapeHtml(sex)}</td>
          <td>
            <span class="pbw-badge pbw-badge-ct">${escapeHtml(s.modality)}</span>
            <span style="margin-left: 6px;">${escapeHtml(desc)}</span>
          </td>
          <td>${escapeHtml(date)}</td>
          <td>
            <button class="pbw-select-btn" data-index="${index}">Выбрать</button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    body.innerHTML = html;

    body.querySelectorAll('.pbw-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const selectedStudy = studies[idx];
        if (selectedStudy) {
          applyStudyToPlanB(selectedStudy);
        }
      });
    });
  }

  function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      renderStudiesTable(allStudies);
      return;
    }

    const filtered = allStudies.filter((s) => {
      const name = (s.patientName.fullName || '').toLowerCase();
      const pid = (s.patientId || '').toLowerCase();
      const date = (s.studyDate.ru || '').toLowerCase();
      const desc = (s.studyDescription || '').toLowerCase();
      return name.includes(query) || pid.includes(query) || date.includes(query) || desc.includes(query);
    });

    renderStudiesTable(filtered);
  }

  function parseStudiesClientSide(studiesData, urlBase) {
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

      parsedStudies.sort((a, b) => (b.studyDate.iso || '').localeCompare(a.studyDate.iso || ''));
      return { success: true, studies: parsedStudies, usedUrl: urlBase };
    } catch (e) {
      return { success: false, error: 'Ошибка обработки DICOM: ' + e.message };
    }
  }

  function formatDicomDate(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return { iso: '', ru: '' };
    const cleaned = rawDate.replace(/\D/g, '');
    if (cleaned.length < 8) return { iso: rawDate, ru: rawDate };
    return {
      iso: `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}-${cleaned.substring(6, 8)}`,
      ru: `${cleaned.substring(6, 8)}.${cleaned.substring(4, 6)}.${cleaned.substring(0, 4)}`
    };
  }

  function parsePatientName(rawName) {
    if (!rawName || typeof rawName !== 'string') return { fullName: '', lastName: '', firstName: '', middleName: '' };
    const cleaned = rawName.replace(/=/g, '').trim();
    let parts = cleaned.includes('^') ? cleaned.split('^') : cleaned.split(/\s+/);
    parts = parts.map(p => p.trim()).filter(Boolean);
    const lastName = parts[0] || '';
    const firstName = parts[1] || '';
    const middleName = parts[2] || '';
    return { fullName: [lastName, firstName, middleName].filter(Boolean).join(' '), lastName, firstName, middleName };
  }

  function formatGender(rawSex) {
    if (!rawSex) return { raw: '', textRu: '', textEn: '', code: '' };
    const sex = rawSex.toUpperCase().trim();
    if (sex === 'M' || sex === 'MALE' || sex === 'М') return { raw: rawSex, textRu: 'Мужской', textEn: 'Male', code: 'M' };
    if (sex === 'F' || sex === 'FEMALE' || sex === 'Ж') return { raw: rawSex, textRu: 'Женский', textEn: 'Female', code: 'F' };
    return { raw: rawSex, textRu: 'Другой', textEn: 'Other', code: 'O' };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Real-time locator to find PlanB's "+ Добавить пациента" or "+ Создать запись" button
  function findAddPatientButton() {
    // Scan live DOM tree for matching button
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, .button, div, span'));
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.id === 'planb-wizzard-btn' || el.closest('#planb-wizzard-btn')) continue;

      const text = (el.innerText || el.textContent || '').trim();
      if (text.length === 0 || text.length > 60) continue;

      const lowerText = text.toLowerCase();
      if (
        lowerText.includes('добавить пациента') ||
        lowerText.includes('создать запись') ||
        lowerText.includes('добавить запись') ||
        lowerText.includes('создать пациента') ||
        lowerText.includes('новый пациент') ||
        lowerText.includes('add patient') ||
        (lowerText.includes('пациент') && (lowerText.includes('добавить') || lowerText.includes('создать') || lowerText.includes('+')))
      ) {
        const btn = el.closest('button, a, [role="button"], .btn') || el;
        if (btn && btn.id !== 'planb-wizzard-btn') {
          return btn;
        }
      }
    }
    return null;
  }

  function createWizzardBtnElement() {
    const wizzardBtn = document.createElement('button');
    wizzardBtn.id = 'planb-wizzard-btn';
    wizzardBtn.className = 'planb-wizzard-btn';
    wizzardBtn.type = 'button';
    wizzardBtn.innerHTML = `${WIZARD_ICON} <span>Wizzard</span>`;
    wizzardBtn.addEventListener('click', openModal);
    return wizzardBtn;
  }

  // Inject Wizzard Button ALWAYS inline in the toolbar right next to PlanB's button
  function injectWizzardButton() {
    if (isInjecting) return;

    let wizzardBtn = document.getElementById('planb-wizzard-btn');
    const addPatientBtn = findAddPatientButton();

    if (addPatientBtn && addPatientBtn.parentElement) {
      if (wizzardBtn && addPatientBtn.nextSibling === wizzardBtn) {
        return; // Already placed right after addPatientBtn
      }

      isInjecting = true;
      try {
        if (!wizzardBtn) wizzardBtn = createWizzardBtnElement();

        wizzardBtn.style.position = 'static';
        wizzardBtn.style.display = 'inline-flex';
        wizzardBtn.style.zIndex = '100';

        addPatientBtn.parentElement.insertBefore(wizzardBtn, addPatientBtn.nextSibling);
      } finally {
        setTimeout(() => { isInjecting = false; }, 50);
      }
      return;
    }

    const searchInput = document.querySelector('input[placeholder*="ФИО"], input[placeholder*="фио"], input[placeholder*="пациент"], input[placeholder*="поиск"]');
    if (searchInput && searchInput.parentElement) {
      const container = searchInput.closest('.MuiBox-root, form, header, nav') || searchInput.parentElement;
      if (wizzardBtn && container.contains(wizzardBtn)) return;

      isInjecting = true;
      try {
        if (!wizzardBtn) wizzardBtn = createWizzardBtnElement();
        wizzardBtn.style.position = 'static';
        wizzardBtn.style.display = 'inline-flex';
        wizzardBtn.style.zIndex = '100';
        container.appendChild(wizzardBtn);
      } finally {
        setTimeout(() => { isInjecting = false; }, 50);
      }
      return;
    }
  }

  // Deep multi-target trigger for PointerEvents + MouseEvents + Click on target, container, child & previous sibling
  function triggerElementClick(el) {
    if (!el) return;

    const target = el;
    const parentContainer = el.closest('button, a, [role="button"], .btn, div') || el;
    const childSpan = el.querySelector('span, i, svg, div, p') || el;

    const elementsToClick = [target, parentContainer, childSpan];

    elementsToClick.forEach(targetEl => {
      if (!targetEl) return;
      try { targetEl.focus(); } catch (e) {}

      const opts = { bubbles: true, cancelable: true, view: window };
      targetEl.dispatchEvent(new PointerEvent('pointerdown', opts));
      targetEl.dispatchEvent(new MouseEvent('mousedown', opts));
      targetEl.dispatchEvent(new PointerEvent('pointerup', opts));
      targetEl.dispatchEvent(new MouseEvent('mouseup', opts));
      targetEl.dispatchEvent(new MouseEvent('click', opts));

      if (typeof targetEl.click === 'function') {
        try { targetEl.click(); } catch (e) {}
      }
    });
  }

  // Helper to trigger full React / Vue / Angular input events
  function setInputValue(input, value) {
    if (!input || value === undefined || value === null) return;

    try {
      input.focus();
    } catch (e) {}

    const nativeSetter = Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

    const origBorder = input.style.borderColor;
    const origBoxShadow = input.style.boxShadow;
    input.style.borderColor = '#10b981';
    input.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.25)';
    setTimeout(() => {
      input.style.borderColor = origBorder;
      input.style.boxShadow = origBoxShadow;
    }, 2500);
  }

  // Show a non-blocking toast notification inside the page
  function showToast(message, durationMs = 4000) {
    const existing = document.getElementById('pbw-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pbw-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid #6366f1;
      border-radius: 10px;
      padding: 14px 22px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      z-index: 9999999;
      pointer-events: none;
      text-align: center;
      line-height: 1.5;
      max-width: 420px;
      animation: pbw-toast-in 0.25s ease;
    `;
    toast.innerHTML = message;

    const style = document.createElement('style');
    style.textContent = `@keyframes pbw-toast-in { from { opacity:0; transform:translateX(-50%) translateY(12px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, durationMs);
  }

  // Action on clicking "Выбрать" next to a patient in Wizzard
  function applyStudyToPlanB(study) {
    // 1. Save study data — MutationObserver will auto-fill it when PlanB modal opens
    pendingStudy = study;

    // 2. Close Wizzard
    closeModal();

    // 3. Show hint to user
    const name = study.patientName.fullName || '';
    showToast(`✅ Данные пациента <b>${name}</b> готовы.<br>Нажмите <b>«+ Добавить пациента»</b> — поля заполнятся автоматически.`, 6000);
  }

  // Populate starred fields from DICOM tags
  function fillStarredFormFields(study) {
    const allInputs = Array.from(document.querySelectorAll('input, select, textarea, div[placeholder], span[placeholder]'));
    if (allInputs.length === 0) return false;

    let filledAny = false;

    allInputs.forEach((input) => {
      if (input.id === 'pbw-search-input' || input.type === 'hidden') return;

      const ph = (input.placeholder || input.getAttribute('placeholder') || '').toLowerCase();
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();

      let labelText = '';
      if (input.id) {
        const lbl = document.querySelector(`label[for="${input.id}"]`);
        if (lbl) labelText = (lbl.textContent || '').toLowerCase();
      }
      if (!labelText && input.parentElement) {
        labelText = (input.parentElement.textContent || '').toLowerCase();
      }

      const combinedText = `${ph} ${name} ${id} ${labelText}`;

      // 1. Фамилия*
      if (combinedText.includes('фамил')) {
        const val = study.patientName.lastName || study.patientName.fullName || '';
        if (val && input.tagName === 'INPUT') { setInputValue(input, val); filledAny = true; }
      }

      // 2. Имя* (excluding Фамилия / Отчество / ФИО)
      else if (combinedText.includes('имя') && !combinedText.includes('фамил') && !combinedText.includes('отчеств') && !combinedText.includes('фио')) {
        const val = study.patientName.firstName || '';
        if (val && input.tagName === 'INPUT') { setInputValue(input, val); filledAny = true; }
      }

      // 3. Отчество (optional)
      else if (combinedText.includes('отчеств')) {
        const val = study.patientName.middleName || '';
        if (val && input.tagName === 'INPUT') { setInputValue(input, val); filledAny = true; }
      }

      // 4. Дата рождения*
      else if (combinedText.includes('рожд') || combinedText.includes('birth') || combinedText.includes('dob')) {
        if (input.tagName === 'INPUT') {
          if (input.type === 'date') {
            if (study.patientBirthDate.iso) { setInputValue(input, study.patientBirthDate.iso); filledAny = true; }
          } else {
            if (study.patientBirthDate.ru || study.patientBirthDate.iso) {
              setInputValue(input, study.patientBirthDate.ru || study.patientBirthDate.iso);
              filledAny = true;
            }
          }
        }
      }

      // 5. ID*
      else if (combinedText.includes('id*') || (combinedText.includes('id') && !combinedText.includes('снилс') && !combinedText.includes('телефон'))) {
        const val = study.patientId || '';
        if (val && input.tagName === 'INPUT') { setInputValue(input, val); filledAny = true; }
      }

      // 6. Пол*
      else if (combinedText.includes('пол*') || (combinedText.includes('пол') && !combinedText.includes('почта') && !combinedText.includes('область'))) {
        if (fillGenderElementDirect(input, study.patientSex)) {
          filledAny = true;
        }
      }
    });

    // Gender fill — only when PlanB add-patient dialog is open
    // Guard: Фамилия placeholder must exist = form is open
    const hasFamilyInput = !!document.querySelector('input[placeholder*="амил"]');
    if (hasFamilyInput) {
      if (fillGenderInDialog(study.patientSex)) {
        filledAny = true;
      }
    }

    return filledAny;
  }

  // Fill gender field — ONLY inside the PlanB add-patient dialog
  function fillGenderInDialog(sexInfo) {
    if (!sexInfo || !sexInfo.textRu) return false;
    const targetRu = sexInfo.textRu.toLowerCase();
    const isMaleGender = sexInfo.code.toLowerCase() === 'm';

    // Find the dialog root — MUI Dialog wraps the form
    const dialog = document.querySelector('[role="dialog"], .MuiDialog-root, .MuiDialog-paper, .MuiPaper-root');
    if (!dialog) return false;

    // id="genderId" is the exact MUI Select for gender inside the patient form
    const muiSelect = dialog.querySelector('#genderId') ||
                      dialog.querySelector('.MuiSelect-select[aria-haspopup="listbox"]');
    if (!muiSelect) return false;

    const isMaleGender = sexInfo.code.toLowerCase() === 'm';

    // Open MUI dropdown via mousedown
    muiSelect.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    muiSelect.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
    muiSelect.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window }));

    // Pick option after dropdown renders
    const pickOption = (attempt) => {
      const listbox = document.querySelector('ul[role="listbox"]');
      if (!listbox) {
        if (attempt < 4) setTimeout(() => pickOption(attempt + 1), 100);
        return;
      }
      const options = Array.from(listbox.querySelectorAll('li[role="option"], li'));
      for (const opt of options) {
        const t = (opt.textContent || '').trim().toLowerCase();
        if (t === targetRu || (isMaleGender && t === 'мужской') || (!isMaleGender && t === 'женский')) {
          opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          opt.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
          opt.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window }));
          return;
        }
      }
    };

    setTimeout(() => pickOption(0), 120);
    return true;
  }

  // Comprehensive gender field filler (standard inputs fallback)
  function fillGenderElementDirect(inputEl, sexInfo) {
    if (!sexInfo || !sexInfo.textRu) return false;

    // ── Strategy 1: standard <select> elements — find by option content ──────
    const allSelects = Array.from(document.querySelectorAll('select'));
    for (const sel of allSelects) {
      if (sel.closest('#pbw-modal-overlay')) continue;
      const opts = Array.from(sel.options);
      // Check if this select has gender-like options
      const hasGenderOptions = opts.some(o => {
        const t = (o.textContent || '').toLowerCase();
        return t.includes('мужск') || t.includes('женск') || t === 'м' || t === 'ж' || t === 'm' || t === 'f';
      });
      if (hasGenderOptions) {
        const match = opts.find(o => {
          const t = (o.textContent || '').toLowerCase();
          const v = (o.value || '').toLowerCase();
          return t.includes(targetRu) || v === targetCode || v === (isMale ? 'male' : 'female') ||
                 t === (isMale ? 'м' : 'ж') || t === targetCode;
        });
        if (match) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(sel, match.value); else sel.value = match.value;
          sel.dispatchEvent(new Event('input',  { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }

    // ── Strategy 2: radio buttons with gender values ──────────────────────────
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    for (const radio of radios) {
      if (radio.closest('#pbw-modal-overlay')) continue;
      const v = (radio.value || '').toLowerCase();
      const lbl = document.querySelector(`label[for="${radio.id}"]`);
      const lblTxt = (lbl ? lbl.textContent : (radio.parentElement ? radio.parentElement.textContent : '')).toLowerCase();
      if (
        v === targetCode || v === targetRu ||
        v === (isMale ? 'male' : 'female') ||
        lblTxt.includes(targetRu) ||
        (isMale && (v === 'м' || lblTxt.includes('муж'))) ||
        (!isMale && (v === 'ж' || lblTxt.includes('жен')))
      ) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
    }

    // ── Strategy 3: custom dropdown — find trigger near label "Пол" ──────────
    // Walk every element, find a label "Пол*", then look for select/combobox in its neighbourhood
    const allEls = Array.from(document.querySelectorAll('label, div, span, td, th, p'));
    for (const el of allEls) {
      if (el.closest('#pbw-modal-overlay')) continue;
      const ownTxt = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.textContent : (el.getAttribute('data-label') || '')).trim().toLowerCase();
      if (ownTxt !== 'пол' && ownTxt !== 'пол*' && ownTxt !== 'gender') continue;

      // Sibling / parent container search
      const searchRoot = el.closest('tr, .form-row, .form-group, .field, .row, fieldset, form') 
                         || el.parentElement || el;

      // Try select inside container
      const sel = searchRoot.querySelector('select');
      if (sel) {
        const opts = Array.from(sel.options);
        const match = opts.find(o => {
          const t = (o.textContent || '').toLowerCase();
          const v = (o.value || '').toLowerCase();
          return t.includes(targetRu) || v === targetCode;
        });
        if (match) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(sel, match.value); else sel.value = match.value;
          sel.dispatchEvent(new Event('input',  { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }

      // Try custom dropdown combobox trigger
      const combobox = searchRoot.querySelector('[role="combobox"], [role="listbox"], .v-select, .ant-select, .el-select, .multiselect, [aria-haspopup="listbox"]');
      if (combobox) {
        HTMLElement.prototype.click.call(combobox);
        combobox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        setTimeout(() => {
          const options = Array.from(document.querySelectorAll('[role="option"], .v-list-item, .ant-select-item, .el-select-dropdown__item, .multiselect__option, li'));
          for (const opt of options) {
            if (opt.closest('#pbw-modal-overlay')) continue;
            const t = (opt.textContent || '').trim().toLowerCase();
            if (t.includes(targetRu) || t === (isMale ? 'м' : 'ж')) {
              HTMLElement.prototype.click.call(opt);
              opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              break;
            }
          }
        }, 150);
        return true;
      }
    }

    // ── Strategy 4: fallback — any visible option text with gender content ────
    const allOptions = Array.from(document.querySelectorAll('[role="option"], .v-list-item, .ant-select-item, li, .dropdown-item'));
    for (const opt of allOptions) {
      if (opt.closest('#pbw-modal-overlay')) continue;
      const t = (opt.textContent || '').trim().toLowerCase();
      if (t === targetRu || t === (isMale ? 'м' : 'ж')) {
        HTMLElement.prototype.click.call(opt);
        opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
    }

    return false;
  }

  // Observer to inject button as soon as DOM loads or updates, with debouncing
  // Also watches for PlanB native modal to open and auto-fills fields from pendingStudy
  let debounceTimeout = null;
  let fillDebounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      injectWizzardButton();
    }, 100);

    // If we have a pending study, try to fill the form any time the DOM changes
    if (pendingStudy) {
      if (fillDebounceTimeout) clearTimeout(fillDebounceTimeout);
      fillDebounceTimeout = setTimeout(() => {
        if (!pendingStudy) return;
        const filled = fillStarredFormFields(pendingStudy);
        if (filled) {
          // Show success feedback
          const name = pendingStudy.patientName.fullName || '';
          showToast(`✅ Поля для пациента <b>${name}</b> заполнены!`, 3000);
          pendingStudy = null; // Clear after successful fill
        }
      }, 80);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWizzardButton);
  } else {
    injectWizzardButton();
  }
})();
