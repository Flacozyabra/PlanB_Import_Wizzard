/**
 * PlanB Orthanc Wizzard - Options Controller
 */

function normalizeUrlInput(url) {
  if (!url) return '';
  let trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    trimmed = 'http://' + trimmed;
  }
  return trimmed.replace(/\/+$/, '');
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('settings-form');
  const orthancUrlInput = document.getElementById('orthancUrl');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const limitInput = document.getElementById('limit');
  const testBtn = document.getElementById('test-btn');
  const statusMsg = document.getElementById('status-message');

  // Load existing config
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (config) => {
    if (chrome.runtime.lastError) {
      // Fallback to local storage if background script was just reloaded
      chrome.storage.local.get(['planb_wizzard_config'], (result) => {
        const stored = result.planb_wizzard_config || {};
        orthancUrlInput.value = stored.orthancUrl || 'http://localhost:8042';
        usernameInput.value = stored.username || 'orthanc';
        passwordInput.value = stored.password || 'orthanc';
        limitInput.value = stored.limit || 50;
      });
      return;
    }
    if (config) {
      orthancUrlInput.value = config.orthancUrl || 'http://localhost:8042';
      usernameInput.value = config.username || 'orthanc';
      passwordInput.value = config.password || 'orthanc';
      limitInput.value = config.limit || 50;
    }
  });

  // Save config
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cleanUrl = normalizeUrlInput(orthancUrlInput.value);
    orthancUrlInput.value = cleanUrl;

    const config = {
      orthancUrl: cleanUrl,
      username: usernameInput.value.trim(),
      password: passwordInput.value.trim(),
      limit: parseInt(limitInput.value, 10) || 50
    };

    chrome.storage.local.set({ planb_wizzard_config: config }, () => {
      showStatus('Настройки успешно сохранены!', 'success');
    });
  });

  // Direct connection test from options page (independent of service worker state)
  testBtn.addEventListener('click', async () => {
    const cleanUrl = normalizeUrlInput(orthancUrlInput.value);
    orthancUrlInput.value = cleanUrl;

    showStatus('Проверка соединения с Orthanc...', 'success');

    const username = usernameInput.value.trim() || 'orthanc';
    const password = passwordInput.value.trim() || 'orthanc';

    const headers = { 'Accept': 'application/json' };
    if (username || password) {
      headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
    }

    const candidateUrls = [cleanUrl];
    if (cleanUrl.includes(':4242')) {
      candidateUrls.push(cleanUrl.replace(':4242', ':8042'));
    } else if (!cleanUrl.includes(':8042')) {
      candidateUrls.push(cleanUrl + ':8042');
    }

    let connected = false;
    let lastError = '';

    for (const targetBase of candidateUrls) {
      const targetUrl = `${targetBase.replace(/\/$/, '')}/system`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        const res = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.status === 401) {
          lastError = 'Ошибка 401: Неверный логин или пароль';
          continue;
        }

        if (res.ok) {
          const data = await res.json();
          showStatus(`Соединение успешно! Orthanc версия: ${data.Version || 'OK'} (${targetBase})`, 'success');
          connected = true;

          // Save working config automatically
          const config = {
            orthancUrl: targetBase,
            username,
            password,
            limit: parseInt(limitInput.value, 10) || 50
          };
          chrome.storage.local.set({ planb_wizzard_config: config });
          break;
        } else {
          lastError = `HTTP ${res.status}`;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err.name === 'AbortError' ? 'Превышено время ожидания (4 сек)' : err.message;
      }
    }

    if (!connected) {
      showStatus(`Ошибка соединения: ${lastError}`, 'error');
    }
  });

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `status ${type}`;
  }
});
