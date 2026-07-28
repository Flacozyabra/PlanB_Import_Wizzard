/**
 * PlanB Orthanc Wizzard - Options Controller
 */

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
      orthancUrlInput.value = config.orthancUrl || 'http://192.168.5.155:4242';
      usernameInput.value = config.username || '';
      passwordInput.value = config.password || '';
      limitInput.value = config.limit || 50;
    }
  });

  // Save config
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const config = {
      orthancUrl: orthancUrlInput.value.trim(),
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
    showStatus('Проверка соединения с Orthanc...', 'success');
    const config = {
      orthancUrl: orthancUrlInput.value.trim(),
      username: usernameInput.value.trim(),
      password: passwordInput.value.trim()
    };

    chrome.runtime.sendMessage({ action: 'TEST_CONNECTION', config }, (res) => {
      if (res && res.success) {
        showStatus(`Соединение успешно! Orthanc версия: ${res.version}`, 'success');
      } else {
        showStatus(`Ошибка соединения: ${res.error}`, 'error');
      }
    });
  });

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `status ${type}`;
  }
});
