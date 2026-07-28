/**
 * PlanB Orthanc Wizzard - Content Script
 * Fast, non-blocking injector for Wizzard button right next to "+ Добавить пациента".
 */

(function () {
  'use strict';

  let allStudies = [];
  let modalContainer = null;
  let isInjecting = false;

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
            <span id="pbw-orthanc-status">Orthanc: http://192.168.5.155:8042</span>
          </div>
          <div id="pbw-count-info">Записей: 0</div>
        </div>
      </div>
    `;

    document.body.appendChild(modalContainer);

    // Event listeners
    document.getElementById('pbw-close-btn').addEventListener('click', closeModal);
    document.getElementById('pbw-refresh-btn').addEventListener('click', loadStudies);
    document.getElementById('pbw-search-input').addEventListener('input', handleSearch);

    // Close on clicking backdrop
    modalContainer.addEventListener('click', (e) => {
      if (e.target === modalContainer) closeModal();
    });
  }

  function openModal() {
    createModalDOM();
    modalContainer.classList.add('pbw-active');
    loadStudies();
  }

  function closeModal() {
    if (modalContainer) {
      modalContainer.classList.remove('pbw-active');
    }
  }

  // Load studies from background script
  function loadStudies() {
    const body = document.getElementById('pbw-body');
    if (!body) return;

    body.innerHTML = `
      <div class="pbw-status-box">
        <div class="pbw-spinner"></div>
        <div>Загрузка КТ-исследований из Orthanc...</div>
      </div>
    `;

    chrome.runtime.sendMessage({ action: 'GET_STUDIES' }, (response) => {
      if (chrome.runtime.lastError) {
        renderError('Ошибка связи с расширением: ' + chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.success) {
        renderError(response ? response.error : 'Неизвестная ошибка');
        return;
      }

      if (response.usedUrl) {
        const statusEl = document.getElementById('pbw-orthanc-status');
        if (statusEl) statusEl.textContent = `Orthanc: ${response.usedUrl}`;
      }

      allStudies = response.studies || [];
      renderStudiesTable(allStudies);
    });
  }

  function renderError(message) {
    const body = document.getElementById('pbw-body');
    if (!body) return;
    body.innerHTML = `
      <div class="pbw-status-box" style="color: #f87171;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">⚠️ Ошибка подключения к Orthanc</div>
        <div style="max-width: 600px; line-height: 1.5;">${escapeHtml(message)}</div>
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

    // Attach click listeners to select buttons
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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Fast locator to find PlanB's "+ Добавить пациента" button
  function findAddPatientButton() {
    const candidates = document.querySelectorAll('button, a, [role="button"], .btn, .button, div');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.id === 'planb-wizzard-btn' || el.closest('#planb-wizzard-btn')) continue;

      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (text.includes('добавить пациента') || text.includes('add patient') || (text.includes('добавить') && text.includes('пациент'))) {
        const btn = el.closest('button, a, [role="button"], .btn') || el;
        if (btn && btn.id !== 'planb-wizzard-btn') return btn;
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

  // Inject Wizzard Button inline next to "+ Добавить пациента" without looping
  function injectWizzardButton() {
    if (isInjecting) return;

    const existingBtn = document.getElementById('planb-wizzard-btn');
    const addPatientBtn = findAddPatientButton();

    if (addPatientBtn && addPatientBtn.parentElement) {
      // If button already exists and is in the correct location, do nothing
      if (existingBtn && addPatientBtn.nextSibling === existingBtn) {
        return;
      }

      isInjecting = true;
      try {
        const wizzardBtn = existingBtn || createWizzardBtnElement();
        wizzardBtn.style.position = 'static';
        addPatientBtn.parentElement.insertBefore(wizzardBtn, addPatientBtn.nextSibling);
      } finally {
        setTimeout(() => { isInjecting = false; }, 50);
      }
      return;
    }

    // Fallback: If search input is present
    if (!existingBtn) {
      const searchInput = document.querySelector('input[placeholder*="ФИО"], input[placeholder*="фио"]');
      if (searchInput && searchInput.parentElement) {
        isInjecting = true;
        try {
          const wizzardBtn = createWizzardBtnElement();
          wizzardBtn.style.position = 'static';
          searchInput.parentElement.insertBefore(wizzardBtn, searchInput.nextSibling);
        } finally {
          setTimeout(() => { isInjecting = false; }, 50);
        }
      }
    }
  }

  // Helper to trigger events on inputs so frameworks (React, Vue, Angular) register changes
  function setInputValue(input, value) {
    if (!input) return;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    const origBorder = input.style.borderColor;
    const origBoxShadow = input.style.boxShadow;
    input.style.borderColor = '#10b981';
    input.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.2)';
    setTimeout(() => {
      input.style.borderColor = origBorder;
      input.style.boxShadow = origBoxShadow;
    }, 2500);
  }

  // Populate PlanB Patient Form with Study data
  function applyStudyToPlanB(study) {
    closeModal();

    const addPatientBtn = findAddPatientButton();
    if (addPatientBtn) {
      addPatientBtn.click();
    }

    setTimeout(() => {
      fillFormFields(study);
    }, 400);
  }

  function fillFormFields(study) {
    const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
    if (inputs.length === 0) return;

    inputs.forEach((input) => {
      const id = (input.id || '').toLowerCase();
      const name = (input.name || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      const type = (input.type || '').toLowerCase();

      let labelText = '';
      if (input.id) {
        const lbl = document.querySelector(`label[for="${input.id}"]`);
        if (lbl) labelText = (lbl.textContent || '').toLowerCase();
      }
      if (!labelText && input.parentElement) {
        labelText = (input.parentElement.textContent || '').toLowerCase();
      }

      const combinedText = `${id} ${name} ${placeholder} ${labelText}`;

      // 1. Patient ID / Card Number
      if (combinedText.includes('id') || combinedText.includes('карт') || combinedText.includes('код') || combinedText.includes('card')) {
        if (study.patientId) setInputValue(input, study.patientId);
      }

      // 2. Full Name (FIO)
      else if (combinedText.includes('фио') || combinedText.includes('fio') || combinedText.includes('пациент') || combinedText.includes('patient name')) {
        if (study.patientName.fullName) setInputValue(input, study.patientName.fullName);
      }

      // 3. Last Name (Фамилия)
      else if (combinedText.includes('фамил') || combinedText.includes('lastname') || combinedText.includes('surname')) {
        if (study.patientName.lastName) setInputValue(input, study.patientName.lastName);
      }

      // 4. First Name (Имя)
      else if (combinedText.includes('имя') || combinedText.includes('firstname')) {
        if (study.patientName.firstName) setInputValue(input, study.patientName.firstName);
      }

      // 5. Middle Name (Отчество)
      else if (combinedText.includes('отчеств') || combinedText.includes('middlename') || combinedText.includes('patronymic')) {
        if (study.patientName.middleName) setInputValue(input, study.patientName.middleName);
      }

      // 6. Birth Date (Дата рождения)
      else if (combinedText.includes('рожд') || combinedText.includes('birth') || combinedText.includes('dob') || combinedText.includes('bday')) {
        if (type === 'date') {
          if (study.patientBirthDate.iso) setInputValue(input, study.patientBirthDate.iso);
        } else {
          if (study.patientBirthDate.ru || study.patientBirthDate.iso) {
            setInputValue(input, study.patientBirthDate.ru || study.patientBirthDate.iso);
          }
        }
      }

      // 7. Gender / Sex (Пол)
      else if (combinedText.includes('пол') || combinedText.includes('sex') || combinedText.includes('gender')) {
        if (input.tagName.toLowerCase() === 'select') {
          const options = Array.from(input.options);
          const sexCode = study.patientSex.code;
          const matchOpt = options.find((opt) => {
            const optVal = (opt.value || '').toLowerCase();
            const optTxt = (opt.textContent || '').toLowerCase();
            return optVal.includes(sexCode.toLowerCase()) || optTxt.includes(study.patientSex.textRu.toLowerCase()) || optTxt.includes(study.patientSex.textEn.toLowerCase());
          });
          if (matchOpt) {
            input.value = matchOpt.value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (type === 'radio') {
          const val = (input.value || '').toLowerCase();
          if (val === study.patientSex.code.toLowerCase() || val === study.patientSex.textRu.toLowerCase()) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          setInputValue(input, study.patientSex.textRu || study.patientSex.code);
        }
      }
    });
  }

  // Observer to inject button as soon as DOM loads or updates, with debouncing
  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      injectWizzardButton();
    }, 100);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWizzardButton);
  } else {
    injectWizzardButton();
  }
})();
