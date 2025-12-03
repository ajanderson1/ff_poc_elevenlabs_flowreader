/**
 * config.js - Centralized configuration for the extension.
 *
 * This file is loaded by:
 * - background.js via importScripts()
 * - content.js via manifest.json content_scripts
 */

const CONFIG = {
    // ==========================================================================
    // LOGGING
    // ==========================================================================
    logging: {
        prefix: '[FF]'
    },

    // ==========================================================================
    // CACHE SETTINGS
    // ==========================================================================
    cache: {
        prefix: 'translation_cache_',
        version: 1
    },

    // ==========================================================================
    // OPENAI API SETTINGS
    // ==========================================================================
    api: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        // model: 'gpt-4o-mini',
        model: 'gpt-5-mini-2025-08-07',
        responseFormat: { type: 'json_object' }
    },

    // ==========================================================================
    // RETRY STRATEGY
    // Note: gpt-5-mini only supports temperature=1 (default)
    // ==========================================================================
    retry: [
        { temperature: 1, delay: 0 },
        { temperature: 1, delay: 1000 },
        { temperature: 1, delay: 2000 }
    ],

    // ==========================================================================
    // DOM SELECTORS
    // ==========================================================================
    selectors: {
        // All translatable text elements (paragraphs and headers)
        translatable: 'p, h1, h2, h3, h4, h5, h6'
    },

    // ==========================================================================
    // TIMING / THRESHOLDS
    // ==========================================================================
    timing: {
        doublePressThreshold: 300  // ms - for double arrow key detection
    },

    // ==========================================================================
    // COST ESTIMATION
    // ==========================================================================
    costEstimation: {
        // ElevenLabs Reader: ~833 characters per minute
        elevenLabsCharsPerMinute: 833,
        // OpenAI GPT-4o-mini pricing (per million tokens)
        openai: {
            inputPerMillion: 0.15,   // $0.15 per 1M input tokens
            outputPerMillion: 0.60   // $0.60 per 1M output tokens
        }
    },

    // ==========================================================================
    // RECOMMENDED VOICES
    // Voices optimized for French language learning
    // ==========================================================================
    recommendedVoices: [
        'Voix info IA',
        'Marcel',
        'Adina',
        'Martin Dupont Intime',
        'Nova',
        'Hugo',
        'Guillaume',
        'Camille Martin',
        'Mademoiselle French',
        'Jérémy',
        'Christian Page V2',
        'Xavier',
        'Adrien Clairon'
    ],

    // ==========================================================================
    // RUNTIME DEFAULTS
    // These can be overridden by user settings from chrome.storage
    // ==========================================================================
    defaults: {
        enabled: true,
        debugClauses: true,
        currentSegmentationType: 'Clause',
        individualTranslations: true,
        limitSingleParagraph: false
    }
};

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

/**
 * Get retry configuration for a given attempt number.
 * @param {number} attempt - Attempt number (1-indexed)
 * @returns {{ temperature: number, delay: number }}
 */
function getRetryConfig(attempt) {
    const index = Math.min(attempt - 1, CONFIG.retry.length - 1);
    return CONFIG.retry[index];
}

/**
 * Get the maximum number of retries allowed.
 * @returns {number}
 */
function getMaxRetries() {
    return CONFIG.retry.length;
}
