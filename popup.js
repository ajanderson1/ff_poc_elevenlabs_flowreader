document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle-extension');
  const testingToggle = document.getElementById('toggle-testing');
  const individualTranslationsToggle = document.getElementById('individual-translations');
  const partitioningToggle = document.getElementById('partitioning-enabled');
  const apiKeyInput = document.getElementById('api-key');
  const saveBtn = document.getElementById('save-key');
  const statusMsg = document.getElementById('status-msg');

  // Load saved settings
  chrome.storage.sync.get(['enabled', 'openaiApiKey', 'testingMode', 'individualTranslations', 'partitioningEnabled'], (result) => {
    toggle.checked = result.enabled !== false; // Default true
    testingToggle.checked = result.testingMode === true; // Default false (live mode)
    individualTranslationsToggle.checked = result.individualTranslations !== false; // Default true
    partitioningToggle.checked = result.partitioningEnabled === true; // Default false (debug feature)
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }
  });

  // Save enabled state
  toggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggle.checked });
  });

  // Save testing state
  testingToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ testingMode: testingToggle.checked });
  });

  // Save individual translations state
  individualTranslationsToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ individualTranslations: individualTranslationsToggle.checked });
  });

  // Save partitioning enabled state
  partitioningToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ partitioningEnabled: partitioningToggle.checked });
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
});
