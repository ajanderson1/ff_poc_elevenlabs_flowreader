// Background script for ElevenLabs Translator

// System prompt for Meaning Blocks partitioning
const SYSTEM_PROMPT = `You are a French-to-English translator that segments text into meaningful blocks.

TASK: Group the provided words into meaningful blocks and translate each block.

INPUT FORMAT: JSON with "words" array. Each word has:
- "c": unique position identifier (integer)
- "text": the word content

CRITICAL RULES:
1. start_c and end_c MUST be exact "c" values from the input words array
2. You CANNOT use any c value not present in the input - this causes errors
3. Every word must belong to exactly one block (no gaps, no overlaps)
4. Keep related words together: determiners+nouns, verbs+adverbs
5. Proper nouns can be isolated as single-word blocks
6. Attach punctuation to the preceding word's block

OUTPUT FORMAT: JSON with "blocks" array. Each block has:
- "start_c": c value of first word in block (MUST exist in input)
- "end_c": c value of last word in block (MUST exist in input)
- "original": the French text
- "translation": English translation

EXAMPLE:
Input: {"words":[{"c":5,"text":"Le"},{"c":12,"text":"chat"},{"c":20,"text":"dort"}]}
Output: {"blocks":[{"start_c":5,"end_c":12,"original":"Le chat","translation":"The cat"},{"start_c":20,"end_c":20,"original":"dort","translation":"sleeps"}]}

Note: start_c and end_c are 5, 12, 20 - exactly matching the input c values.`;

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

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function handlePositionBasedPartitioning(wordData) {
    var result = await chrome.storage.sync.get(['openaiApiKey']);
    var openaiApiKey = result.openaiApiKey;

    if (!openaiApiKey) {
        throw new Error('API Key not found. Please set it in the extension popup.');
    }

    var userContent = JSON.stringify({ words: wordData.words });

    // Debug logging for LLM input
    console.log('ElevenLabs Translator: Sending to LLM');
    console.log('Word count:', wordData.words.length);
    console.log('Valid C values:', wordData.words.map(w => w.c));
    console.log('Words preview:', wordData.words.slice(0, 5).map(w => `${w.c}:"${w.text}"`).join(', '));

    var requestBody = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
    };

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`ElevenLabs Translator: API attempt ${attempt}/${MAX_RETRIES}`);

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

            // Validate response structure
            const validation = validateLLMResponse(parsed, wordData.words);
            if (!validation.valid) {
                throw new Error('Invalid LLM response: ' + validation.error);
            }

            validateBlockCoverage(parsed.blocks, wordData.words);
            return parsed;

        } catch (error) {
            lastError = error;
            console.warn(`ElevenLabs Translator: Attempt ${attempt} failed:`, error.message);

            // Don't retry on non-retryable errors
            if (error.message.includes('Invalid API key') ||
                error.message.includes('API Key not found')) {
                throw error;
            }

            if (attempt < MAX_RETRIES) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`ElevenLabs Translator: Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}
