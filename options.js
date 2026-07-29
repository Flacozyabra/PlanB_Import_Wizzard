/**
 * PlanB Orthanc Wizzard - Options Page Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('options-form');
  const urlInput = document.getElementById('orthanc-url');
  const userInput = document.getElementById('orthanc-user');
  const passInput = document.getElementById('orthanc-pass');
  const limitInput = document.getElementById('orthanc-limit');
  const statusEl = document.getElementById('status-message');
  const testBtn = document.getElementById('test-btn');
  const saveBtn = document.getElementById('save-btn');

  const DEFAULT_CONFIG = {
    orthancUrl: 'http://192.168.5.155:8042',
    username: 'orthanc',
    password: 'orthanc',
    limit: 50
  };

  // Helper: display status message
  function showStatus(text, type = 'info') {
    statusEl.textContent = text;
    statusEl.className = `pbw-status-banner ${type}`;
    statusEl.style.display = 'block';
  }

  function hideStatus() {
    statusEl.style.display = 'none';
  }

  // Load stored options
  chrome.storage.local.get(['planb_wizzard_config'], (result) => {
    const config = result.planb_wizzard_config || DEFAULT_CONFIG;
    urlInput.value = config.orthancUrl || DEFAULT_CONFIG.orthancUrl;
    userInput.value = config.username !== undefined ? config.username : DEFAULT_CONFIG.username;
    passInput.value = config.password !== undefined ? config.password : DEFAULT_CONFIG.password;
    limitInput.value = config.limit || 50;
  });

  // Save button
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    let targetBase = urlInput.value.trim();
    if (!targetBase.startsWith('http://') && !targetBase.startsWith('https://')) {
      targetBase = 'http://' + targetBase;
    }
    targetBase = targetBase.replace(/\/+$/, '');

    const config = {
      orthancUrl: targetBase,
      username: userInput.value.trim(),
      password: passInput.value.trim(),
      limit: parseInt(limitInput.value, 10) || 50
    };

    chrome.storage.local.set({ planb_wizzard_config: config }, () => {
      showStatus('Настройки успешно сохранены!', 'success');
      setTimeout(hideStatus, 3000);
    });
  });

  // Test connection button directly
  testBtn.addEventListener('click', async () => {
    showStatus('Проверка соединения с Orthanc...', 'info');

    let rawUrl = urlInput.value.trim() || 'http://192.168.5.155:8042';
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      rawUrl = 'http://' + rawUrl;
    }
    rawUrl = rawUrl.replace(/\/+$/, '');

    const username = userInput.value.trim();
    const password = passInput.value.trim();

    const candidates = [rawUrl];
    if (rawUrl.includes(':4242')) {
      candidates.push(rawUrl.replace(':4242', ':8042'));
    } else if (!rawUrl.includes(':8042')) {
      candidates.push(rawUrl + ':8042');
    }

    let connected = false;

    for (const targetBase of candidates) {
      try {
        const headers = { 'Accept': 'application/json' };
        if (username || password) {
          const auth = btoa(`${username}:${password}`);
          headers['Authorization'] = `Basic ${auth}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(`${targetBase}/system`, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          showStatus(`Соединение успешно! Orthanc версия: ${data.Version || 'OK'} (${targetBase})`, 'success');
          urlInput.value = targetBase;

          const config = {
            orthancUrl: targetBase,
            username,
            password,
            limit: parseInt(limitInput.value, 10) || 50
          };
          chrome.storage.local.set({ planb_wizzard_config: config });
          connected = true;
          break;
        }
      } catch (err) {}
    }

    if (!connected) {
      showStatus('Не удалось подключиться к Orthanc. Проверьте правильность URL, порта и логина/пароля.', 'error');
    }
  });
});
