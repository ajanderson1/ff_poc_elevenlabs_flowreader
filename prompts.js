/**
 * prompts.js - Decoupled system prompt, semantic validation, and retry configuration
 * for Meaning Blocks text segmentation.
 *
 * This file is loaded via importScripts() in background.js (service worker).
 */

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

/**
 * System prompt for GPT-4o-mini encoding pedagogical rules from dev/SEGMENTATION.md.
 * Designed for French-to-English translation with meaning block segmentation.
 */
const SYSTEM_PROMPT = `You segment French text into meaning blocks and translate to English. Return JSON.

=== INPUT ===
Array of words with sequential indices: [{"i":0,"w":"Le"},{"i":1,"w":"chat"},{"i":2,"w":"dort."}]

=== OUTPUT (JSON) ===
{"blocks":[{"s":0,"e":1,"t":"The cat"},{"s":2,"e":2,"t":"sleeps."}]}

=== BLOCK SIZE ===
Target: 2-5 words per block. Maximum: 6 words. Split aggressively.

=== ALWAYS SPLIT AT ===
• Prepositions: dès, depuis, pour, dans, entre, après, avant, par, vers, sous, sur
• Conjunctions: que, qui, où, dont, mais, ou, et, car, donc
• Fixed starts: "Face à" "En raison de" "Grâce à" "À cause de"
• Markers: "Cependant," "Toutefois," "En effet," "Par ailleurs,"
• After long subjects (4+ words): split before the verb
• At commas (usually)

=== KEEP TOGETHER (max 5 words) ===
• Linking verb + attribute: "est un problème" "reste célèbre"
• Short noun phrase: "la montée des eaux"
• Verb + short adverb: "a dit hier"

PUNCTUATION: Attach to preceding word, never standalone.

=== EXAMPLE ===
Input: "La montée des eaux est un problème récurrent dès l'arrivée des pluies."
Good: [La montée des eaux] [est un problème récurrent] [dès l'arrivée des pluies.]
Bad: [La montée des eaux est un problème récurrent dès l'arrivée des pluies.] (too long!)

=== CONSTRAINTS ===
• s and e must be valid indices from input (0 to n-1)
• Blocks must cover all words: no gaps, no overlaps
• Blocks must be in order: each block's s > previous block's e`;


// =============================================================================
// SEMANTIC VALIDATION
// =============================================================================

/**
 * Common French linking verbs (state/copula verbs) that should merge with attributes.
 * Includes conjugated forms.
 */
const LINKING_VERBS = [
    // être
    'est', 'sont', 'était', 'étaient', 'sera', 'seront', 'été', 'étant',
    'suis', 'es', 'sommes', 'êtes', 'serai', 'seras', 'serez', 'serais',
    'serait', 'seraient', 'serions', 'seriez', 'soit', 'soient', 'fût',
    // rester
    'reste', 'restes', 'restent', 'restait', 'restaient', 'restera', 'resteront',
    'restée', 'resté', 'restés', 'restées',
    // devenir
    'devient', 'deviennent', 'devenait', 'devenaient', 'deviendra', 'deviendront',
    'devenu', 'devenue', 'devenus', 'devenues',
    // sembler
    'semble', 'sembles', 'semblent', 'semblait', 'semblaient', 'semblera',
    // paraître
    'paraît', 'parait', 'paraissent', 'paraissait', 'paraîtra',
    // demeurer
    'demeure', 'demeurent', 'demeurait', 'demeuraient'
];

/**
 * Fixed/structural expressions that should be isolated as single blocks.
 * These are "tools" learners need to recognize independently.
 */
const FIXED_EXPRESSIONS = [
    'face à',
    'en raison de',
    'grâce à',
    'quant à',
    'à cause de',
    'au lieu de',
    'par rapport à',
    'en dépit de',
    'à l\'égard de',
    'au sein de',
    'en vue de',
    'à travers',
    'au-delà de',
    'en dehors de',
    'à partir de',
    'au cours de',
    'en fonction de',
    'à la suite de'
];

/**
 * Discourse markers that signal logical/tonal shifts.
 * Should be isolated with their punctuation.
 */
const DISCOURSE_MARKERS = [
    'cependant',
    'néanmoins',
    'toutefois',
    'par ailleurs',
    'en effet',
    'en revanche',
    'par contre',
    'de plus',
    'en outre',
    'ainsi',
    'donc',
    'pourtant',
    'd\'ailleurs',
    'autrement dit',
    'en somme',
    'bref'
];

/**
 * Circumstantial prepositions that introduce phrases which should be isolated.
 * These indicate time, place, manner, cause, or specification.
 */
const CIRCUMSTANTIAL_PREPOSITIONS = [
    // Time
    'dès', 'depuis', 'pendant', 'après', 'avant', 'lors de', 'durant',
    // Place/Location
    'dans', 'entre', 'vers', 'sous', 'sur', 'derrière', 'devant',
    // Specification/Purpose
    'pour', 'afin de', 'avec', 'sans', 'selon', 'malgré',
    // Manner
    'en', 'par'
    // Note: 'à' is too common and often grammatical, not circumstantial
];

/**
 * Check if a word appears to be a verb (simple heuristic).
 * @param {string} text - Word or phrase to check
 * @returns {boolean}
 */
function startsWithVerb(text) {
    if (!text) return false;
    const firstWord = text.toLowerCase().split(/\s+/)[0].replace(/[.,;:!?'"]/g, '');
    // Common French verb endings and auxiliary verbs
    const verbIndicators = ['a', 'ont', 'va', 'vont', 'fait', 'peut', 'veut', 'doit'];
    const verbEndings = ['er', 'ir', 're', 'é', 'ée', 'és', 'ées', 'ant'];

    if (verbIndicators.includes(firstWord)) return true;
    for (const ending of verbEndings) {
        if (firstWord.endsWith(ending) && firstWord.length > 3) return true;
    }
    return false;
}

/**
 * Check for linking verbs that are isolated when they should merge with the next block.
 * @param {Array} blocks - Array of block objects with 'original' field
 * @returns {Array} Array of violation objects
 */
function checkLinkingVerbIsolation(blocks) {
    const violations = [];

    for (let i = 0; i < blocks.length - 1; i++) {
        const block = blocks[i];
        const original = block.original || '';
        const words = original.toLowerCase().split(/\s+/).filter(w => w.length > 0);

        if (words.length === 0) continue;

        // Get last word, stripping punctuation
        const lastWord = words[words.length - 1].replace(/[.,;:!?'"]/g, '');

        // Check if block ends with a linking verb and is short (1-2 words)
        if (LINKING_VERBS.includes(lastWord) && words.length <= 2) {
            const nextBlock = blocks[i + 1];

            // If next block doesn't start with a verb, this linking verb should have merged
            if (nextBlock && !startsWithVerb(nextBlock.original)) {
                violations.push({
                    type: 'linking_verb_isolated',
                    message: `Linking verb "${block.original}" should merge with "${nextBlock.original}"`,
                    severity: 'error',
                    blockIndex: i,
                    suggestion: `${block.original} ${nextBlock.original}`.replace(/\s+/g, ' ')
                });
            }
        }
    }

    return violations;
}

/**
 * Check for fixed expressions that are buried inside larger blocks.
 * @param {Array} blocks - Array of block objects with 'original' field
 * @returns {Array} Array of violation objects
 */
function checkFixedExpressionBuried(blocks) {
    const violations = [];

    for (let i = 0; i < blocks.length; i++) {
        const original = (blocks[i].original || '').toLowerCase();

        for (const expr of FIXED_EXPRESSIONS) {
            // Check if block STARTS with the expression but contains more
            if (original.startsWith(expr)) {
                const remainder = original.slice(expr.length).trim();
                // If there's significant content after the expression, it should be split
                if (remainder.length > 3 && !remainder.match(/^[.,;:!?'"]+$/)) {
                    violations.push({
                        type: 'fixed_expression_buried',
                        message: `"${expr}" should be isolated, found buried in "${blocks[i].original}"`,
                        severity: 'warning',
                        blockIndex: i,
                        suggestion: `Split into: [${expr}] [${remainder}]`
                    });
                }
            }
        }
    }

    return violations;
}

/**
 * Check for discourse markers that are absorbed into larger blocks.
 * @param {Array} blocks - Array of block objects with 'original' field
 * @returns {Array} Array of violation objects
 */
function checkDiscourseMarkerAbsorbed(blocks) {
    const violations = [];

    for (let i = 0; i < blocks.length; i++) {
        const original = (blocks[i].original || '').toLowerCase();
        const words = original.split(/\s+/).filter(w => w.length > 0);

        if (words.length <= 1) continue; // Single word blocks are fine

        // Check if first word (minus punctuation) is a discourse marker
        const firstWord = words[0].replace(/[.,;:!?'"]/g, '');

        if (DISCOURSE_MARKERS.includes(firstWord)) {
            // Discourse marker should be isolated (possibly with punctuation)
            // If block has more than just the marker + punctuation, it's absorbed
            const withoutMarker = words.slice(1).join(' ').replace(/^[.,;:!?'"]+\s*/, '');
            if (withoutMarker.length > 0) {
                violations.push({
                    type: 'discourse_marker_absorbed',
                    message: `Discourse marker "${firstWord}" should be isolated, found in "${blocks[i].original}"`,
                    severity: 'warning',
                    blockIndex: i,
                    suggestion: `Split into: [${firstWord},] [${withoutMarker}]`
                });
            }
        }
    }

    return violations;
}

/**
 * Check for orphan punctuation (punctuation as standalone blocks).
 * @param {Array} blocks - Array of block objects with 'original' field
 * @returns {Array} Array of violation objects
 */
function checkOrphanPunctuation(blocks) {
    const violations = [];

    for (let i = 0; i < blocks.length; i++) {
        const original = (blocks[i].original || '').trim();

        // Check if block is only punctuation
        if (original.match(/^[.,;:!?'"«»—–-]+$/)) {
            violations.push({
                type: 'orphan_punctuation',
                message: `Punctuation "${original}" should attach to preceding block`,
                severity: 'error',
                blockIndex: i,
                suggestion: i > 0 ? `Merge with previous block` : `Remove or merge`
            });
        }
    }

    return violations;
}

/**
 * Check for circumstantial phrases buried inside larger blocks.
 * Circumstantial phrases (time, place, manner, cause) should be isolated.
 * @param {Array} blocks - Array of block objects with 'original' field
 * @returns {Array} Array of violation objects
 */
function checkCircumstantialPhraseBuried(blocks) {
    const violations = [];

    for (let i = 0; i < blocks.length; i++) {
        const original = (blocks[i].original || '').toLowerCase();
        const words = original.split(/\s+/).filter(w => w.length > 0);

        // Skip short blocks (3 words or less) - they're probably fine
        if (words.length <= 3) continue;

        // Look for circumstantial prepositions in the middle of the block
        for (let j = 1; j < words.length - 1; j++) {
            const word = words[j].replace(/[.,;:!?'"]/g, '');

            // Check single-word prepositions
            if (CIRCUMSTANTIAL_PREPOSITIONS.includes(word)) {
                // This preposition is buried in the middle of a block
                const beforePrep = words.slice(0, j).join(' ');
                const fromPrep = words.slice(j).join(' ');

                // Only flag if there's substantial content before AND after
                if (beforePrep.length > 3 && fromPrep.length > 5) {
                    violations.push({
                        type: 'circumstantial_phrase_buried',
                        message: `Circumstantial phrase starting with "${word}" should be isolated in "${blocks[i].original}"`,
                        severity: 'warning',
                        blockIndex: i,
                        suggestion: `Split into: [${beforePrep}] [${fromPrep}]`
                    });
                    break; // Only report first violation per block
                }
            }

            // Check two-word prepositions (e.g., "lors de")
            if (j < words.length - 1) {
                const twoWords = word + ' ' + words[j + 1].replace(/[.,;:!?'"]/g, '');
                if (CIRCUMSTANTIAL_PREPOSITIONS.includes(twoWords)) {
                    const beforePrep = words.slice(0, j).join(' ');
                    const fromPrep = words.slice(j).join(' ');

                    if (beforePrep.length > 3 && fromPrep.length > 8) {
                        violations.push({
                            type: 'circumstantial_phrase_buried',
                            message: `Circumstantial phrase starting with "${twoWords}" should be isolated in "${blocks[i].original}"`,
                            severity: 'warning',
                            blockIndex: i,
                            suggestion: `Split into: [${beforePrep}] [${fromPrep}]`
                        });
                        break;
                    }
                }
            }
        }
    }

    return violations;
}

/**
 * Validate semantic correctness of blocks against pedagogical rules.
 * @param {Array} blocks - Array of block objects from LLM response
 * @param {Array} words - Original word data (for context, currently unused)
 * @returns {{ valid: boolean, violations: Array, shouldRetry: boolean }}
 */
function validateSemantics(blocks, words) {
    const violations = [];

    // Run all semantic checks
    violations.push(...checkLinkingVerbIsolation(blocks));
    violations.push(...checkFixedExpressionBuried(blocks));
    violations.push(...checkDiscourseMarkerAbsorbed(blocks));
    violations.push(...checkOrphanPunctuation(blocks));
    violations.push(...checkCircumstantialPhraseBuried(blocks));

    // Determine if we should retry based on violation severity
    const hasErrors = violations.some(v => v.severity === 'error');
    const hasWarnings = violations.some(v => v.severity === 'warning');

    return {
        valid: !hasErrors,
        violations: violations,
        // Retry on errors, optionally on warnings
        shouldRetry: hasErrors || (hasWarnings && violations.length >= 2)
    };
}


// =============================================================================
// RETRY CONFIGURATION
// =============================================================================

/**
 * Retry configuration with temperature escalation.
 * Each attempt uses a higher temperature to encourage variation.
 */
const RETRY_CONFIG = [
    { temperature: 0.2, delay: 0 },      // Attempt 1: Deterministic
    { temperature: 0.4, delay: 1000 },   // Attempt 2: Slight variation
    { temperature: 0.6, delay: 2000 }    // Attempt 3: More creative
];

/**
 * Get retry configuration for a given attempt number.
 * @param {number} attempt - Attempt number (1-indexed)
 * @returns {{ temperature: number, delay: number }}
 */
function getRetryConfig(attempt) {
    const index = Math.min(attempt - 1, RETRY_CONFIG.length - 1);
    return RETRY_CONFIG[index];
}

/**
 * Get the maximum number of retries allowed.
 * @returns {number}
 */
function getMaxRetries() {
    return RETRY_CONFIG.length;
}


// =============================================================================
// EXPORTS (for service worker via importScripts)
// =============================================================================

// These are exposed as globals when loaded via importScripts()
// No export statement needed - variables are already in global scope
