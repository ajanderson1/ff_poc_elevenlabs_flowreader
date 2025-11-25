// Background script for ElevenLabs Translator

// System prompt for Meaning Blocks partitioning
const SYSTEM_PROMPT = "You are a French-to-English translator that segments text into meaningful blocks. " +
    "TASK: Segment French words into linear, non-overlapping blocks and translate each block. " +
    "INPUT: JSON with words array. Each word has c (position) and text (content). " +
    "RULES: 1. Every word must belong to exactly one block. 2. Blocks cannot overlap. " +
    "3. Keep related words together: determiners with nouns, verbs with adverbs. " +
    "4. Isolate proper nouns as separate blocks. 5. Attach punctuation to the preceding block. " +
    "OUTPUT: Valid JSON with single blocks array. Each block needs: start_c (position of first word), " +
    "end_c (position of last word), original (the French text), translation (English translation).";

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

    if (request.action === 'GET_MOCK_DATA') {
        fetch(chrome.runtime.getURL('mock-llm-response.json'))
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                return response.json();
            })
            .then(function(data) {
                sendResponse({ success: true, data: data });
            })
            .catch(function(error) {
                console.error('ElevenLabs Translator: Mock data fetch error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    return false;
});

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

async function handlePositionBasedPartitioning(wordData) {
    var result = await chrome.storage.sync.get(['openaiApiKey']);
    var openaiApiKey = result.openaiApiKey;

    if (!openaiApiKey) {
        throw new Error('API Key not found. Please set it in the extension popup.');
    }

    var userContent = JSON.stringify({ words: wordData.words });

    var requestBody = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
    };

    console.log('ElevenLabs Translator: Meaning Blocks partitioning request');

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
        throw new Error(errorData.error ? errorData.error.message : 'OpenAI API request failed');
    }

    var data = await response.json();
    console.log('ElevenLabs Translator: Meaning Blocks partitioning response received');
    var content = data.choices[0].message.content;

    var jsonStr = content.trim();
    if (jsonStr.indexOf('```json') === 0) {
        jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
    } else if (jsonStr.indexOf('```') === 0) {
        jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
    }

    var parsed = JSON.parse(jsonStr);

    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
        throw new Error('Invalid response format: expected { blocks: [...] }');
    }

    validateBlockCoverage(parsed.blocks, wordData.words);

    return parsed;
}
