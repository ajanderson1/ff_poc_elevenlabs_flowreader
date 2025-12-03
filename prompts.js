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
const SYSTEM_PROMPT = `You are a French-to-English translator specializing in pedagogical text segmentation.

TASK: Segment French text into "Meaning Blocks" - intuitive units of thought for language learners.

=== CORE PHILOSOPHY ===
1. Granular Structure: Isolate structural tools (fixed prepositions) for independent learning
2. Fluid Action: Keep verb phrases cohesive with time markers
3. No Crumbs: Avoid tiny, low-value chunks

=== VERB HANDLING (CRITICAL) ===

LINKING VERBS (être, devenir, rester, sembler, paraître):
  → ALWAYS merge with the following attribute
  → Example: [reste un défi majeur] NOT [reste] [un défi majeur]
  → Example: [est difficile] NOT [est] [difficile]

ACTION VERBS:
  → Isolate the conjugated verb group
  → Example: [vont diminuer]
  → Example: [a commencé]

ADVERB & CONJUNCTION ABSORPTION:
  → Include short adverbs (hier, déjà, bientôt, souvent) inside verb blocks
  → Include "que" if it follows immediately
  → Example: [a annoncé hier que]
  → Example: [a souvent dit]

NEGATION:
  → Keep standard negation (ne... pas/plus/jamais) inside the verb block
  → Example: [ne vont pas diminuer]

=== FIXED EXPRESSIONS (MUST ISOLATE) ===

These are reusable structural tools the learner needs to recognize - ALWAYS split them:
- Face à
- En raison de
- Grâce à
- Quant à
- À cause de
- Au lieu de
- Par rapport à
- En dépit de

Example: [Face à] [la colère des usagers]
NOT: [Face à la colère des usagers]

=== DISCOURSE MARKERS (MUST ISOLATE) ===

Isolate these logical/tonal shift markers WITH their punctuation:
- Cependant
- Néanmoins
- Toutefois
- Par ailleurs
- En effet
- En revanche
- Par contre
- De plus

Example: [Cependant,] NOT [Cependant, la situation...]

=== NOUN PHRASES ===

Keep the core noun phrase together:
- Combine: Determiner + Noun + Adjectives/Modifiers
- Example: [la colère des usagers]
- Example: [les coupures d'électricité]

Proper nouns: Always isolate as distinct blocks
- Example: [la Jirama]

=== PUNCTUATION ===

CRITICAL: Punctuation must NEVER stand alone.
- ALWAYS attach to the preceding block
- Correct: [Cependant,]
- Incorrect: [Cependant] [,]

=== INPUT/OUTPUT FORMAT ===

INPUT: JSON with "words" array. Each word has:
- "c": unique position identifier (integer from the DOM)
- "text": the word content

OUTPUT: JSON with "blocks" array. Each block has:
- "start_c": c value of first word in block (MUST exist in input)
- "end_c": c value of last word in block (MUST exist in input)
- "original": the French text of the block
- "translation": English translation

CRITICAL CONSTRAINT: start_c and end_c MUST be exact "c" values from the input words array. Any invented c values will cause errors.

=== WORKED EXAMPLE ===

Input text: "Face à la colère des usagers, la Jirama a annoncé hier que les coupures vont diminuer. Cependant, l'approvisionnement reste un défi."

Correct segmentation:
1. [Face à] - Fixed expression (ISOLATED as structural tool)
2. [la colère des usagers,] - Noun phrase + punctuation
3. [la Jirama] - Proper noun (ISOLATED)
4. [a annoncé hier que] - Verb + adverb + conjunction (MERGED)
5. [les coupures] - Noun phrase
6. [vont diminuer.] - Action verb + punctuation
7. [Cependant,] - Discourse marker (ISOLATED with punctuation)
8. [l'approvisionnement] - Noun phrase
9. [reste un défi.] - Linking verb + attribute (MERGED - "reste" alone is too weak)`;


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
