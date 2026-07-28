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

    chrome.runtime.sendMessage({ action: 'SET_CONFIG', config }, (res) => {
      if (res && res.success) {
        showStatus('Настройки успешно сохранены!', 'success');
      } else {
        showStatus('Ошибка при сохранении настроек', 'error');
      }
    });
  });

  // Test Connection
  testBtn.addEventListener('click', () => {
    const cleanUrl = normalizeUrlInput(orthancUrlInput.value);
    orthancUrlInput.value = cleanUrl;

    showStatus('Проверка соединения с Orthanc...', 'success');
    
    const config = {
      orthancUrl: cleanUrl,
      username: usernameInput.value.trim(),
      password: passwordInput.value.trim()
    };

    chrome.runtime.sendMessage({ action: 'TEST_CONNECTION', config }, (res) => {
      if (chrome.runtime.lastError) {
        showStatus(`Ошибка расширения: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }
      if (res && res.success) {
        showStatus(`Соединение успешно! Orthanc версия: ${res.version} (${res.workingUrl})`, 'success');
      } else {
        showStatus(`Ошибка соединения: ${res ? res.error : 'Неизвестная ошибка'}`, 'error');
      }
    });
  });

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `status ${type}`;
  }
});
