// ============================================================
// RECOMMENDED VOICES CONFIGURATION
// ============================================================
// Voices are loaded from config/recommended_voices.txt
// (one voice name per line, case-insensitive matching)
// ============================================================

let RECOMMENDED_VOICES = [];

// Load recommended voices from external config file
async function loadRecommendedVoices() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/recommended_voices.txt'));
    const text = await response.text();
    RECOMMENDED_VOICES = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    return RECOMMENDED_VOICES;
  } catch (error) {
    console.error('Failed to load recommended voices:', error);
    return [];
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load recommended voices first
  await loadRecommendedVoices();
  const toggle = document.getElementById('toggle-extension');
  const individualTranslationsToggle = document.getElementById('individual-translations');
  const partitioningToggle = document.getElementById('partitioning-enabled');
  const limitSingleParagraphToggle = document.getElementById('limit-single-paragraph');
  const debugLoggingToggle = document.getElementById('debug-logging');
  const apiKeyInput = document.getElementById('api-key');
  const saveBtn = document.getElementById('save-key');
  const statusMsg = document.getElementById('status-msg');
  const clearCacheBtn = document.getElementById('clear-cache');
  const cacheStatusMsg = document.getElementById('cache-status-msg');
  const voiceInfoSection = document.getElementById('voice-info');
  const voiceNameEl = document.getElementById('voice-name');
  const voiceWarningEl = document.getElementById('voice-warning');
  const voiceBannerEl = document.getElementById('voice-banner');
  const voiceRecommendationEl = document.getElementById('voice-recommendation');
  const recommendedVoicesListEl = document.getElementById('recommended-voices-list');

  // Populate the tooltip with recommended voices
  populateRecommendedVoicesList();

  // Check current voice on the active tab
  checkCurrentVoice();

  function populateRecommendedVoicesList() {
    recommendedVoicesListEl.innerHTML = '';
    RECOMMENDED_VOICES.forEach(voice => {
      const li = document.createElement('li');
      li.textContent = voice;
      recommendedVoicesListEl.appendChild(li);
    });
  }

  // Load saved settings
  chrome.storage.sync.get(['enabled', 'openaiApiKey', 'individualTranslations', 'partitioningEnabled', 'limitSingleParagraph', 'debugLogging'], (result) => {
    toggle.checked = result.enabled !== false; // Default true
    individualTranslationsToggle.checked = result.individualTranslations !== false; // Default true
    partitioningToggle.checked = result.partitioningEnabled === true; // Default false (debug feature)
    limitSingleParagraphToggle.checked = result.limitSingleParagraph === true; // Default false (process all paragraphs)
    debugLoggingToggle.checked = result.debugLogging === true; // Default false
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }
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

  // Save debug logging state
  debugLoggingToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ debugLogging: debugLoggingToggle.checked });
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

  // Check the current voice on the active tab
  function checkCurrentVoice() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        updateVoiceDisplay(null, false);
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_CURRENT_VOICE' }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not loaded (not on elevenreader.io)
          updateVoiceDisplay(null, false);
          return;
        }

        if (response) {
          updateVoiceDisplay(response.voiceName, response.isElevenReaderPage);
        } else {
          updateVoiceDisplay(null, false);
        }
      });
    });
  }

  // Update the voice display in the popup
  function updateVoiceDisplay(voiceName, isElevenReaderPage) {
    // Reset all display elements
    voiceWarningEl.style.display = 'none';
    voiceBannerEl.style.display = 'none';
    voiceRecommendationEl.style.display = 'none';

    if (!isElevenReaderPage) {
      voiceInfoSection.className = 'voice-info-section not-reader';
      voiceNameEl.textContent = 'Not on ElevenReader';
      return;
    }

    if (!voiceName) {
      voiceInfoSection.className = 'voice-info-section not-reader';
      voiceNameEl.textContent = 'Unable to detect voice';
      return;
    }

    // Check if the voice is in our recommended list
    const isRecommended = RECOMMENDED_VOICES.some(
      v => voiceName.toLowerCase().includes(v.toLowerCase())
    );

    if (isRecommended) {
      voiceInfoSection.className = 'voice-info-section success';
      voiceNameEl.textContent = voiceName;
      // Show recommended banner
      voiceBannerEl.innerHTML = '<img src="assets/recommended_voice.png" alt="Recommended Voice">';
      voiceBannerEl.style.display = 'block';
    } else {
      voiceInfoSection.className = 'voice-info-section warning';
      voiceNameEl.textContent = voiceName;
      // Show not recommended banner
      voiceBannerEl.innerHTML = '<img src="assets/not_recommended_voice.png" alt="Not Recommended Voice">';
      voiceBannerEl.style.display = 'block';
      // Show recommendation message with info icon
      voiceRecommendationEl.style.display = 'flex';
    }
  }
});
