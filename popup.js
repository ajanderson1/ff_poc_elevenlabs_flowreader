document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-extension');
  const individualTranslationsToggle = document.getElementById('individual-translations');
  const partitioningToggle = document.getElementById('partitioning-enabled');
  const limitSingleParagraphToggle = document.getElementById('limit-single-paragraph');
  const apiKeyInput = document.getElementById('api-key');
  const saveBtn = document.getElementById('save-key');
  const statusMsg = document.getElementById('status-msg');
  const clearCacheBtn = document.getElementById('clear-cache');
  const cacheStatusMsg = document.getElementById('cache-status-msg');

  // Shadowing controls
  const shadowingToggle = document.getElementById('shadowing-enabled');
  const shadowingRepetitions = document.getElementById('shadowing-repetitions');
  const shadowingPauseSpeed = document.getElementById('shadowing-pause-speed');
  const shadowingBlockType = document.getElementById('shadowing-block-type');
  const pauseSpeedValue = document.getElementById('pause-speed-value');

  // Load saved settings
  chrome.storage.sync.get([
    'enabled',
    'openaiApiKey',
    'individualTranslations',
    'partitioningEnabled',
    'limitSingleParagraph',
    'shadowingEnabled',
    'shadowingRepetitions',
    'shadowingPauseSpeed',
    'shadowingBlockType'
  ], (result) => {
    toggle.checked = result.enabled !== false; // Default true
    individualTranslationsToggle.checked = result.individualTranslations !== false; // Default true
    partitioningToggle.checked = result.partitioningEnabled === true; // Default false (debug feature)
    limitSingleParagraphToggle.checked = result.limitSingleParagraph === true; // Default false (process all paragraphs)
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }

    // Shadowing settings
    shadowingToggle.checked = result.shadowingEnabled === true; // Default false
    shadowingRepetitions.value = result.shadowingRepetitions || 1;
    shadowingPauseSpeed.value = result.shadowingPauseSpeed || 1;
    pauseSpeedValue.textContent = (result.shadowingPauseSpeed || 1).toFixed(1) + 'x';
    shadowingBlockType.checked = result.shadowingBlockType === 'sentence'; // Default: meaning blocks (unchecked)
  });

  // Save enabled state
  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggle.checked });
  });

  // Save individual translations state
  individualTranslationsToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ individualTranslations: individualTranslationsToggle.checked });
  });

  // Save partitioning enabled state
  partitioningToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ partitioningEnabled: partitioningToggle.checked });
  });

  // Save limit single paragraph state
  limitSingleParagraphToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ limitSingleParagraph: limitSingleParagraphToggle.checked });
  });

  // Shadowing settings handlers
  shadowingToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ shadowingEnabled: shadowingToggle.checked });
  });

  shadowingRepetitions.addEventListener('change', () => {
    let value = parseInt(shadowingRepetitions.value, 10);
    if (isNaN(value) || value < 1) value = 1;
    if (value > 10) value = 10;
    shadowingRepetitions.value = value;
    chrome.storage.sync.set({ shadowingRepetitions: value });
  });

  shadowingPauseSpeed.addEventListener('input', () => {
    const value = parseFloat(shadowingPauseSpeed.value);
    pauseSpeedValue.textContent = value.toFixed(1) + 'x';
    chrome.storage.sync.set({ shadowingPauseSpeed: value });
  });

  shadowingBlockType.addEventListener('change', () => {
    const blockType = shadowingBlockType.checked ? 'sentence' : 'meaning';
    chrome.storage.sync.set({ shadowingBlockType: blockType });
  });

  // Save API Key
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter a key.', 'red');
      return;
    }
    chrome.storage.sync.set({ openaiApiKey: key }, () => {
      showStatus('API Key Saved!', 'green');
    });
  });

  function showStatus(msg, color) {
    statusMsg.textContent = msg;
    statusMsg.style.color = color;
    setTimeout(() => {
      statusMsg.textContent = '';
    }, 3000);
  }

  function showCacheStatus(msg, color) {
    cacheStatusMsg.textContent = msg;
    cacheStatusMsg.style.color = color;
    setTimeout(() => {
      cacheStatusMsg.textContent = '';
    }, 3000);
  }

  // Clear translation cache
  clearCacheBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_CACHE' }, (response) => {
      if (chrome.runtime.lastError) {
        showCacheStatus('Error: ' + chrome.runtime.lastError.message, 'red');
        return;
      }
      if (response && response.success) {
        const count = response.count || 0;
        if (count > 0) {
          showCacheStatus(`Cleared ${count} cached translation${count === 1 ? '' : 's'}`, 'green');
        } else {
          showCacheStatus('Cache is already empty', '#666');
        }
      } else {
        showCacheStatus('Failed to clear cache', 'red');
      }
    });
  });
});
