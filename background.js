// Background script for ElevenLabs Translator

// Load prompt configuration, semantic validation, and retry strategy
importScripts('prompts.js');

// --- Cache Configuration ---
const CACHE_PREFIX = 'translation_cache_';
const CACHE_VERSION = 1;

/**
 * Generates a cache key for a given URL.
 * @param {string} url - The page URL
 * @returns {string} Cache key
 */
function getCacheKey(url) {
    return CACHE_PREFIX + url;
}

/**
 * Retrieves cached translations for a URL.
 * @param {string} url - The page URL
 * @returns {Promise<object|null>} Cached data or null if not found
 */
async function getCachedTranslations(url) {
    const key = getCacheKey(url);
    const result = await chrome.storage.local.get([key]);
    const cached = result[key];

    if (cached && cached.version === CACHE_VERSION) {
        console.log('ElevenLabs Translator: Cache hit for', url);
        return cached;
    }
    return null;
}

/**
 * Stores translations in the cache.
 * @param {string} url - The page URL
 * @param {Array<object>} paragraphs - Array of paragraph translation data
 */
async function setCachedTranslations(url, paragraphs) {
    const key = getCacheKey(url);
    const cacheData = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        paragraphs: paragraphs
    };

    try {
        await chrome.storage.local.set({ [key]: cacheData });
        console.log('ElevenLabs Translator: Cached translations for', url);
    } catch (error) {
        console.warn('ElevenLabs Translator: Failed to cache translations:', error.message);
    }
}

/**
 * Clears all cached translations.
 * @returns {Promise<number>} Number of cache entries cleared
 */
async function clearAllCachedTranslations() {
    const allItems = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(allItems).filter(key => key.startsWith(CACHE_PREFIX));

    if (cacheKeys.length > 0) {
        await chrome.storage.local.remove(cacheKeys);
        console.log('ElevenLabs Translator: Cleared', cacheKeys.length, 'cached translations');
    }

    return cacheKeys.length;
}

// System prompt is now loaded from prompts.js via SYSTEM_PROMPT constant

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'PARTITION_TEXT') {
        handlePositionBasedPartitioning(request.wordData)
            .then(function(result) {
                sendResponse({ success: true, data: result });
            })
            .catch(function(error) {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'GET_CACHED_TRANSLATIONS') {
        getCachedTranslations(request.url)
            .then(function(cached) {
                sendResponse({ success: true, data: cached });
            })
            .catch(function(error) {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'SET_CACHED_TRANSLATIONS') {
        setCachedTranslations(request.url, request.paragraphs)
            .then(function() {
                sendResponse({ success: true });
            })
            .catch(function(error) {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'CLEAR_CACHE') {
        clearAllCachedTranslations()
            .then(function(count) {
                sendResponse({ success: true, count: count });
            })
            .catch(function(error) {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    return false;
});

/**
 * Validates LLM response structure and data integrity.
 * @param {object} parsed - Parsed JSON response
 * @param {Array<{c: number}>} words - Original word data
 * @returns {{ valid: boolean, error?: string }}
 */
function validateLLMResponse(parsed, words) {
    // 1. Check blocks array exists
    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
        console.error('ElevenLabs Translator: Validation failed - missing or invalid blocks array');
        return { valid: false, error: 'Missing or invalid blocks array' };
    }

    // 2. Check blocks is not empty
    if (parsed.blocks.length === 0) {
        console.error('ElevenLabs Translator: Validation failed - empty blocks array');
        return { valid: false, error: 'Empty blocks array' };
    }

    // 3. Build valid c values set
    const validCValues = new Set(words.map(w => w.c));
    const validCArray = Array.from(validCValues).sort((a, b) => a - b);

    console.log('ElevenLabs Translator: Validating response');
    console.log('Valid C values from input:', validCArray);
    console.log('Total blocks to validate:', parsed.blocks.length);

    // 4. Validate each block
    for (let i = 0; i < parsed.blocks.length; i++) {
        const block = parsed.blocks[i];

        // Check required fields
        if (typeof block.start_c !== 'number' || typeof block.end_c !== 'number') {
            console.error(`Block ${i} INVALID - missing start_c or end_c:`, JSON.stringify(block));
            return { valid: false, error: `Block ${i}: missing start_c or end_c` };
        }

        if (!block.translation || typeof block.translation !== 'string') {
            console.error(`Block ${i} INVALID - missing or invalid translation:`, JSON.stringify(block));
            return { valid: false, error: `Block ${i}: missing or invalid translation` };
        }

        // Check c values exist in word map
        if (!validCValues.has(block.start_c)) {
            console.error(`Block ${i} INVALID - start_c ${block.start_c} not in valid set:`, validCArray);
            console.error('Block details:', JSON.stringify(block));
            return { valid: false, error: `Block ${i}: start_c ${block.start_c} not in word map` };
        }

        if (!validCValues.has(block.end_c)) {
            console.error(`Block ${i} INVALID - end_c ${block.end_c} not in valid set:`, validCArray);
            console.error('Block details:', JSON.stringify(block));
            return { valid: false, error: `Block ${i}: end_c ${block.end_c} not in word map` };
        }

        // Check start_c <= end_c
        if (block.start_c > block.end_c) {
            console.error(`Block ${i} INVALID - start_c > end_c:`, JSON.stringify(block));
            return { valid: false, error: `Block ${i}: start_c > end_c` };
        }
    }

    // 5. Check for overlapping blocks
    const sortedBlocks = [...parsed.blocks].sort((a, b) => a.start_c - b.start_c);
    for (let i = 1; i < sortedBlocks.length; i++) {
        if (sortedBlocks[i].start_c <= sortedBlocks[i - 1].end_c) {
            console.error(`Blocks ${i-1} and ${i} OVERLAP:`, JSON.stringify(sortedBlocks[i-1]), JSON.stringify(sortedBlocks[i]));
            return { valid: false, error: `Blocks ${i-1} and ${i} overlap` };
        }
    }

    console.log('ElevenLabs Translator: Validation passed - all blocks valid');
    return { valid: true };
}

function validateBlockCoverage(blocks, words) {
    if (blocks.length === 0) {
        console.warn('ElevenLabs Translator: No blocks returned');
        return;
    }

    var sortedBlocks = blocks.slice().sort(function(a, b) { return a.start_c - b.start_c; });
    var sortedWords = words.slice().sort(function(a, b) { return a.c - b.c; });

    var expectedNextC = sortedWords[0] ? sortedWords[0].c : 0;

    for (var i = 0; i < sortedBlocks.length; i++) {
        var block = sortedBlocks[i];

        if (block.start_c !== expectedNextC) {
            console.warn('ElevenLabs Translator: Gap detected - expected start_c ' + expectedNextC + ', got ' + block.start_c);
        }

        var endWordIndex = -1;
        for (var j = 0; j < sortedWords.length; j++) {
            if (sortedWords[j].c === block.end_c) {
                endWordIndex = j;
                break;
            }
        }
        if (endWordIndex >= 0 && endWordIndex < sortedWords.length - 1) {
            expectedNextC = sortedWords[endWordIndex + 1].c;
        }
    }

    console.log('ElevenLabs Translator: Block coverage validation completed');
}

// Retry configuration is now loaded from prompts.js via getRetryConfig() and getMaxRetries()

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Handles position-based text partitioning with the LLM.
 * Uses semantic validation and temperature escalation on retries.
 * @param {object} wordData - Object with 'words' array containing {c, text} objects
 * @returns {Promise<object>} Parsed LLM response with blocks array
 */
async function handlePositionBasedPartitioning(wordData) {
    var result = await chrome.storage.sync.get(['openaiApiKey']);
    var openaiApiKey = result.openaiApiKey;

    if (!openaiApiKey) {
        throw new Error('API Key not found. Please set it in the extension popup.');
    }

    // Create index-to-c mapping and simplified word array for LLM
    // This makes the LLM's job trivial: just use sequential indices 0,1,2,3...
    const indexToCMap = {};
    const simplifiedWords = wordData.words.map((word, index) => {
        indexToCMap[index] = word.c;
        return { i: index, w: word.text };
    });

    var userContent = JSON.stringify(simplifiedWords);

    // Debug logging for LLM input
    console.log('ElevenLabs Translator: Sending to LLM');
    console.log('Word count:', wordData.words.length);
    console.log('Index mapping sample:', Object.entries(indexToCMap).slice(0, 5).map(([i, c]) => `${i}->${c}`).join(', '));
    console.log('Words preview:', simplifiedWords.slice(0, 5).map(w => `${w.i}:"${w.w}"`).join(', '));

    const maxRetries = getMaxRetries();
    let lastError = null;
    let bestResult = null;  // Store best result in case all retries have semantic issues

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Get retry configuration with escalating temperature
        const retryConfig = getRetryConfig(attempt);

        // Build request body with dynamic temperature from retry config
        var requestBody = {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userContent }
            ],
            temperature: retryConfig.temperature,
            response_format: { type: 'json_object' }
        };

        try {
            console.log(`ElevenLabs Translator: API attempt ${attempt}/${maxRetries} (temperature: ${retryConfig.temperature})`);

            var response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + openaiApiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                var errorData = await response.json();
                const errorMsg = errorData.error ? errorData.error.message : 'OpenAI API request failed';

                // Don't retry on auth errors (401)
                if (response.status === 401) {
                    throw new Error('Invalid API key: ' + errorMsg);
                }

                throw new Error(`API error (${response.status}): ${errorMsg}`);
            }

            var data = await response.json();
            console.log('ElevenLabs Translator: API response received');
            var content = data.choices[0].message.content;

            // Extract token usage for cost tracking
            const tokenUsage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };

            var jsonStr = content.trim();
            if (jsonStr.indexOf('```json') === 0) {
                jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
            } else if (jsonStr.indexOf('```') === 0) {
                jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
            }

            var parsed;
            try {
                parsed = JSON.parse(jsonStr);
            } catch (parseError) {
                throw new Error('Failed to parse JSON response: ' + parseError.message);
            }

            // Debug logging for raw LLM response
            console.log('ElevenLabs Translator: Raw LLM response:', JSON.stringify(parsed, null, 2));

            // Convert simplified format (s, e, t) back to original format (start_c, end_c, original, translation)
            if (parsed.blocks && Array.isArray(parsed.blocks)) {
                parsed.blocks = parsed.blocks.map(block => {
                    // Handle both old format (start_c, end_c) and new format (s, e)
                    const startIndex = block.s !== undefined ? block.s : block.start_c;
                    const endIndex = block.e !== undefined ? block.e : block.end_c;

                    // Map indices back to real c values
                    const start_c = indexToCMap[startIndex] !== undefined ? indexToCMap[startIndex] : startIndex;
                    const end_c = indexToCMap[endIndex] !== undefined ? indexToCMap[endIndex] : endIndex;

                    // Reconstruct original text from words if not provided
                    let original = block.original || '';
                    if (!original && startIndex !== undefined && endIndex !== undefined) {
                        const wordsInBlock = [];
                        for (let idx = startIndex; idx <= endIndex; idx++) {
                            if (wordData.words[idx]) {
                                wordsInBlock.push(wordData.words[idx].text);
                            }
                        }
                        original = wordsInBlock.join(' ');
                    }

                    return {
                        start_c: start_c,
                        end_c: end_c,
                        original: original,
                        translation: block.t || block.translation || ''
                    };
                });
            }

            console.log('ElevenLabs Translator: Converted blocks:', parsed.blocks?.slice(0, 3));

            // Structural validation (existing)
            const structuralValidation = validateLLMResponse(parsed, wordData.words);
            if (!structuralValidation.valid) {
                throw new Error('Structural: ' + structuralValidation.error);
            }

            // Coverage validation (existing)
            validateBlockCoverage(parsed.blocks, wordData.words);

            // Include token usage in the response
            parsed.tokenUsage = {
                promptTokens: tokenUsage.prompt_tokens,
                completionTokens: tokenUsage.completion_tokens
            };

            // Semantic validation (NEW) - check pedagogical rules
            const semanticValidation = validateSemantics(parsed.blocks, wordData.words);

            if (semanticValidation.violations.length > 0) {
                console.log('ElevenLabs Translator: Semantic violations found:');
                semanticValidation.violations.forEach(v => {
                    console.log(`  [${v.severity}] ${v.type}: ${v.message}`);
                    if (v.suggestion) {
                        console.log(`    Suggestion: ${v.suggestion}`);
                    }
                });
            }

            // Store as best result if structurally valid
            if (!bestResult || semanticValidation.violations.length < (bestResult.semanticViolations || []).length) {
                bestResult = parsed;
                bestResult.semanticViolations = semanticValidation.violations;
            }

            // If semantic validation passes or doesn't require retry, return
            if (!semanticValidation.shouldRetry) {
                console.log('ElevenLabs Translator: Semantic validation passed');
                return parsed;
            }

            // Semantic violations that should trigger retry
            const errorMsg = semanticValidation.violations
                .filter(v => v.severity === 'error')
                .map(v => v.message)
                .join('; ') || semanticValidation.violations[0].message;

            throw new Error('Semantic: ' + errorMsg);

        } catch (error) {
            lastError = error;
            console.warn(`ElevenLabs Translator: Attempt ${attempt} failed:`, error.message);

            // Don't retry on non-retryable errors
            if (error.message.includes('Invalid API key') ||
                error.message.includes('API Key not found')) {
                throw error;
            }

            // Wait before retry using config delay
            if (attempt < maxRetries) {
                const delay = retryConfig.delay || 1000;
                console.log(`ElevenLabs Translator: Retrying in ${delay}ms with higher temperature...`);
                await sleep(delay);
            }
        }
    }

    // If we have a structurally valid result but with semantic issues, return it with warning
    if (bestResult) {
        console.warn('ElevenLabs Translator: Returning best result despite semantic violations');
        return bestResult;
    }

    throw new Error(`Failed after ${maxRetries} attempts: ${lastError.message}`);
}
