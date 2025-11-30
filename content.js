// --- Logging Utility ---
// Filter in DevTools console with: /^\[ELT\]/
const LOG_PREFIX = '[ELT]';
const Logger = {
    _enabled: true,
    _verboseErrors: false, // Set true to see full stack traces

    log(...args) {
        if (this._enabled) console.log(LOG_PREFIX, ...args);
    },
    debug(...args) {
        if (this._enabled && CONFIG.debugClauses) console.log(LOG_PREFIX, '[DEBUG]', ...args);
    },
    warn(...args) {
        if (this._enabled) console.warn(LOG_PREFIX, ...args);
    },
    error(msg, err) {
        if (this._enabled) {
            if (this._verboseErrors) {
                console.error(LOG_PREFIX, msg, err);
            } else {
                // Compact error: just message, no stack trace
                console.error(LOG_PREFIX, msg, err?.message || err);
            }
        }
    },
    /**
     * Outputs standardized training data for prompt refinement.
     * Shows both pipe-separated format and detailed breakdown.
     * @param {object} wordMap - The word map with {words: [{c, text}]}
     * @param {object} responseData - The LLM response with {blocks: [...]}
     */
    trainingOutput(wordMap, responseData) {
        if (!this._enabled || !CONFIG.debugClauses) return;

        const fullText = wordMap.words.map(w => w.text).join(' ');
        const blocks = responseData.blocks || [];

        // Pipe-separated format
        const partitioned = blocks.map(b => b.original).join(' | ');

        // Detailed format
        const separator = '═'.repeat(60);
        const lines = [
            '',
            separator,
            '📝 PARTITIONING TRAINING DATA',
            separator,
            '',
            '▶ ORIGINAL TEXT:',
            fullText,
            '',
            '▶ PARTITIONING RESULT:',
        ];

        blocks.forEach((block, i) => {
            lines.push(`  [${i + 1}] "${block.original}" → "${block.translation}"`);
        });

        lines.push('');
        lines.push('▶ COPYABLE JSON (for corrections):');
        lines.push(JSON.stringify({ blocks: blocks.map(b => ({
            original: b.original,
            translation: b.translation
        }))}, null, 2));
        lines.push('');
        lines.push(separator);

        // Output pipe format as main log line
        console.log(`${LOG_PREFIX} [TRAINING] ${partitioned}`);

        // Output detailed format in collapsed group
        console.groupCollapsed(`${LOG_PREFIX} [TRAINING DETAILS]`);
        console.log(lines.join('\n'));
        console.groupEnd();
    }
};

Logger.log("Content script loaded.");

// --- Cost Logging Functions ---
// These are always active (not tied to Debug Clauses toggle)

/**
 * Calculates OpenAI API cost from token counts.
 * @param {number} promptTokens - Input tokens
 * @param {number} completionTokens - Output tokens
 * @returns {number} Cost in USD
 */
function calculateOpenAICost(promptTokens, completionTokens) {
    const inputCost = (promptTokens / 1_000_000) * OPENAI_PRICING.inputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * OPENAI_PRICING.outputPerMillion;
    return inputCost + outputCost;
}

/**
 * Calculates estimated ElevenLabs Reader minutes from text.
 * @param {string} text - The original text being processed
 * @returns {number} Estimated minutes
 */
function calculateElevenLabsMinutes(text) {
    const charCount = text.length;
    return charCount / ELEVENLABS_CHARS_PER_MINUTE;
}

/**
 * Formats a number with commas for thousands.
 * @param {number} num - Number to format
 * @returns {string} Formatted string
 */
function formatNumber(num) {
    return num.toLocaleString();
}

/**
 * Logs cost information for a single paragraph.
 * Always active (not tied to Debug Clauses toggle).
 * @param {number} paragraphIndex - Index of the paragraph (1-based)
 * @param {string} originalText - The original text that was translated
 * @param {number} promptTokens - Input tokens used
 * @param {number} completionTokens - Output tokens used
 */
function logParagraphCost(paragraphIndex, originalText, promptTokens, completionTokens) {
    const elevenLabsMinutes = calculateElevenLabsMinutes(originalText);
    const openAICost = calculateOpenAICost(promptTokens, completionTokens);

    // Update running totals
    costTracker.totalElevenLabsMinutes += elevenLabsMinutes;
    costTracker.totalOpenAICost += openAICost;
    costTracker.totalPromptTokens += promptTokens;
    costTracker.totalCompletionTokens += completionTokens;
    costTracker.paragraphCount++;

    // Format and log
    console.log(
        `${LOG_PREFIX} 📊 Paragraph ${paragraphIndex} Cost:\n` +
        `      → ElevenLabs Reader: ${elevenLabsMinutes.toFixed(1)} min (of your subscription)\n` +
        `      → OpenAI API: $${openAICost.toFixed(5)} (${formatNumber(promptTokens)} in / ${formatNumber(completionTokens)} out tokens)`
    );
}

/**
 * Logs the total cost summary after all paragraphs are processed.
 * Always active (not tied to Debug Clauses toggle).
 */
function logTotalCostSummary() {
    if (costTracker.paragraphCount === 0) return;

    console.log(
        `${LOG_PREFIX} 📊 TOTAL COST SUMMARY:\n` +
        `      → ElevenLabs Reader: ${costTracker.totalElevenLabsMinutes.toFixed(1)} min (of your subscription)\n` +
        `      → OpenAI API: $${costTracker.totalOpenAICost.toFixed(5)} (${formatNumber(costTracker.totalPromptTokens)} in / ${formatNumber(costTracker.totalCompletionTokens)} out tokens)`
    );
}

// --- Cache Helper Functions ---

/**
 * Gets cached translations for the current page URL.
 * @returns {Promise<object|null>} Cached data or null if not found
 */
async function getCachedTranslations() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'GET_CACHED_TRANSLATIONS',
            url: window.location.href
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response && response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response?.error || 'Failed to get cached translations'));
            }
        });
    });
}

/**
 * Stores translations in the cache for the current page URL.
 * @param {Array<object>} paragraphs - Array of paragraph translation data
 * @returns {Promise<void>}
 */
async function setCachedTranslations(paragraphs) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'SET_CACHED_TRANSLATIONS',
            url: window.location.href,
            paragraphs: paragraphs
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response && response.success) {
                resolve();
            } else {
                reject(new Error(response?.error || 'Failed to cache translations'));
            }
        });
    });
}

// --- Configuration ---
const CONFIG = {
    enabled: true,
    debugClauses: true, // For debug logging
    currentSegmentationType: 'Clause', // Default segmentation type
    individualTranslations: true, // Default true - hover to reveal individual translations
    limitSingleParagraph: false // When true, only process the first paragraph (saves API calls during testing)
};

// Selector for all translatable text elements (paragraphs and headers)
const TRANSLATABLE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6';

// Removed multi-type segmentation constants - now using single Meaning Blocks approach

// Single color for all meaning blocks - Light Blue
const MEANING_BLOCK_COLOR = {
    bg: 'rgba(66, 165, 245, 0.3)',
    border: 'rgba(66, 165, 245, 0.9)'
};

// --- State ---
let isProcessing = false;
let hasProcessedInitially = false; // Ensures LLM call only happens once per page load
let activeOverlays = []; // Stores { range, overlayElement, debugElement, type }
let isUsingCachedTranslations = false; // Track if we're loading from cache

// --- Shadowing State ---
const shadowingState = {
    enabled: false,
    repetitions: 1,
    pauseSpeed: 1.0,
    blockType: 'meaningBlock', // or 'sentence'
    isInPause: false,
    currentBlockIndex: -1,
    currentRepetition: 0,
    pauseTimer: null,
    pauseStartTime: 0,
    pauseDuration: 0,
    lastBlockEndC: -1, // Track last block boundary we passed
    countdownElement: null,
    isWaitingForBlockEnd: false
};

// --- Cost Tracking State ---
// Running totals for cost summary (reset per page load)
const costTracker = {
    totalElevenLabsMinutes: 0,
    totalOpenAICost: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    paragraphCount: 0
};

// --- Cost Calculation Constants ---
// GPT-4o-mini pricing (per million tokens)
const OPENAI_PRICING = {
    inputPerMillion: 0.15,   // $0.15 per 1M input tokens
    outputPerMillion: 0.60   // $0.60 per 1M output tokens
};
// ElevenLabs Reader: ~833 characters per minute
const ELEVENLABS_CHARS_PER_MINUTE = 833;

// --- Text Extraction & Tokenization ---

/**
 * Extracts a list of tokens from a paragraph.
 * Each token represents a word or significant whitespace/punctuation sequence.
 * Returns: { fullText: string, tokens: Array<{ text: string, node: TextNode, start: number, end: number }> }
 */
function extractTokens(p) {
    let fullText = '';
    const tokens = [];

    function traverse(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const nodeText = node.textContent;
            if (nodeText.length > 0) {
                // Use Intl.Segmenter for robust word/punctuation segmentation
                if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
                    const segments = segmenter.segment(nodeText);
                    for (const seg of segments) {
                        const part = seg.segment;
                        const start = fullText.length;
                        fullText += part;
                        const end = fullText.length;

                        tokens.push({
                            text: part,
                            node: node,
                            nodeStart: seg.index,
                            nodeEnd: seg.index + part.length,
                            globalStart: start,
                            globalEnd: end
                        });
                    }
                } else {
                    // Fallback for environments without Intl.Segmenter
                    const parts = nodeText.split(/([^\s\w]+|\s+)/).filter(s => s.length > 0);
                    let currentOffset = 0;
                    parts.forEach(part => {
                        const start = fullText.length;
                        fullText += part;
                        const end = fullText.length;
                        tokens.push({
                            text: part,
                            node: node,
                            nodeStart: currentOffset,
                            nodeEnd: currentOffset + part.length,
                            globalStart: start,
                            globalEnd: end
                        });
                        currentOffset += part.length;
                    });
                }
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Skip existing overlays
            if (node.classList.contains('translation-overlay') ||
                node.classList.contains('translation-overlay-container') ||
                node.classList.contains('clause-debug-highlight') ||
                node.id === 'elevenlabs-translator-toggle' ||
                node.id === 'elevenlabs-processing-banner') {
                return;
            }
            node.childNodes.forEach(traverse);
        }
    }

    traverse(p);
    return { fullText, tokens };
}

/**
 * Extracts words with c (character position) attributes from a paragraph.
 * Used for position-based mapping with the LLM.
 * @param {HTMLParagraphElement} paragraph - The paragraph element
 * @param {number} paragraphIndex - Index for tracking
 * @returns {{ paragraphIndex: number, paragraphElement: HTMLParagraphElement, words: Array<{c: number, text: string, spanElement: HTMLSpanElement}> }}
 */
function extractWordMap(paragraph, paragraphIndex) {
    const words = [];
    const spans = paragraph.querySelectorAll('span[c]');

    spans.forEach(span => {
        const cAttr = span.getAttribute('c');
        const cValue = parseInt(cAttr, 10);

        if (isNaN(cValue)) {
            Logger.warn("Invalid c attribute:", cAttr, "in span:", span.textContent);
            return;
        }

        const text = span.textContent.trim();
        if (!text) return;

        words.push({ c: cValue, text, spanElement: span });
    });

    // Sort by c value to ensure correct order
    words.sort((a, b) => a.c - b.c);

    return { paragraphIndex, paragraphElement: paragraph, words };
}

/**
 * Maps LLM translation segments back to DOM spans using c values.
 * Uses the 'original' text field to determine word count, falling back to end_c if unavailable.
 * This is more reliable than trusting end_c which may be miscalculated by the LLM.
 * @param {{ words: Array<{c: number, text: string, spanElement: HTMLSpanElement}> }} wordMap
 * @param {Array<{start_c: number, end_c: number, original: string, translation: string, type: string}>} segments
 * @returns {Array<{segment: object, spans: HTMLSpanElement[], range: Range}>}
 */
function mapSegmentsToSpans(wordMap, segments) {
    const mapped = [];

    for (const segment of segments) {
        const { start_c, end_c, original, translation, type } = segment;

        // Find the starting word index
        const startIdx = wordMap.words.findIndex(w => w.c === start_c);
        if (startIdx === -1) {
            Logger.warn("Invalid start_c:", start_c);
            continue;
        }

        // Strategy: Use 'original' text to determine how many words to include
        // This is more reliable than trusting end_c which may be miscalculated
        let spansInRange;

        if (original) {
            // Normalize LLM's original text for comparison
            const originalWords = original.trim().split(/\s+/);
            const expectedWordCount = originalWords.length;

            // Take the expected number of words starting from startIdx
            spansInRange = wordMap.words.slice(startIdx, startIdx + expectedWordCount);

            // Validate we got the right text
            const capturedText = spansInRange.map(s => s.text).join(' ');
            const normalizedOriginal = originalWords.join(' ');

            if (capturedText.toLowerCase() !== normalizedOriginal.toLowerCase()) {
                Logger.debug("Text mismatch after word-count mapping:",
                    { original: normalizedOriginal, captured: capturedText, start_c, end_c });
            }
        } else {
            // Fallback to end_c-based mapping if no original text
            const endIdx = wordMap.words.findIndex(w => w.c === end_c);
            if (endIdx === -1 || endIdx < startIdx) {
                Logger.warn("Invalid end_c or order:", { start_c, end_c });
                continue;
            }
            spansInRange = wordMap.words.slice(startIdx, endIdx + 1);
        }

        if (spansInRange.length === 0) {
            Logger.warn("No spans found for segment:", { start_c, end_c, translation });
            continue;
        }

        const firstSpan = spansInRange[0].spanElement;
        const lastSpan = spansInRange[spansInRange.length - 1].spanElement;

        // Create Range for positioning
        const range = document.createRange();
        range.setStartBefore(firstSpan);
        range.setEndAfter(lastSpan);

        mapped.push({
            segment: {
                original: spansInRange.map(s => s.text).join(' '),
                translation,
                type
            },
            spans: spansInRange.map(s => s.spanElement),
            range
        });
    }

    return mapped;
}

// --- Translation Service ---

/**
 * Fetches translations using position-based mapping with c attributes.
 * @param {{ words: Array<{c: number, text: string}> }} wordMap - Word map with positions
 * @returns {Promise<object>} Translation response with start_c/end_c segments
 */
async function fetchMeaningBlocks(wordMap) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: 'PARTITION_TEXT',
            wordData: { words: wordMap.words.map(w => ({ c: w.c, text: w.text })) }
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response && response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response?.error || 'Unknown error'));
            }
        });
    });
}

// Removed legacy fetchTranslations function - now using fetchMeaningBlocks only

// --- Mapping Logic ---

/**
 * Aligns LLM segments to client-side tokens sequentially.
 * Returns a list of { segment, range } objects.
 */
function alignSegmentsToTokens(tokens, segments) {
    const aligned = [];
    let tokenIndex = 0;

    for (const segment of segments) {
        const segText = segment.original.trim();
        if (!segText) continue;

        // Normalize segment text for matching
        // We only strip whitespace to ensure punctuation is matched exactly as returned by the LLM.
        const targetClean = segText.replace(/\s+/g, '').toLowerCase();

        // Find start token
        // We look for a sequence of tokens that matches the start of the segment
        let bestMatchStart = -1;
        let bestMatchEnd = -1;

        // Search forward from current tokenIndex
        for (let i = tokenIndex; i < tokens.length; i++) {
            let currentClean = "";
            let currentRaw = "";

            // Track best match for this starting position
            let bestJForI = -1;
            let bestDiffForI = Infinity;

            for (let j = i; j < tokens.length; j++) {
                // Accumulate token text
                const tokenText = tokens[j].text;
                // Only strip whitespace
                const tokenClean = tokenText.replace(/\s+/g, '').toLowerCase();

                currentClean += tokenClean;
                currentRaw += tokenText;

                // Check for exact match of content
                if (currentClean === targetClean) {
                    // Found a content match. Now check if the raw length is closer.
                    const diff = Math.abs(currentRaw.trim().length - segText.trim().length);

                    if (diff < bestDiffForI) {
                        bestDiffForI = diff;
                        bestJForI = j;
                    }
                }

                // If we exceeded length, stop this inner loop
                if (currentClean.length > targetClean.length) {
                    break;
                }
            }

            // If we found a match starting at i
            if (bestJForI !== -1) {
                bestMatchStart = i;
                bestMatchEnd = bestJForI;
                break; // Found the first valid sequence of tokens that matches
            }
        }

        if (bestMatchStart !== -1) {
            const startToken = tokens[bestMatchStart];
            const endToken = tokens[bestMatchEnd];

            const range = document.createRange();
            range.setStart(startToken.node, startToken.nodeStart);
            range.setEnd(endToken.node, endToken.nodeEnd);

            aligned.push({ segment, range });

            // Advance tokenIndex
            tokenIndex = bestMatchEnd + 1;
        } else {
            Logger.warn("Could not match segment:", segText);
            // Don't advance tokenIndex blindly, maybe the next segment will match later?
            // But if we skip, we might desync. 
            // Let's try to find the next segment from the current position.
        }
    }
    return aligned;
}

// --- DOM Injection & Rendering ---

/**
 * Unwraps a meaning block wrapper, moving its children back to the parent.
 * @param {HTMLSpanElement} wrapper - The wrapper element to unwrap
 */
function unwrapMeaningBlock(wrapper) {
    if (!wrapper || !wrapper.parentNode) return;

    const parent = wrapper.parentNode;
    // Move all children back to parent before the wrapper
    while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
    }
    // Remove the now-empty wrapper
    wrapper.remove();
}

/**
 * Temporarily unwraps all meaning block wrappers to restore original DOM structure.
 * This is needed before triggering ElevenLabs audio resume to avoid React DOM conflicts.
 * @returns {boolean} True if any wrappers were unwrapped
 */
function temporarilyUnwrapAllMeaningBlocks() {
    const wrappers = document.querySelectorAll('.elt-meaning-block');
    Logger.log("Shadowing: Found", wrappers.length, "meaning block wrappers to unwrap");

    if (wrappers.length === 0) return false;

    // Convert to array since unwrapping modifies the DOM
    const wrapperArray = Array.from(wrappers);
    wrapperArray.forEach(wrapper => {
        try {
            unwrapMeaningBlock(wrapper);
        } catch (e) {
            Logger.error("Shadowing: Error unwrapping block:", e);
        }
    });

    // Clear wrapper references from activeOverlays
    activeOverlays.forEach(overlay => {
        overlay.wrapper = null;
    });

    Logger.log("Shadowing: Unwrapped all meaning blocks");
    return true;
}

function clearOverlays(p) {
    if (p._translationOverlays) {
        p._translationOverlays.forEach(el => {
            // Unwrap meaning block wrappers (restore original DOM)
            if (el.classList && el.classList.contains('elt-meaning-block')) {
                unwrapMeaningBlock(el);
            } else {
                el.remove();
            }
        });
        p._translationOverlays = [];
    }
    // Also clear from global activeOverlays
    activeOverlays = activeOverlays.filter(item => {
        if (p.contains(item.range.startContainer)) {
            if (item.overlayElement) item.overlayElement.remove();
            if (item.debugElement) item.debugElement.remove();
            if (item.wrapper) unwrapMeaningBlock(item.wrapper);
            return false;
        }
        return true;
    });
}

/**
 * Shows an individual translation overlay on hover (when feature is enabled)
 * @param {object} overlayData - The overlay data from activeOverlays
 */
function showIndividualTranslation(overlayData) {
    if (!CONFIG.individualTranslations) return;
    if (translationsVisible) return; // Don't interfere when all translations are shown

    // Show this overlay
    overlayData.overlayElement.classList.add('elt-individual-visible');

    // Add hover class to wrapper for background/underline visibility
    if (overlayData.wrapper) {
        overlayData.wrapper.classList.add('elt-hovered');
    }
}

/**
 * Hides an individual translation overlay on mouse leave
 * @param {object} overlayData - The overlay data from activeOverlays
 */
function hideIndividualTranslation(overlayData) {
    if (!CONFIG.individualTranslations) return;
    if (translationsVisible) return; // Don't interfere when all translations are shown

    // Hide this overlay
    overlayData.overlayElement.classList.remove('elt-individual-visible');

    // Remove hover class from wrapper
    if (overlayData.wrapper) {
        overlayData.wrapper.classList.remove('elt-hovered');
    }
}

/**
 * Wraps meaning block spans in an inline container element.
 * This ensures whitespace between words is part of the hover area.
 * Applies consistent background color for visual highlighting.
 * @param {HTMLSpanElement[]} spans - The spans that make up this meaning block
 * @returns {HTMLSpanElement|null} The wrapper element, or null if wrapping failed
 */
function wrapMeaningBlockSpans(spans) {
    if (!spans || spans.length === 0) return null;

    const wrapper = document.createElement('span');
    wrapper.className = 'elt-meaning-block';

    // Apply consistent background color via CSS custom properties
    wrapper.setAttribute('data-bg-color', 'true');
    wrapper.style.setProperty('--block-bg', MEANING_BLOCK_COLOR.bg);
    wrapper.style.setProperty('--block-border', MEANING_BLOCK_COLOR.border);
    // Darker border for dark mode hover
    wrapper.style.setProperty('--block-border-dark', MEANING_BLOCK_COLOR.border.replace('0.9', '1'));

    try {
        // Use Range to capture spans AND whitespace between them
        const range = document.createRange();
        range.setStartBefore(spans[0]);
        range.setEndAfter(spans[spans.length - 1]);

        // Extract content (spans + whitespace), wrap it, insert back
        const fragment = range.extractContents();
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);

        return wrapper;
    } catch (e) {
        Logger.error('Failed to wrap meaning block spans:', e);
        return null;
    }
}

function renderSegmentations(p, alignedSegments) {
    Logger.log("renderSegmentations called with", alignedSegments.length, "segments");
    clearOverlays(p);
    p._translationOverlays = [];

    alignedSegments.forEach((item, index) => {
        const { segment, spans } = item;
        Logger.log(`Creating overlay ${index}:`, segment.type, segment.translation?.substring(0, 30));

        // 1. Wrap meaning block spans in inline container (includes whitespace)
        // SKIP WRAPPING when shadowing is enabled to avoid React DOM conflicts
        // ElevenLabs' React code expects original DOM structure for word highlighting
        let wrapper = null;
        if (!shadowingState.enabled) {
            wrapper = wrapMeaningBlockSpans(spans);
            if (wrapper) {
                p._translationOverlays.push(wrapper);
            }
        }

        // 2. Create new Range from wrapper for positioning (old range is invalidated)
        const range = document.createRange();
        if (wrapper) {
            range.selectNodeContents(wrapper);
        } else if (spans && spans.length > 0) {
            range.setStartBefore(spans[0]);
            range.setEndAfter(spans[spans.length - 1]);
        }

        // 3. Translation Overlay Container (multi-line support)
        // Append to #preview-content so overlays scroll with content and go behind fixed nav bar
        const contentDiv = document.getElementById('preview-content');
        const overlayContainer = document.createElement('div');
        overlayContainer.className = 'translation-overlay-container';
        if (translationsVisible) overlayContainer.classList.add('translation-visible');
        (contentDiv || document.body).appendChild(overlayContainer);
        p._translationOverlays.push(overlayContainer);

        // 4. Segment Highlight Container (always created for visual feedback)
        const debugEl = document.createElement('div');
        debugEl.className = 'clause-debug-container';
        (contentDiv || document.body).appendChild(debugEl);
        p._translationOverlays.push(debugEl);

        const overlayData = {
            range,
            overlayElement: overlayContainer,
            debugElement: debugEl,
            wrapper: wrapper,  // Store wrapper for cleanup and hover
            type: segment.type,
            translation: segment.translation,
            spans: spans || []
        };

        activeOverlays.push(overlayData);

        // 5. Attach hover listeners to wrapper (covers entire block including whitespace)
        if (wrapper) {
            wrapper.addEventListener('mouseenter', () => showIndividualTranslation(overlayData));
            wrapper.addEventListener('mouseleave', () => hideIndividualTranslation(overlayData));
        }
    });

    requestAnimationFrame(updateOverlayPositions);
}

// Merge adjacent rectangles on the same line into continuous blocks
function mergeRectsPerLine(rects) {
    if (!rects.length) return [];

    // Convert to array and filter empty rects
    const rectArray = Array.from(rects).filter(r => r.width > 0 && r.height > 0);
    if (!rectArray.length) return [];

    // Group by Y position (same line) - use tolerance for slight variations
    const lines = [];
    for (const rect of rectArray) {
        // Find existing line with similar Y position (within 5px tolerance)
        let foundLine = lines.find(line =>
            Math.abs(line.top - rect.top) < 5 && Math.abs(line.height - rect.height) < 5
        );

        if (foundLine) {
            // Extend the line to include this rect
            const newLeft = Math.min(foundLine.left, rect.left);
            const newRight = Math.max(foundLine.left + foundLine.width, rect.left + rect.width);
            foundLine.left = newLeft;
            foundLine.width = newRight - newLeft;
        } else {
            // Create new line
            lines.push({
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
            });
        }
    }

    return lines;
}

/**
 * Splits translation text proportionally to match original line widths.
 * @param {string} translation - Full translation text
 * @param {Array<{width: number}>} lineRects - Merged line rectangles from original
 * @returns {Array<string>} Translation text split per line
 */
function splitTranslationByLines(translation, lineRects) {
    if (!translation || lineRects.length <= 1) {
        return [translation || ''];
    }

    const words = translation.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [translation];

    // Calculate total width and proportions
    const totalWidth = lineRects.reduce((sum, r) => sum + r.width, 0);
    if (totalWidth === 0) return [translation];

    const proportions = lineRects.map(r => r.width / totalWidth);

    // Calculate total character count (excluding spaces)
    const totalChars = words.join('').length;

    const lines = [];
    let wordIndex = 0;

    for (let i = 0; i < lineRects.length; i++) {
        const targetChars = Math.round(proportions[i] * totalChars);
        let lineWords = [];
        let lineCharCount = 0;

        // Last line gets all remaining words
        if (i === lineRects.length - 1) {
            lineWords = words.slice(wordIndex);
        } else {
            // Accumulate words until we reach target character count
            while (wordIndex < words.length) {
                const word = words[wordIndex];
                const newCharCount = lineCharCount + word.length;

                // Add word if we haven't reached target, or if line is empty
                if (lineCharCount < targetChars || lineWords.length === 0) {
                    lineWords.push(word);
                    lineCharCount = newCharCount;
                    wordIndex++;
                } else {
                    break;
                }
            }
        }

        lines.push(lineWords.join(' '));
    }

    // Handle case where we have more lines than words
    while (lines.length < lineRects.length) {
        lines.push('');
    }

    return lines;
}

function updateOverlayPositions() {
    // Get container rect for relative positioning (overlays are now inside #preview-content)
    const contentDiv = document.getElementById('preview-content');
    const containerRect = contentDiv ? contentDiv.getBoundingClientRect() : null;

    activeOverlays.forEach((item, idx) => {
        const rects = item.range.getClientRects();
        if (!rects.length) return;

        const overlay = item.overlayElement;
        const translation = item.translation || '';

        // Merge rectangles by line (same logic used for debug highlighting)
        const mergedLines = mergeRectsPerLine(rects);

        // Clear existing line elements and recreate
        overlay.innerHTML = '';

        if (mergedLines.length === 0) return;

        // Split translation to match line count
        const translationLines = splitTranslationByLines(translation, mergedLines);

        // Create positioned overlay for each line
        mergedLines.forEach((line, lineIdx) => {
            const lineOverlay = document.createElement('div');
            lineOverlay.className = 'translation-line';
            lineOverlay.textContent = translationLines[lineIdx] || '';

            // Position: centered above the original line, relative to #preview-content
            const estimatedHeight = 20;
            let top, centerX;
            if (containerRect) {
                // Relative to #preview-content container
                top = line.top - containerRect.top - estimatedHeight - 8;
                centerX = line.left - containerRect.left + (line.width / 2);
            } else {
                // Fallback to document-relative positioning
                top = line.top + window.scrollY - estimatedHeight - 8;
                centerX = line.left + window.scrollX + (line.width / 2);
            }

            lineOverlay.style.top = `${top}px`;
            lineOverlay.style.left = `${centerX}px`;

            overlay.appendChild(lineOverlay);
        });

        // Debug highlighting (unchanged - already per-line)
        if (item.debugElement) {
            item.debugElement.innerHTML = '';

            for (const line of mergedLines) {
                const box = document.createElement('div');
                box.className = 'clause-debug-highlight';
                box.setAttribute('data-type', item.type || CONFIG.currentSegmentationType);
                let boxTop, boxLeft;
                if (containerRect) {
                    boxTop = line.top - containerRect.top;
                    boxLeft = line.left - containerRect.left;
                } else {
                    boxTop = line.top + window.scrollY;
                    boxLeft = line.left + window.scrollX;
                }
                box.style.top = `${boxTop}px`;
                box.style.left = `${boxLeft}px`;
                box.style.width = `${line.width}px`;
                box.style.height = `${line.height}px`;
                item.debugElement.appendChild(box);
            }
        }
    });
}

window.addEventListener('resize', updateOverlayPositions);
window.addEventListener('scroll', updateOverlayPositions);

// --- UI Components ---

function injectProcessingBanner() {
    if (document.getElementById('elevenlabs-processing-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'elevenlabs-processing-banner';
    banner.innerHTML = `
        <div class="elevenlabs-spinner"></div>
        <span class="elevenlabs-banner-text">Processing...</span>
    `;
    document.body.appendChild(banner);
}

/**
 * Updates the processing banner text.
 * @param {string} text - The text to display in the banner
 */
function updateProcessingBannerText(text) {
    const banner = document.getElementById('elevenlabs-processing-banner');
    if (banner) {
        const textSpan = banner.querySelector('.elevenlabs-banner-text');
        if (textSpan) {
            textSpan.textContent = text;
        }
    }
}

function showProcessingBanner(isCached = false) {
    const banner = document.getElementById('elevenlabs-processing-banner');
    if (banner) {
        banner.classList.add('visible');
        updateProcessingBannerText(isCached ? 'Loading cached translations...' : 'Processing...');
    }

    const btn = document.getElementById('elevenlabs-translator-toggle');
    if (btn) btn.disabled = true;
}

function hideProcessingBanner() {
    const banner = document.getElementById('elevenlabs-processing-banner');
    if (banner) banner.classList.remove('visible');

    const btn = document.getElementById('elevenlabs-translator-toggle');
    if (btn) btn.disabled = false;
}

// Extract blocks from the new response format
function getBlocks(response) {
    return response.blocks || [];
}

async function reRenderAll() {
    Logger.log("reRenderAll called");

    const paragraphs = document.querySelectorAll(`#preview-content ${TRANSLATABLE_SELECTOR}`);
    Logger.log("Found translatable elements:", paragraphs.length);

    paragraphs.forEach((p, idx) => {
        Logger.log(`Paragraph ${idx}: _fullResponse=${!!p._fullResponse}, _wordMap=${!!p._wordMap}`);
        if (p._fullResponse) {
            const blocks = getBlocks(p._fullResponse);
            Logger.log(`Paragraph ${idx}: ${blocks.length} meaning blocks available`);

            // Use position-based mapping (only method now supported)
            if (p._wordMap && p._wordMap.words.length > 0) {
                const mapped = mapSegmentsToSpans(p._wordMap, blocks);
                Logger.log(`Paragraph ${idx}: ${mapped.length} blocks mapped`);
                renderSegmentations(p, mapped);
            } else {
                Logger.warn(`Paragraph ${idx}: no word map available - cannot render blocks`);
            }
        } else {
            Logger.log(`Paragraph ${idx}: no _fullResponse, skipping`);
        }
    });
}

function injectToggleButton() {
    if (document.getElementById('elevenlabs-translator-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'elevenlabs-translator-toggle';
    btn.innerHTML = '\u6587';
    btn.title = "Press and hold \"/\" key";

    const show = () => setTranslationsVisibility(true);
    const hide = () => setTranslationsVisibility(false);

    btn.addEventListener('mousedown', show);
    btn.addEventListener('mouseup', hide);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); show(); });
    btn.addEventListener('touchend', hide);

    document.body.appendChild(btn);
}

let translationsVisible = false;
function setTranslationsVisibility(visible) {
    translationsVisible = visible;
    // Handle both legacy single overlays and new multi-line containers
    const overlays = document.querySelectorAll('.translation-overlay, .translation-overlay-container');
    overlays.forEach(el => {
        if (visible) el.classList.add('translation-visible');
        else el.classList.remove('translation-visible');
    });
    // Also show/hide underlines with translations
    if (visible) {
        document.body.classList.add('elt-translations-visible');
    } else {
        document.body.classList.remove('elt-translations-visible');
    }
}

// --- Main Logic ---

/**
 * Shows a temporary error notification to the user.
 * @param {string} message - Error message to display
 */
function showErrorNotification(message) {
    // Remove existing notification if any
    const existing = document.getElementById('elevenlabs-error-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'elevenlabs-error-notification';
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        max-width: 350px;
        padding: 15px 20px;
        background: #f44336;
        color: white;
        border-radius: 8px;
        font-family: sans-serif;
        font-size: 14px;
        z-index: 10001;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        cursor: pointer;
    `;

    notification.innerHTML = `
        <strong>Translation Error</strong><br>
        <span style="font-size: 12px;">${message}</span>
        <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">Click to dismiss</div>
    `;

    notification.onclick = () => notification.remove();

    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (notification.parentNode) notification.remove();
    }, 10000);

    document.body.appendChild(notification);
}

async function processParagraphs() {
    if (hasProcessedInitially) return; // Only process once per page load
    if (isProcessing) return;

    const contentDiv = document.getElementById('preview-content');
    if (!contentDiv) return;

    const paragraphs = Array.from(contentDiv.querySelectorAll(TRANSLATABLE_SELECTOR));
    let unprocessed = paragraphs
        .filter(p => !p._fullResponse && p.textContent.trim().length > 0);

    // Apply single paragraph limit if enabled (debug feature to save API calls)
    if (CONFIG.limitSingleParagraph) {
        unprocessed = unprocessed.slice(0, 1);
    }

    if (unprocessed.length === 0) return;

    hasProcessedInitially = true; // Set immediately - only one LLM call attempt per page load
    isProcessing = true;

    // Check cache first
    let cachedData = null;
    try {
        cachedData = await getCachedTranslations();
    } catch (err) {
        Logger.debug("Cache check failed:", err.message);
    }

    if (cachedData && cachedData.paragraphs && cachedData.paragraphs.length > 0) {
        // Use cached translations
        isUsingCachedTranslations = true;
        showProcessingBanner(true); // Show "Loading cached translations..."
        Logger.log("Using cached translations from", new Date(cachedData.timestamp).toLocaleString());

        for (let i = 0; i < unprocessed.length && i < cachedData.paragraphs.length; i++) {
            const p = unprocessed[i];
            const cached = cachedData.paragraphs[i];

            if (!cached || !cached.responseData) continue;

            // Rebuild word map for this paragraph
            const wordMap = extractWordMap(p, i);

            if (wordMap.words.length > 0) {
                p._fullResponse = cached.responseData;
                p._wordMap = wordMap;

                const blocks = getBlocks(cached.responseData);
                const mapped = mapSegmentsToSpans(wordMap, blocks);

                if (mapped.length > 0) {
                    renderSegmentations(p, mapped);
                    enableToggleButtonIfReady();
                }

                Logger.debug(`Loaded cached paragraph ${i + 1}: ${blocks.length} blocks`);
            }
        }

        Logger.log("Loaded", Math.min(unprocessed.length, cachedData.paragraphs.length), "paragraphs from cache");
    } else {
        // Fetch fresh translations
        isUsingCachedTranslations = false;
        showProcessingBanner(false); // Show "Processing..."

        const paragraphsToCache = [];

        // Process paragraphs sequentially (one LLM call at a time)
        for (let i = 0; i < unprocessed.length; i++) {
            const p = unprocessed[i];

            // Try position-based mapping first (using c attributes)
            const wordMap = extractWordMap(p, i);

            if (wordMap.words.length > 0) {
                // Use position-based flow
                Logger.debug(`Processing paragraph ${i + 1}/${unprocessed.length} with position-based mapping (${wordMap.words.length} words)`);

                try {
                    const responseData = await fetchMeaningBlocks(wordMap);
                    p._fullResponse = responseData;
                    p._wordMap = wordMap; // Store word map for re-rendering

                    // Store for caching
                    paragraphsToCache.push({
                        index: i,
                        responseData: responseData
                    });

                    const blocks = getBlocks(responseData);

                    Logger.debug("Meaning blocks processing", {
                        wordCount: wordMap.words.length,
                        blockCount: blocks.length,
                        firstBlock: blocks[0] ? `c:${blocks[0].start_c}-${blocks[0].end_c}: "${blocks[0].original}"` : 'none'
                    });

                    const mapped = mapSegmentsToSpans(wordMap, blocks);

                    Logger.debug("Mapping result:", mapped.length, "blocks mapped");

                    if (mapped.length > 0) {
                        renderSegmentations(p, mapped);
                        // Enable toggle button as soon as first paragraph has translations
                        enableToggleButtonIfReady();
                    } else if (blocks.length > 0) {
                        Logger.warn("No blocks mapped - check c values match between API response and DOM");
                    }

                    // Output standardized training data for prompt refinement
                    Logger.trainingOutput(wordMap, responseData);

                    // Log per-paragraph cost (always active, not tied to debug toggle)
                    const originalText = wordMap.words.map(w => w.text).join(' ');
                    const tokenUsage = responseData.tokenUsage || { promptTokens: 0, completionTokens: 0 };
                    logParagraphCost(i + 1, originalText, tokenUsage.promptTokens, tokenUsage.completionTokens);

                } catch (err) {
                    Logger.error("Position-based translation failed:", err);
                    showErrorNotification(err.message);
                    // Note: Failed translations are NOT counted in cost totals
                    // Store null for failed paragraphs to maintain index alignment
                    paragraphsToCache.push({
                        index: i,
                        responseData: null
                    });
                }
            } else {
                // Only position-based partitioning is supported
                Logger.warn(`Paragraph ${i}: skipping - no word map available for meaning blocks`);
                paragraphsToCache.push({
                    index: i,
                    responseData: null
                });
            }
        }

        // Cache the translations
        if (paragraphsToCache.some(p => p.responseData !== null)) {
            try {
                await setCachedTranslations(paragraphsToCache);
                Logger.log("Cached", paragraphsToCache.filter(p => p.responseData !== null).length, "paragraph translations");
            } catch (err) {
                Logger.warn("Failed to cache translations:", err.message);
            }
        }

        // Log total cost summary after all paragraphs are processed
        logTotalCostSummary();
    }

    isProcessing = false;
    hideProcessingBanner();
}

/**
 * Enables the toggle button once translations are available.
 * Called after each paragraph is processed successfully.
 */
function enableToggleButtonIfReady() {
    // Check if we have any active overlays with translations
    if (activeOverlays.length > 0) {
        const btn = document.getElementById('elevenlabs-translator-toggle');
        if (btn) {
            btn.disabled = false;
            btn.classList.add('ready');
            Logger.log("Toggle button enabled - translations ready");
        }
    }
}

function applyDoubleSpacing(contentDiv) {
    // Apply double-spacing to all translatable elements (paragraphs and headers)
    const elements = contentDiv.querySelectorAll(TRANSLATABLE_SELECTOR);
    elements.forEach(el => {
        el.style.lineHeight = '5';
    });
}

// Helper to check if partitioning is enabled
function isPartitioningEnabled(partitioningEnabled) {
    return partitioningEnabled === true;
}

// Update highlighting visibility based on partitioning setting
function updateHighlightingVisibility(partitioningEnabled) {
    const shouldShow = isPartitioningEnabled(partitioningEnabled);
    Logger.log("updateHighlightingVisibility:", { shouldShow, partitioningEnabled });
    if (shouldShow) {
        document.body.classList.add('elt-show-highlighting');
        Logger.log("Added elt-show-highlighting class to body");
    } else {
        document.body.classList.remove('elt-show-highlighting');
        Logger.log("Removed elt-show-highlighting class from body");
    }
    // Log current state
    Logger.log("Active overlays count:", activeOverlays.length);
    Logger.log("Debug containers in DOM:", document.querySelectorAll('.clause-debug-container').length);
    Logger.log("Debug highlights in DOM:", document.querySelectorAll('.clause-debug-highlight').length);
}

// --- Shadowing Module ---

/**
 * Finds the ElevenLabs play/pause button.
 * @returns {HTMLElement|null} The play/pause button or null if not found
 */
function findPlayPauseButton() {
    const selectors = [
        '[data-testid="play-pause-button"]',
        '[aria-label="Play"]',
        '[aria-label="Pause"]',
        'button[aria-label*="Play"]',
        'button[aria-label*="Pause"]',
        'button[class*="play" i]',
        'button[class*="pause" i]',
        '[class*="PlayPause"]',
        '[class*="playPause"]'
    ];

    for (const selector of selectors) {
        try {
            const btn = document.querySelector(selector);
            if (btn) return btn;
        } catch (err) {
            // Ignore selector errors
        }
    }
    return null;
}

/**
 * Checks if audio is currently playing by examining the play/pause button state.
 * @returns {boolean} True if playing, false if paused
 */
function isAudioPlaying() {
    const btn = findPlayPauseButton();
    if (!btn) return false;

    // Check aria-label - if it says "Pause", audio is playing
    const ariaLabel = btn.getAttribute('aria-label');
    if (ariaLabel) {
        return ariaLabel.toLowerCase().includes('pause');
    }

    // Fallback: check for pause icon class
    return btn.className.toLowerCase().includes('pause') ||
           btn.innerHTML.toLowerCase().includes('pause');
}

/**
 * Pauses the audio playback by clicking the play/pause button.
 * Only clicks if audio is currently playing.
 */
function pauseAudio() {
    if (!isAudioPlaying()) {
        Logger.debug("Shadowing: Audio already paused");
        return;
    }

    const btn = findPlayPauseButton();
    if (btn) {
        btn.click();
        Logger.debug("Shadowing: Audio paused via button click");
    } else {
        Logger.warn("Shadowing: Could not find play/pause button to pause audio");
    }
}

/**
 * Resumes the audio playback by clicking the play/pause button.
 * Only clicks if audio is currently paused.
 * Safety check: unwraps any remaining meaning blocks to avoid React DOM conflicts.
 */
function resumeAudio() {
    if (isAudioPlaying()) {
        Logger.debug("Shadowing: Audio already playing");
        return;
    }

    // Safety: unwrap any remaining meaning blocks before resuming
    // (Shouldn't have any if shadowing was enabled before render, but just in case)
    temporarilyUnwrapAllMeaningBlocks();

    const btn = findPlayPauseButton();
    if (btn) {
        btn.click();
        Logger.debug("Shadowing: Audio resumed via button click");
    } else {
        Logger.warn("Shadowing: Could not find play/pause button to resume audio");
    }
}

/**
 * Gets the current playback rate.
 * Note: ElevenLabs may store this in their UI state, falling back to 1.0
 * @returns {number} The playback rate (default 1.0)
 */
function getPlaybackRate() {
    // Try to find playback rate from ElevenLabs UI (e.g., speed selector)
    const speedSelector = document.querySelector('[class*="speed"]');
    if (speedSelector) {
        const speedText = speedSelector.textContent;
        const match = speedText.match(/([\d.]+)x/);
        if (match) {
            return parseFloat(match[1]);
        }
    }
    return 1.0;
}

/**
 * Calculates the pause duration based on block text length.
 * Uses word count and estimated WPM to determine speaking time.
 * @param {string} blockText - The text content of the block
 * @returns {number} Pause duration in milliseconds
 */
function calculatePauseDuration(blockText) {
    if (!blockText) return 2000; // Default 2 seconds

    const words = blockText.trim().split(/\s+/).length;
    const WPM = 150; // Approximate speaking rate
    const baseMinutes = words / WPM;
    const baseMs = baseMinutes * 60 * 1000;

    // Adjust for playback rate and pause speed multiplier
    const playbackRate = getPlaybackRate();
    const adjustedMs = (baseMs / playbackRate) * shadowingState.pauseSpeed;

    // Minimum 1 second, maximum 30 seconds
    const finalMs = Math.max(1000, Math.min(30000, adjustedMs));

    Logger.debug("Shadowing: Calculated pause duration", {
        words,
        baseMs: baseMs.toFixed(0),
        playbackRate,
        pauseSpeed: shadowingState.pauseSpeed,
        finalMs: finalMs.toFixed(0)
    });

    return finalMs;
}

/**
 * Shows the shadowing pause countdown in the UI.
 * Only visible in debug mode.
 */
function showShadowingCountdown() {
    // Create countdown element if it doesn't exist
    if (!shadowingState.countdownElement) {
        const countdown = document.createElement('div');
        countdown.id = 'elt-shadowing-countdown';
        countdown.className = 'elt-shadowing-countdown';
        document.body.appendChild(countdown);
        shadowingState.countdownElement = countdown;
    }

    shadowingState.countdownElement.classList.add('visible');
    updateShadowingCountdown();
}

/**
 * Updates the countdown display during shadowing pause.
 */
function updateShadowingCountdown() {
    if (!shadowingState.countdownElement || !shadowingState.isInPause) return;

    const elapsed = Date.now() - shadowingState.pauseStartTime;
    const remaining = Math.max(0, shadowingState.pauseDuration - elapsed);
    const seconds = (remaining / 1000).toFixed(1);

    const repText = shadowingState.repetitions > 1
        ? ` (${shadowingState.currentRepetition + 1}/${shadowingState.repetitions})`
        : '';

    shadowingState.countdownElement.textContent = `Repeat: ${seconds}s${repText}`;

    if (remaining > 0) {
        requestAnimationFrame(updateShadowingCountdown);
    }
}

/**
 * Hides the shadowing pause countdown.
 */
function hideShadowingCountdown() {
    if (shadowingState.countdownElement) {
        shadowingState.countdownElement.classList.remove('visible');
    }
}

/**
 * Shows the animated ellipsis on the play button during shadowing pause.
 */
function showPlayButtonEllipsis() {
    // Try to find the play button using various selectors
    const playBtn = document.querySelector(
        '[data-testid="play-pause-button"],' +
        '[aria-label="Play"],' +
        '[aria-label="Pause"],' +
        'button[class*="play" i],' +
        'button[class*="pause" i]'
    );

    if (playBtn) {
        playBtn.classList.add('elt-shadowing-paused');
        playBtn.setAttribute('data-original-content', playBtn.innerHTML);
    }

    // Also update our toggle button
    const toggleBtn = document.getElementById('elevenlabs-translator-toggle');
    if (toggleBtn) {
        toggleBtn.classList.add('elt-shadowing-paused');
    }
}

/**
 * Hides the animated ellipsis on the play button.
 */
function hidePlayButtonEllipsis() {
    const playBtn = document.querySelector('.elt-shadowing-paused');
    if (playBtn) {
        playBtn.classList.remove('elt-shadowing-paused');
        const originalContent = playBtn.getAttribute('data-original-content');
        if (originalContent) {
            playBtn.innerHTML = originalContent;
            playBtn.removeAttribute('data-original-content');
        }
    }

    const toggleBtn = document.getElementById('elevenlabs-translator-toggle');
    if (toggleBtn) {
        toggleBtn.classList.remove('elt-shadowing-paused');
    }
}

/**
 * Gets the text content of a block by its index.
 * @param {number} blockIndex - Index of the block
 * @param {Array} boundaries - Block boundaries array
 * @returns {string} The block's text content
 */
function getBlockText(blockIndex, boundaries) {
    if (blockIndex < 0 || blockIndex >= boundaries.length) return '';

    const block = boundaries[blockIndex];
    const contentDiv = document.getElementById('preview-content');
    if (!contentDiv) return '';

    // Find all spans in this block range
    const spans = Array.from(contentDiv.querySelectorAll('span[c]'));
    const blockSpans = spans.filter(span => {
        const c = parseInt(span.getAttribute('c'), 10);
        return c >= block.startC && c <= block.endC;
    });

    return blockSpans.map(s => s.textContent).join(' ').trim();
}

/**
 * Starts the shadowing pause for the current block.
 * @param {number} blockIndex - Index of the block that just finished
 * @param {Array} boundaries - Block boundaries array
 */
function startShadowingPause(blockIndex, boundaries) {
    if (shadowingState.isInPause) return;

    const blockText = getBlockText(blockIndex, boundaries);
    const pauseDuration = calculatePauseDuration(blockText);

    Logger.log("Shadowing: Starting pause for block", blockIndex, {
        text: blockText.substring(0, 50) + '...',
        duration: pauseDuration,
        repetition: shadowingState.currentRepetition + 1,
        totalReps: shadowingState.repetitions
    });

    shadowingState.isInPause = true;
    shadowingState.currentBlockIndex = blockIndex;
    shadowingState.pauseStartTime = Date.now();
    shadowingState.pauseDuration = pauseDuration;

    // Pause the audio
    pauseAudio();

    // Visual feedback
    showPlayButtonEllipsis();
    if (CONFIG.debugClauses) {
        showShadowingCountdown();
    }

    // Add body class for styling
    document.body.classList.add('elt-shadowing-pause');

    // Set timer for when pause ends
    shadowingState.pauseTimer = setTimeout(() => {
        endShadowingPause(boundaries);
    }, pauseDuration);
}

/**
 * Ends the current shadowing pause and decides what to do next.
 * @param {Array} boundaries - Block boundaries array
 */
function endShadowingPause(boundaries) {
    if (!shadowingState.isInPause) return;

    // Clear the timer if it exists
    if (shadowingState.pauseTimer) {
        clearTimeout(shadowingState.pauseTimer);
        shadowingState.pauseTimer = null;
    }

    shadowingState.currentRepetition++;

    // Check if we need to repeat this block
    if (shadowingState.currentRepetition < shadowingState.repetitions) {
        Logger.log("Shadowing: Replaying block", shadowingState.currentBlockIndex,
            `(rep ${shadowingState.currentRepetition + 1}/${shadowingState.repetitions})`);

        // Reset pause state
        shadowingState.isInPause = false;
        hideShadowingCountdown();
        hidePlayButtonEllipsis();
        document.body.classList.remove('elt-shadowing-pause');

        // Seek back to start of current block and replay
        const block = boundaries[shadowingState.currentBlockIndex];
        if (block && block.firstSpan) {
            seekToSpan(block.firstSpan);
            // Small delay before resuming to let the seek complete
            setTimeout(() => {
                resumeAudio();
                // Wait for this block to end again
                shadowingState.isWaitingForBlockEnd = true;
            }, 100);
        } else {
            resumeAudio();
        }
    } else {
        Logger.log("Shadowing: Block complete, moving to next");

        // Reset for next block
        shadowingState.isInPause = false;
        shadowingState.currentRepetition = 0;
        hideShadowingCountdown();
        hidePlayButtonEllipsis();
        document.body.classList.remove('elt-shadowing-pause');

        // Resume audio to continue to next block
        resumeAudio();

        // Wait for next block end
        shadowingState.isWaitingForBlockEnd = true;
    }
}

/**
 * Cancels the current shadowing pause without advancing.
 * User can resume with spacebar.
 */
function cancelShadowingPause() {
    if (!shadowingState.isInPause) return;

    Logger.log("Shadowing: Pause cancelled by user");

    // Clear the timer
    if (shadowingState.pauseTimer) {
        clearTimeout(shadowingState.pauseTimer);
        shadowingState.pauseTimer = null;
    }

    shadowingState.isInPause = false;
    shadowingState.isWaitingForBlockEnd = false;
    hideShadowingCountdown();
    hidePlayButtonEllipsis();
    document.body.classList.remove('elt-shadowing-pause');

    // Audio stays paused - user will resume with spacebar
}

/**
 * Replays the current block from the beginning during shadowing pause.
 */
function replayShadowingBlock() {
    const boundaries = shadowingState.blockType === 'sentence'
        ? getSentenceBoundaries()
        : getBlockBoundaries();

    if (shadowingState.currentBlockIndex < 0 || shadowingState.currentBlockIndex >= boundaries.length) {
        return;
    }

    Logger.log("Shadowing: Replaying current block", shadowingState.currentBlockIndex);

    // Cancel current pause timer
    if (shadowingState.pauseTimer) {
        clearTimeout(shadowingState.pauseTimer);
        shadowingState.pauseTimer = null;
    }

    shadowingState.isInPause = false;
    hideShadowingCountdown();
    hidePlayButtonEllipsis();
    document.body.classList.remove('elt-shadowing-pause');

    // Don't increment repetition - this is a manual replay
    // Seek to start of current block
    const block = boundaries[shadowingState.currentBlockIndex];
    if (block && block.firstSpan) {
        seekToSpan(block.firstSpan);
        setTimeout(() => {
            resumeAudio();
            shadowingState.isWaitingForBlockEnd = true;
        }, 100);
    }
}

/**
 * Skips to the next block during shadowing pause.
 */
function skipToNextShadowingBlock() {
    const boundaries = shadowingState.blockType === 'sentence'
        ? getSentenceBoundaries()
        : getBlockBoundaries();

    const nextIndex = shadowingState.currentBlockIndex + 1;
    if (nextIndex >= boundaries.length) {
        Logger.log("Shadowing: Already at last block");
        cancelShadowingPause();
        return;
    }

    Logger.log("Shadowing: Skipping to next block", nextIndex);

    // Cancel current pause
    if (shadowingState.pauseTimer) {
        clearTimeout(shadowingState.pauseTimer);
        shadowingState.pauseTimer = null;
    }

    shadowingState.isInPause = false;
    shadowingState.currentRepetition = 0;
    shadowingState.currentBlockIndex = nextIndex;
    hideShadowingCountdown();
    hidePlayButtonEllipsis();
    document.body.classList.remove('elt-shadowing-pause');

    // Seek to start of next block
    const block = boundaries[nextIndex];
    if (block && block.firstSpan) {
        seekToSpan(block.firstSpan);
        setTimeout(() => {
            resumeAudio();
            shadowingState.isWaitingForBlockEnd = true;
        }, 100);
    }
}

/**
 * Watches for block boundary crossing during playback.
 * Called when the highlighted word changes.
 */
function checkForBlockBoundary() {
    if (!shadowingState.enabled || !shadowingState.isWaitingForBlockEnd) return;

    const boundaries = shadowingState.blockType === 'sentence'
        ? getSentenceBoundaries()
        : getBlockBoundaries();

    if (boundaries.length === 0) {
        Logger.debug("Shadowing: No boundaries available");
        return;
    }

    const currentPos = getCurrentPlaybackPosition();
    if (currentPos < 0) {
        Logger.debug("Shadowing: Could not determine playback position");
        return;
    }

    // Find which block contains the current position
    const currentBlockIndex = findBlockIndex(boundaries, currentPos);
    if (currentBlockIndex < 0) return;

    const currentBlock = boundaries[currentBlockIndex];

    Logger.debug("Shadowing: Position check", {
        currentPos,
        currentBlockIndex,
        blockRange: `${currentBlock.startC}-${currentBlock.endC}`,
        lastBlockEndC: shadowingState.lastBlockEndC,
        lastPausedBlock: shadowingState.currentBlockIndex
    });

    // Check if we've crossed into a new block
    // This triggers when currentPos is in a block AFTER the one we were tracking
    if (shadowingState.lastBlockEndC >= 0) {
        // We had a previous block tracked
        const wasInBlock = boundaries.findIndex(b => b.endC === shadowingState.lastBlockEndC);

        if (wasInBlock >= 0 && currentBlockIndex > wasInBlock) {
            // We've moved from wasInBlock to currentBlockIndex
            // Pause for the block we just finished (wasInBlock)
            Logger.log("Shadowing: Crossed from block", wasInBlock, "to block", currentBlockIndex);

            // Only trigger if we haven't already paused for this block
            if (wasInBlock !== shadowingState.currentBlockIndex) {
                shadowingState.isWaitingForBlockEnd = false;
                startShadowingPause(wasInBlock, boundaries);
                return; // Don't update tracking until pause is done
            }
        }
    }

    // Update tracking - store current block's end position
    shadowingState.lastBlockEndC = currentBlock.endC;
}

/**
 * Initializes the shadowing observer to watch for word highlighting changes.
 */
function initShadowingObserver() {
    const contentDiv = document.getElementById('preview-content');
    if (!contentDiv) return;

    // Watch for class changes on spans (highlighting changes)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' &&
                mutation.attributeName === 'class' &&
                mutation.target.tagName === 'SPAN' &&
                mutation.target.hasAttribute('c')) {
                // A word's class changed - check if we've crossed a boundary
                checkForBlockBoundary();
                break;
            }
        }
    });

    observer.observe(contentDiv, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true
    });

    Logger.log("Shadowing: Observer initialized");
}

/**
 * Loads shadowing settings from storage and applies them.
 */
function loadShadowingSettings() {
    chrome.storage.sync.get([
        'shadowingEnabled', 'shadowingRepetitions', 'shadowingPauseSpeed', 'shadowingBlockType'
    ], (result) => {
        shadowingState.enabled = result.shadowingEnabled === true;
        shadowingState.repetitions = result.shadowingRepetitions || 1;
        shadowingState.pauseSpeed = result.shadowingPauseSpeed || 1.0;
        shadowingState.blockType = result.shadowingBlockType || 'meaningBlock';

        Logger.log("Shadowing: Settings loaded", {
            enabled: shadowingState.enabled,
            repetitions: shadowingState.repetitions,
            pauseSpeed: shadowingState.pauseSpeed,
            blockType: shadowingState.blockType
        });

        if (shadowingState.enabled) {
            initShadowingObserver();
            shadowingState.isWaitingForBlockEnd = true;
        }
    });
}

function init() {
    chrome.storage.sync.get(['enabled', 'partitioningEnabled', 'individualTranslations', 'limitSingleParagraph'], (result) => {
        if (result.enabled === false) return;
        CONFIG.individualTranslations = result.individualTranslations !== false; // Default true
        CONFIG.limitSingleParagraph = result.limitSingleParagraph === true; // Default false (process all paragraphs)

        const contentDiv = document.getElementById('preview-content');
        if (!contentDiv) {
            setTimeout(init, 1000);
            return;
        }

        Logger.log("Ready.");

        // Apply highlighting visibility based on whether partitioning is enabled
        updateHighlightingVisibility(result.partitioningEnabled);

        // Apply double-spacing immediately when content is found
        applyDoubleSpacing(contentDiv);

        injectProcessingBanner();
        injectToggleButton();

        // Load shadowing settings
        loadShadowingSettings();

        // Observer - only for styling, NOT for triggering LLM calls
        const observer = new MutationObserver((mutations) => {
            // Apply double-spacing to any newly added paragraphs
            applyDoubleSpacing(contentDiv);
        });
        observer.observe(contentDiv, { childList: true, subtree: true });

        // Initial process
        processParagraphs();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// --- Keyboard Navigation ---

const DOUBLE_PRESS_THRESHOLD = 300; // ms

// Navigation state for accumulated rapid presses
// Tracks: last press time, accumulated press count, base block index at first press
let navState = {
    left: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null },
    right: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null },
    shiftLeft: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null },
    shiftRight: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null }
};

/**
 * Get all meaning block boundaries sorted by position
 * Returns array of { startC, endC, firstSpan } objects
 */
function getBlockBoundaries() {
    const boundaries = [];

    for (const overlay of activeOverlays) {
        const range = overlay.range;

        // Get spans within this range
        const container = range.commonAncestorContainer;
        const searchRoot = container.nodeType === Node.ELEMENT_NODE
            ? container
            : container.parentElement;

        if (!searchRoot) continue;

        const allSpans = Array.from(searchRoot.querySelectorAll('span[c]'));
        const spansInRange = allSpans.filter(span => {
            try {
                return range.intersectsNode(span);
            } catch {
                return false;
            }
        });

        if (spansInRange.length > 0) {
            const cValues = spansInRange
                .map(s => parseInt(s.getAttribute('c'), 10))
                .filter(c => !isNaN(c));

            if (cValues.length > 0) {
                boundaries.push({
                    startC: Math.min(...cValues),
                    endC: Math.max(...cValues),
                    firstSpan: spansInRange[0]
                });
            }
        }
    }

    // Sort by position
    boundaries.sort((a, b) => a.startC - b.startC);
    return boundaries;
}

/**
 * Get current playback position from highlighted word
 */
function getCurrentPlaybackPosition() {
    // ElevenLabs Reader highlights the current word - try common class patterns
    const activeWord = document.querySelector(
        '#preview-content span.reader-highlight, ' +
        '#preview-content span.active, ' +
        '#preview-content span[class*="highlight"], ' +
        '#preview-content span[class*="current"], ' +
        '#preview-content span[style*="background"]'
    );

    if (activeWord && activeWord.hasAttribute('c')) {
        return parseInt(activeWord.getAttribute('c'), 10);
    }
    return -1;
}

/**
 * Find which block index contains or is nearest to a position
 */
function findBlockIndex(boundaries, position) {
    if (boundaries.length === 0) return -1;
    if (position < 0) return 0;

    for (let i = 0; i < boundaries.length; i++) {
        const block = boundaries[i];
        // Position is within this block
        if (position >= block.startC && position <= block.endC) {
            return i;
        }
        // Position is before this block (we're between blocks)
        if (position < block.startC) {
            return i;
        }
    }
    // Position is after all blocks
    return boundaries.length - 1;
}

/**
 * Get the currently highlighted (active) span from ElevenLabs
 * @returns {HTMLSpanElement|null} The span with active highlighting
 */
function getActiveHighlightSpan() {
    // ElevenLabs uses 'active' class for the currently playing word
    return document.querySelector('#preview-content span.active[c]');
}

/**
 * Manually update the highlight to match the target span
 * This is a fallback when synthetic events don't update React's state
 * @param {HTMLSpanElement} targetSpan - The span that should be highlighted
 */
function forceHighlightUpdate(targetSpan) {
    if (!targetSpan) return;

    // Remove 'active' class from any currently highlighted span
    const currentActive = getActiveHighlightSpan();
    if (currentActive) {
        currentActive.classList.remove('active');
    }

    // Add 'active' class to the target span
    targetSpan.classList.add('active');
    Logger.log("Navigation: manually updated highlight to c=" + targetSpan.getAttribute('c'));
}

/**
 * Seek audio to a specific span by simulating user interaction
 * Uses full event sequence to ensure ElevenLabs updates highlighting
 * Includes verification and fallback to ensure highlighting stays in sync
 * @param {HTMLSpanElement} span - The span to seek to
 */
function seekToSpan(span) {
    if (!span) return;

    const targetC = span.getAttribute('c');
    Logger.log("Navigation: seeking to c=" + targetC);

    // Get coordinates for realistic event positioning
    const rect = span.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    // Try dispatching a full pointer/mouse event sequence
    // ElevenLabs may listen for these rather than just 'click'
    const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY
    };

    // Dispatch pointer events (modern approach)
    span.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, pointerId: 1, pointerType: 'mouse' }));
    span.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, pointerId: 1, pointerType: 'mouse' }));

    // Also dispatch mouse events for compatibility
    span.dispatchEvent(new MouseEvent('mousedown', { ...eventOptions, button: 0 }));
    span.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, button: 0 }));
    span.dispatchEvent(new MouseEvent('click', { ...eventOptions, button: 0 }));

    // Verify and fix highlighting after a brief delay
    // ElevenLabs may take a moment to update React state
    setTimeout(() => {
        verifyAndFixHighlight(span, targetC);
    }, 50);
}

/**
 * Verify that highlighting updated correctly, fix if needed
 * @param {HTMLSpanElement} targetSpan - The span we seeked to
 * @param {string} targetC - The expected c value
 */
function verifyAndFixHighlight(targetSpan, targetC) {
    const activeSpan = getActiveHighlightSpan();
    const activeC = activeSpan ? activeSpan.getAttribute('c') : null;

    if (activeC === targetC) {
        Logger.debug("Navigation: highlight verified at c=" + targetC);
        return; // Highlight is correct, nothing to do
    }

    // Highlight didn't update - try a second event dispatch with focus
    Logger.debug("Navigation: highlight mismatch (expected c=" + targetC + ", got c=" + activeC + "), retrying...");

    // Focus the span first, then click
    targetSpan.focus();
    targetSpan.click();

    // Final verification after another short delay
    setTimeout(() => {
        const finalActiveSpan = getActiveHighlightSpan();
        const finalActiveC = finalActiveSpan ? finalActiveSpan.getAttribute('c') : null;

        if (finalActiveC !== targetC) {
            // Events still didn't work - force the highlight update manually
            Logger.debug("Navigation: synthetic events failed, forcing highlight update");
            forceHighlightUpdate(targetSpan);
        } else {
            Logger.debug("Navigation: highlight corrected to c=" + targetC);
        }
    }, 50);
}

/**
 * Navigate between meaning blocks with accumulated rapid-press support
 * @param {'left'|'right'} direction
 * @param {Object} state - navigation state object for this key
 */
function navigateMeaningBlocks(direction, state) {
    const boundaries = getBlockBoundaries();

    if (boundaries.length === 0) {
        Logger.warn("Navigation: no meaning blocks available");
        return;
    }

    const now = Date.now();
    const isRapidPress = (now - state.lastTime) < DOUBLE_PRESS_THRESHOLD;

    // Cancel any pending seek - we're updating the target
    if (state.seekTimer) {
        clearTimeout(state.seekTimer);
        state.seekTimer = null;
    }

    if (isRapidPress && state.count > 0) {
        // Rapid press: increment count, keep same base index
        state.count++;
    } else {
        // New navigation sequence: capture current position as base
        const currentPos = getCurrentPlaybackPosition();
        state.baseIndex = findBlockIndex(boundaries, currentPos);
        state.count = 1;
    }
    state.lastTime = now;

    // Calculate target based on accumulated presses from the base position
    let targetIndex;
    if (direction === 'left') {
        // Left: 1st press = start of current (base), 2nd = 1 back, 3rd = 2 back, etc.
        targetIndex = Math.max(0, state.baseIndex - (state.count - 1));
    } else {
        // Right: 1st press = next block, 2nd = 2 forward, 3rd = 3 forward, etc.
        targetIndex = Math.min(boundaries.length - 1, state.baseIndex + state.count);
    }

    Logger.debug("Navigation:", {
        direction,
        pressCount: state.count,
        baseIndex: state.baseIndex,
        targetIndex,
        totalBlocks: boundaries.length
    });

    // Debounce the actual seek to prevent audio snippets during rapid pressing
    // Only execute the seek after the threshold expires without another press
    state.seekTimer = setTimeout(() => {
        // For right navigation: only seek if we're actually moving forward
        // (prevents seeking to start of current block when at the end)
        const shouldSeek = direction === 'left' || targetIndex > state.baseIndex;

        if (shouldSeek && targetIndex >= 0 && targetIndex < boundaries.length) {
            seekToSpan(boundaries[targetIndex].firstSpan);
        }
        state.seekTimer = null;
    }, DOUBLE_PRESS_THRESHOLD);
}

/**
 * Get all sentence boundaries by detecting punctuation
 * Returns array of { startC, endC, firstSpan } objects
 */
function getSentenceBoundaries() {
    const boundaries = [];
    const paragraphs = document.querySelectorAll(`#preview-content ${TRANSLATABLE_SELECTOR}`);

    paragraphs.forEach((p, pIdx) => {
        const wordMap = extractWordMap(p, pIdx);
        if (wordMap.words.length === 0) return;

        let sentenceStart = 0;

        for (let i = 0; i < wordMap.words.length; i++) {
            const word = wordMap.words[i];
            // Check for sentence-ending punctuation
            if (/[.!?]$/.test(word.text)) {
                boundaries.push({
                    startC: wordMap.words[sentenceStart].c,
                    endC: word.c,
                    firstSpan: wordMap.words[sentenceStart].spanElement
                });
                sentenceStart = i + 1;
            }
        }

        // Handle trailing words without punctuation
        if (sentenceStart < wordMap.words.length) {
            boundaries.push({
                startC: wordMap.words[sentenceStart].c,
                endC: wordMap.words[wordMap.words.length - 1].c,
                firstSpan: wordMap.words[sentenceStart].spanElement
            });
        }
    });

    return boundaries;
}

/**
 * Navigate between sentences with accumulated rapid-press support
 * @param {'left'|'right'} direction
 * @param {Object} state - navigation state object for this key
 */
function navigateSentences(direction, state) {
    const boundaries = getSentenceBoundaries();

    if (boundaries.length === 0) {
        Logger.warn("Sentence navigation: no sentences available");
        return;
    }

    const now = Date.now();
    const isRapidPress = (now - state.lastTime) < DOUBLE_PRESS_THRESHOLD;

    // Cancel any pending seek - we're updating the target
    if (state.seekTimer) {
        clearTimeout(state.seekTimer);
        state.seekTimer = null;
    }

    if (isRapidPress && state.count > 0) {
        // Rapid press: increment count, keep same base index
        state.count++;
    } else {
        // New navigation sequence: capture current position as base
        const currentPos = getCurrentPlaybackPosition();
        state.baseIndex = findBlockIndex(boundaries, currentPos);
        state.count = 1;
    }
    state.lastTime = now;

    // Calculate target based on accumulated presses from the base position
    let targetIndex;
    if (direction === 'left') {
        // Left: 1st press = start of current (base), 2nd = 1 back, 3rd = 2 back, etc.
        targetIndex = Math.max(0, state.baseIndex - (state.count - 1));
    } else {
        // Right: 1st press = next sentence, 2nd = 2 forward, 3rd = 3 forward, etc.
        targetIndex = Math.min(boundaries.length - 1, state.baseIndex + state.count);
    }

    Logger.debug("Sentence navigation:", {
        direction,
        pressCount: state.count,
        baseIndex: state.baseIndex,
        targetIndex,
        totalSentences: boundaries.length
    });

    // Debounce the actual seek to prevent audio snippets during rapid pressing
    state.seekTimer = setTimeout(() => {
        // For right navigation: only seek if we're actually moving forward
        const shouldSeek = direction === 'left' || targetIndex > state.baseIndex;

        if (shouldSeek && targetIndex >= 0 && targetIndex < boundaries.length) {
            seekToSpan(boundaries[targetIndex].firstSpan);
        }
        state.seekTimer = null;
    }, DOUBLE_PRESS_THRESHOLD);
}

// Main keyboard event handler
document.addEventListener('keydown', (e) => {
    // Don't interfere with typing in inputs
    const activeEl = document.activeElement;
    const isTyping = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
    );
    if (isTyping) return;

    // "/" key: Show translations (same as holding the 文 button)
    if (e.key === '/') {
        e.preventDefault();
        setTranslationsVisibility(true);
        return;
    }

    // Spacebar: Play/Pause (or cancel shadowing pause)
    if (e.code === 'Space') {
        e.preventDefault();

        // If in shadowing pause, cancel it and pause audio
        if (shadowingState.isInPause) {
            cancelShadowingPause();
            Logger.log("Spacebar: cancelled shadowing pause");
            return;
        }

        // Try multiple selectors for the play/pause button
        // ElevenLabs Reader uses various button patterns
        const selectors = [
            '[data-testid="play-pause-button"]',
            '[aria-label="Play"]',
            '[aria-label="Pause"]',
            'button[aria-label*="Play"]',
            'button[aria-label*="Pause"]',
            'button[class*="play" i]',
            'button[class*="pause" i]',
            '[class*="PlayPause"]',
            '[class*="playPause"]',
            // Look for SVG icons within buttons (play/pause icons)
            'button:has(svg[class*="play" i])',
            'button:has(svg[class*="pause" i])',
            // Common player control patterns
            '.player-controls button:first-child',
            '[class*="player"] button:first-child',
            // Generic approach: find button with play/pause in any nested element
            'button:has([class*="Play"])',
            'button:has([class*="Pause"])'
        ];

        let playPauseBtn = null;
        for (const selector of selectors) {
            try {
                playPauseBtn = document.querySelector(selector);
                if (playPauseBtn) {
                    Logger.debug("Spacebar: found button with selector:", selector);
                    break;
                }
            } catch (err) {
                // :has() selector might not be supported in all contexts, ignore errors
            }
        }

        if (playPauseBtn) {
            playPauseBtn.click();
            Logger.log("Spacebar: toggled play/pause");
            // If shadowing is enabled and we just started playing, re-enable boundary watching
            if (shadowingState.enabled) {
                shadowingState.isWaitingForBlockEnd = true;
            }
        } else {
            Logger.warn("Spacebar: could not find play/pause button. Try inspecting the page to find the correct selector.");
        }
        return;
    }

    // Shift+Left Arrow: Navigate to current/previous sentence
    if (e.shiftKey && e.code === 'ArrowLeft') {
        e.preventDefault();
        navigateSentences('left', navState.shiftLeft);
        return;
    }

    // Shift+Right Arrow: Navigate to next sentence
    if (e.shiftKey && e.code === 'ArrowRight') {
        e.preventDefault();
        navigateSentences('right', navState.shiftRight);
        return;
    }

    // Left Arrow: Navigate to current/previous block (or replay during shadowing pause)
    if (e.code === 'ArrowLeft') {
        e.preventDefault();

        // If in shadowing pause, replay current block
        if (shadowingState.isInPause) {
            replayShadowingBlock();
            return;
        }

        navigateMeaningBlocks('left', navState.left);
        return;
    }

    // Right Arrow: Navigate to next block (or skip during shadowing pause)
    if (e.code === 'ArrowRight') {
        e.preventDefault();

        // If in shadowing pause, skip to next block
        if (shadowingState.isInPause) {
            skipToNextShadowingBlock();
            return;
        }

        navigateMeaningBlocks('right', navState.right);
        return;
    }
});

// Keyboard event handler for key release (for "/" translation toggle)
document.addEventListener('keyup', (e) => {
    // "/" key: Hide translations on release
    if (e.key === '/') {
        e.preventDefault();
        setTranslationsVisibility(false);
    }
});

// Listen for storage changes to update settings in real-time
chrome.storage.onChanged.addListener((changes, namespace) => {
    Logger.log("Storage changed:", { namespace, keys: Object.keys(changes) });
    if (namespace === 'sync') {
        if (changes.partitioningEnabled) {
            Logger.log("partitioningEnabled changed:", changes.partitioningEnabled.newValue);
            updateHighlightingVisibility(changes.partitioningEnabled.newValue);
            // Re-render with new setting
            Logger.log("Calling reRenderAll...");
            reRenderAll();
        }
        if (changes.individualTranslations) {
            Logger.log("individualTranslations changed:", changes.individualTranslations.newValue);
            CONFIG.individualTranslations = changes.individualTranslations.newValue !== false;
        }

        // Shadowing settings changes
        if (changes.shadowingEnabled) {
            shadowingState.enabled = changes.shadowingEnabled.newValue === true;
            Logger.log("Shadowing enabled changed:", shadowingState.enabled);
            if (shadowingState.enabled) {
                initShadowingObserver();
                shadowingState.isWaitingForBlockEnd = true;
                // Re-render without wrappers to avoid React DOM conflicts
                Logger.log("Shadowing enabled: re-rendering without wrappers");
                reRenderAll();
            } else {
                // Cancel any active pause if shadowing is disabled
                if (shadowingState.isInPause) {
                    cancelShadowingPause();
                }
                // Re-render with wrappers now that shadowing is off
                Logger.log("Shadowing disabled: re-rendering with wrappers");
                reRenderAll();
            }
        }
        if (changes.shadowingRepetitions) {
            shadowingState.repetitions = changes.shadowingRepetitions.newValue || 1;
            Logger.log("Shadowing repetitions changed:", shadowingState.repetitions);
        }
        if (changes.shadowingPauseSpeed) {
            shadowingState.pauseSpeed = changes.shadowingPauseSpeed.newValue || 1.0;
            Logger.log("Shadowing pause speed changed:", shadowingState.pauseSpeed);
        }
        if (changes.shadowingBlockType) {
            shadowingState.blockType = changes.shadowingBlockType.newValue || 'meaningBlock';
            Logger.log("Shadowing block type changed:", shadowingState.blockType);
        }
    }
});

