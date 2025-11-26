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
    }
};

Logger.log("Content script loaded.");

// --- Configuration ---
const CONFIG = {
    enabled: true,
    debugClauses: true, // For debug logging
    testingMode: true, // Default to true
    currentSegmentationType: 'Clause' // Default segmentation type
};

// Removed multi-type segmentation constants - now using single Meaning Blocks approach

// Alternating color palette for distinguishing individual segments
const SEGMENT_COLOR_PALETTE = [
    { bg: 'rgba(255, 107, 107, 0.35)', border: 'rgba(255, 107, 107, 0.9)' },  // Coral Red
    { bg: 'rgba(78, 205, 196, 0.35)', border: 'rgba(78, 205, 196, 0.9)' },    // Teal
    { bg: 'rgba(255, 217, 61, 0.35)', border: 'rgba(255, 217, 61, 0.9)' },    // Yellow
    { bg: 'rgba(149, 117, 205, 0.35)', border: 'rgba(149, 117, 205, 0.9)' },  // Purple
    { bg: 'rgba(255, 159, 64, 0.35)', border: 'rgba(255, 159, 64, 0.9)' },    // Orange
    { bg: 'rgba(102, 187, 106, 0.35)', border: 'rgba(102, 187, 106, 0.9)' },  // Green
    { bg: 'rgba(66, 165, 245, 0.35)', border: 'rgba(66, 165, 245, 0.9)' },    // Blue
    { bg: 'rgba(236, 64, 122, 0.35)', border: 'rgba(236, 64, 122, 0.9)' },    // Pink
];

// --- State ---
let isProcessing = false;
let activeOverlays = []; // Stores { range, overlayElement, debugElement, type }

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
 * @param {{ words: Array<{c: number, text: string, spanElement: HTMLSpanElement}> }} wordMap
 * @param {Array<{start_c: number, end_c: number, translation: string, type: string}>} segments
 * @returns {Array<{segment: object, spans: HTMLSpanElement[], range: Range}>}
 */
function mapSegmentsToSpans(wordMap, segments) {
    const mapped = [];

    for (const segment of segments) {
        const { start_c, end_c, translation, type } = segment;

        // Validate that start_c and end_c exist in our word map
        const validCs = new Set(wordMap.words.map(w => w.c));
        if (!validCs.has(start_c) || !validCs.has(end_c)) {
            Logger.warn("Invalid segment positions:", { start_c, end_c },
                "Valid c values:", Array.from(validCs).slice(0, 10), "...");
            continue;
        }

        // Find all words in range [start_c, end_c]
        const spansInRange = wordMap.words.filter(w => w.c >= start_c && w.c <= end_c);
        if (spansInRange.length === 0) {
            Logger.warn("No spans found for segment:", { start_c, end_c, translation });
            continue;
        }

        // Create Range for positioning
        const range = document.createRange();
        range.setStartBefore(spansInRange[0].spanElement);
        range.setEndAfter(spansInRange[spansInRange.length - 1].spanElement);

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
 * Adjusts mock data c values to match the actual DOM's c values.
 * The mock data uses c values from exampleDOM.html (first paragraph).
 * This function maps those to the actual page's c values using word index mapping.
 * @param {object} mockData - The mock data with blocks array
 * @param {{ words: Array<{c: number, text: string}> }} wordMap - Actual word map from DOM
 * @returns {object} Adjusted mock data with updated c values
 */
function adjustMockDataToWordMap(mockData, wordMap) {
    if (!mockData.blocks || !wordMap.words.length) return mockData;

    // Reference c values from exampleDOM.html first paragraph (in word order)
    // These are the c values that the mock data was created for
    const mockParagraphCValues = [
        1, 10, 20, 22, 30, 33, 42, 45, 55, 61, 65, 70, 74, 81,  // words 0-13
        94, 99, 103, 109, 111, 121, 125, 136,                    // words 14-21
        148, 154, 162, 167, 171, 175,                            // words 22-27
        181, 184, 192, 201,                                       // words 28-31
        211, 213, 217, 226,                                       // words 32-35
        234, 244, 251, 259, 266, 269,                            // words 36-41
        282, 285, 297                                             // words 42-44
    ];

    // Get actual c values from the DOM
    const actualCValues = wordMap.words.map(w => w.c);

    Logger.debug("Mock paragraph c values (first 10):", mockParagraphCValues.slice(0, 10));
    Logger.debug("Actual c values (first 10):", actualCValues.slice(0, 10));

    // Build mapping: mock c value -> word index -> actual c value
    const mockCToIndex = {};
    mockParagraphCValues.forEach((c, idx) => {
        mockCToIndex[c] = idx;
    });

    const cValueMapping = {};
    for (const mockC of Object.keys(mockCToIndex)) {
        const wordIndex = mockCToIndex[mockC];
        if (wordIndex < actualCValues.length) {
            cValueMapping[mockC] = actualCValues[wordIndex];
        }
    }

    Logger.debug("C value mapping (sample):", Object.entries(cValueMapping).slice(0, 5));

    // Adjust all blocks with the new c values
    const adjustedBlocks = mockData.blocks.map(block => ({
        ...block,
        start_c: cValueMapping[block.start_c] !== undefined ? cValueMapping[block.start_c] : block.start_c,
        end_c: cValueMapping[block.end_c] !== undefined ? cValueMapping[block.end_c] : block.end_c
    }));

    Logger.debug("Adjusted blocks (first 2):", adjustedBlocks.slice(0, 2));

    return { blocks: adjustedBlocks };
}

/**
 * Fetches translations using position-based mapping with c attributes.
 * @param {{ words: Array<{c: number, text: string}> }} wordMap - Word map with positions
 * @returns {Promise<object>} Translation response with start_c/end_c segments
 */
async function fetchMeaningBlocks(wordMap) {
    // Check if testing mode is enabled - use mock data instead of API
    if (CONFIG.testingMode) {
        Logger.log("Using mock data (testing mode - meaning blocks)");
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'GET_MOCK_DATA' }, (response) => {
                if (chrome.runtime.lastError) {
                    Logger.error("Failed to get mock data:", chrome.runtime.lastError.message);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.success) {
                    Logger.log("Mock data loaded successfully");
                    // Adjust mock data c values to match actual DOM
                    const adjustedData = adjustMockDataToWordMap(response.data, wordMap);
                    Logger.debug("Adjusted mock data:", adjustedData.blocks.slice(0, 3));
                    resolve(adjustedData);
                } else {
                    Logger.error("Failed to load mock data:", response?.error);
                    reject(new Error(response?.error || 'Unknown error loading mock data'));
                }
            });
        });
    }

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

function clearOverlays(p) {
    if (p._translationOverlays) {
        p._translationOverlays.forEach(el => el.remove());
        p._translationOverlays = [];
    }
    // Also clear from global activeOverlays
    activeOverlays = activeOverlays.filter(item => {
        if (p.contains(item.range.startContainer)) {
            if (item.overlayElement) item.overlayElement.remove();
            if (item.debugElement) item.debugElement.remove();
            return false;
        }
        return true;
    });
}

function renderSegmentations(p, alignedSegments) {
    Logger.log("renderSegmentations called with", alignedSegments.length, "segments");
    clearOverlays(p);
    p._translationOverlays = [];

    alignedSegments.forEach((item, index) => {
        const { segment, range } = item;
        Logger.log(`Creating overlay ${index}:`, segment.type, segment.translation?.substring(0, 30));

        // 1. Translation Overlay Container (multi-line support)
        const overlayContainer = document.createElement('div');
        overlayContainer.className = 'translation-overlay-container';
        if (translationsVisible) overlayContainer.classList.add('translation-visible');
        document.body.appendChild(overlayContainer);
        p._translationOverlays.push(overlayContainer);

        // 2. Segment Highlight Container (always created for visual feedback)
        const debugEl = document.createElement('div');
        debugEl.className = 'clause-debug-container';
        document.body.appendChild(debugEl);
        p._translationOverlays.push(debugEl);

        activeOverlays.push({
            range,
            overlayElement: overlayContainer,
            debugElement: debugEl,
            type: segment.type,
            colorIndex: index % SEGMENT_COLOR_PALETTE.length,
            translation: segment.translation  // Store for use in updateOverlayPositions
        });
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

            // Position: centered above the original line
            const estimatedHeight = 20;
            const top = line.top + window.scrollY - estimatedHeight - 8;
            const centerX = line.left + window.scrollX + (line.width / 2);

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
                box.style.top = `${line.top + window.scrollY}px`;
                box.style.left = `${line.left + window.scrollX}px`;
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

function showTestingModePanel(segments) {
    // Remove existing panel if any
    const existing = document.getElementById('elevenlabs-testing-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'elevenlabs-testing-panel';
    panel.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        width: 350px;
        max-height: 70vh;
        overflow-y: auto;
        background: white;
        border: 2px solid #4CAF50;
        border-radius: 8px;
        padding: 15px;
        z-index: 10001;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        font-family: sans-serif;
        font-size: 13px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'font-weight: bold; margin-bottom: 10px; color: #4CAF50; display: flex; justify-content: space-between; align-items: center;';
    header.innerHTML = `<span>Testing Mode - Mock Data (${segments.length} items)</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background: none; border: none; font-size: 20px; cursor: pointer; color: #666;';
    closeBtn.onclick = () => panel.remove();
    header.appendChild(closeBtn);

    panel.appendChild(header);

    const note = document.createElement('div');
    note.style.cssText = 'background: #fff3cd; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-size: 11px; color: #856404;';
    note.textContent = '⚠️ Mock data does not match page content. Showing translations in panel instead of overlays.';
    panel.appendChild(note);

    segments.slice(0, 15).forEach((seg, i) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 8px; margin: 5px 0; background: #f5f5f5; border-radius: 4px; border-left: 3px solid #2196F3;';
        // Handle both legacy format (original) and position-based format (start_c/end_c)
        const originalText = seg.original || `[c: ${seg.start_c} - ${seg.end_c}]`;
        item.innerHTML = `
            <div style="color: #333; margin-bottom: 4px;">${originalText}</div>
            <div style="color: #666; font-style: italic;">→ ${seg.translation}</div>
        `;
        panel.appendChild(item);
    });

    if (segments.length > 15) {
        const more = document.createElement('div');
        more.style.cssText = 'text-align: center; color: #666; padding: 10px;';
        more.textContent = `... and ${segments.length - 15} more`;
        panel.appendChild(more);
    }

    document.body.appendChild(panel);
}

function injectProcessingBanner() {
    if (document.getElementById('elevenlabs-processing-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'elevenlabs-processing-banner';
    banner.innerHTML = `
        <div class="elevenlabs-spinner"></div>
        <span>Processing...</span>
    `;
    document.body.appendChild(banner);
}

function showProcessingBanner() {
    const banner = document.getElementById('elevenlabs-processing-banner');
    if (banner) banner.classList.add('visible');

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

    const paragraphs = document.querySelectorAll('#preview-content p');
    Logger.log("Found paragraphs:", paragraphs.length);

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
    btn.innerHTML = '文';
    btn.title = "Hold to Reveal Translations";

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
}

// --- Main Logic ---

async function processParagraphs() {
    if (isProcessing) return;

    const contentDiv = document.getElementById('preview-content');
    if (!contentDiv) return;

    const paragraphs = Array.from(contentDiv.querySelectorAll('p'));
    const unprocessed = paragraphs.filter(p => !p._fullResponse && p.textContent.trim().length > 0);

    if (unprocessed.length === 0) return;

    isProcessing = true;
    showProcessingBanner();

    for (let i = 0; i < unprocessed.length; i++) {
        const p = unprocessed[i];

        // Try position-based mapping first (using c attributes)
        const wordMap = extractWordMap(p, i);

        if (wordMap.words.length > 0) {
            // Use position-based flow
            Logger.debug(`Processing paragraph ${i} with position-based mapping (${wordMap.words.length} words)`);

            try {
                const responseData = await fetchMeaningBlocks(wordMap);
                p._fullResponse = responseData;
                p._wordMap = wordMap; // Store word map for re-rendering

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
                } else if (blocks.length > 0) {
                    Logger.warn("No blocks mapped - check c values match between mock data and DOM");
                    showTestingModePanel(blocks);
                }

                if (CONFIG.debugClauses) {
                    Logger.debug("LLM Response for paragraph:", wordMap.words.slice(0, 3).map(w => w.text).join(' ') + "...", responseData);
                }

            } catch (err) {
                Logger.error("Position-based translation failed:", err);
            }
        } else {
            // Only position-based partitioning is supported
            Logger.warn(`Paragraph ${i}: skipping - no word map available for meaning blocks`);
        }
    }

    isProcessing = false;
    hideProcessingBanner();
}

function applyDoubleSpacing(contentDiv) {
    // Apply double-spacing to all paragraphs immediately
    const paragraphs = contentDiv.querySelectorAll('p');
    paragraphs.forEach(p => {
        p.style.lineHeight = '5';
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

function init() {
    chrome.storage.sync.get(['enabled', 'testingMode', 'partitioningEnabled'], (result) => {
        if (result.enabled === false) return;
        CONFIG.testingMode = result.testingMode !== false; // Default true

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

        // Observer
        const observer = new MutationObserver((mutations) => {
            // Apply double-spacing to any newly added paragraphs
            applyDoubleSpacing(contentDiv);
            processParagraphs();
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

// Double-press detection state
let lastLeftArrowTime = 0;
let lastRightArrowTime = 0;
const DOUBLE_PRESS_THRESHOLD = 300; // ms

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
 * Seek audio to a specific span by simulating user interaction
 * Uses full event sequence to ensure ElevenLabs updates highlighting
 */
function seekToSpan(span) {
    if (!span) return;

    const c = span.getAttribute('c');
    Logger.log("Navigation: seeking to c=" + c);

    // Try dispatching a full pointer/mouse event sequence
    // ElevenLabs may listen for these rather than just 'click'
    const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window
    };

    // Dispatch pointer events (modern approach)
    span.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, pointerId: 1 }));
    span.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, pointerId: 1 }));

    // Also dispatch mouse events for compatibility
    span.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    span.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    span.dispatchEvent(new MouseEvent('click', eventOptions));
}

/**
 * Navigate between meaning blocks
 * @param {'left'|'right'} direction
 * @param {boolean} isDouble - true if double-press detected
 */
function navigateMeaningBlocks(direction, isDouble) {
    const boundaries = getBlockBoundaries();

    if (boundaries.length === 0) {
        Logger.warn("Navigation: no meaning blocks available");
        return;
    }

    const currentPos = getCurrentPlaybackPosition();
    const currentIndex = findBlockIndex(boundaries, currentPos);

    Logger.debug("Navigation:", { direction, isDouble, currentPos, currentIndex, totalBlocks: boundaries.length });

    let targetIndex;

    if (direction === 'left') {
        if (isDouble) {
            // Double left: go to previous block
            targetIndex = Math.max(0, currentIndex - 1);
        } else {
            // Single left: go to start of current block
            targetIndex = currentIndex;
        }
    } else {
        // direction === 'right'
        if (isDouble) {
            // Double right: skip ahead two blocks
            targetIndex = Math.min(boundaries.length - 1, currentIndex + 2);
        } else {
            // Single right: go to next block
            targetIndex = Math.min(boundaries.length - 1, currentIndex + 1);
        }
    }

    if (targetIndex >= 0 && targetIndex < boundaries.length) {
        seekToSpan(boundaries[targetIndex].firstSpan);
    }
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

    const now = Date.now();

    // Spacebar: Play/Pause
    if (e.code === 'Space') {
        e.preventDefault();

        const playPauseBtn = document.querySelector(
            '[data-testid="play-pause-button"], ' +
            '[aria-label*="Play"], [aria-label*="Pause"], ' +
            'button[class*="play"], button[class*="pause"], ' +
            '.player-controls button, ' +
            '[class*="PlayPause"], [class*="playPause"]'
        );

        if (playPauseBtn) {
            playPauseBtn.click();
            Logger.log("Spacebar: toggled play/pause");
        } else {
            Logger.warn("Spacebar: could not find play/pause button");
        }
        return;
    }

    // Left Arrow: Navigate to current/previous block
    if (e.code === 'ArrowLeft') {
        e.preventDefault();

        const isDouble = (now - lastLeftArrowTime) < DOUBLE_PRESS_THRESHOLD;
        lastLeftArrowTime = now;

        navigateMeaningBlocks('left', isDouble);
        return;
    }

    // Right Arrow: Navigate to next block
    if (e.code === 'ArrowRight') {
        e.preventDefault();

        const isDouble = (now - lastRightArrowTime) < DOUBLE_PRESS_THRESHOLD;
        lastRightArrowTime = now;

        navigateMeaningBlocks('right', isDouble);
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

// Listen for storage changes to update highlighting in real-time
chrome.storage.onChanged.addListener((changes, namespace) => {
    Logger.log("Storage changed:", { namespace, keys: Object.keys(changes) });
    if (namespace === 'sync' && changes.partitioningEnabled) {
        Logger.log("partitioningEnabled changed:", changes.partitioningEnabled.newValue);
        updateHighlightingVisibility(changes.partitioningEnabled.newValue);
        // Re-render with new setting
        Logger.log("Calling reRenderAll...");
        reRenderAll();
    }
});

