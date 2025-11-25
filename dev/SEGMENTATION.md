# Segmentation System

## Overview

Text is segmented in two stages:
1. **Client-side tokenization** - Breaking DOM text into addressable units
2. **LLM segmentation** - Grouping tokens into linguistic categories with translations

---

## Client-Side Tokenization

### Method 1: Position-Based (Preferred)

Uses `c` attributes from ElevenReader's existing `<span c="N">` elements.

```
DOM: <span c="0">Hello</span> <span c="6">world</span>
Sent to LLM: { words: [{c: 0, text: "Hello"}, {c: 6, text: "world"}] }
LLM returns: { start_c: 0, end_c: 6, translation: "..." }
```

---

## Segmentation Types

Retured segmentation types  - to be reimplemented later

| Type | Description | Granularity |
|------|-------------|-------------|
| Section | Major document divisions | Largest | 
| Paragraph | Full paragraph | |
| Sentence | Complete grammatical units | |
| **Clause** | Subject + verb groups (default) | |
| Phrase | Meaningful word groupings | |
| Collocation | Natural word pairings | |
| Verbs | Individual verbs | |
| Proper Nouns | Names, places, etc. | |
| Word | Every single word | Smallest |

Multiple types can be enabled simultaneously. Each segment is tagged with its `type` field.



# Segmentation Guidelines: Meaning Blocks

```
## Overview
This document defines the rules for segmenting text into **Meaning Blocks**.

A Meaning Block is a linear segment of text that represents a single intuitive unit of thought. Unlike strict grammatical parsing, our goal is **pedagogical flow**. The segmentation must cover the entire text (100% coverage) with no overlaps.

## Core Philosophy
1.  **Granular Structure:** Users should be able to isolate structural tools (like fixed prepositions) to learn them independently.
2.  **Fluid Action:** Verb phrases should absorb time markers and connectors to maintain the narrative flow.
3.  **No "Crumbs":** Avoid creating tiny, low-value chunks (like orphaned punctuation or single conjunctions) unless they serve a strong distinct function.

---

## 1. Noun Phrases
Keep the core noun phrase together.

* **Rule:** Combine Determiner + Noun + Adjectives/Modifiers.
* **Genitives:** If a noun is modified by `de` + another noun (possession/specification), keep them together **unless** the phrase becomes unwieldy (>6 words).
    * *Example:* `[la colère des usagers]`
    * *Example:* `[les coupures d’électricité]`
* **Proper Nouns:** Always isolate proper nouns as distinct blocks.
    * *Example:* `[la Jirama]`

## 2. Verb Phrases
This category requires specific handling based on the *type* of verb.

* **Action Verbs:** Isolate the conjugated verb group.
    * *Example:* `[vont diminuer]`
* **State / Linking Verbs (Copula):** If the verb functions primarily as an equals sign (*être, devenir, rester, sembler*), **merge** it with the attribute that follows it. The verb alone is too weak to be a block.
    * *Example:* `[reste un défi majeur]` (NOT `[reste]` | `[un défi majeur]`)
* **Adverb & Conjunction Absorption:**
    * Include short, intervening adverbs (*hier, déjà, bientôt*) inside the verb block.
    * Include the conjunction *que* inside the verb block if it follows immediately.
    * *Example:* `[a annoncé hier que]`
* **Negation:** Keep standard negation (*ne... pas/plus/jamais*) inside the verb block.
    * *Example:* `[ne vont pas diminuer]`

## 3. Prepositions & Connectors
We differentiate between "Structural" and "Grammatical" prepositions.

* **Fixed/Structural Expressions (Split):** Isolate multi-word prepositions or introductory phrases. These are "tools" the user needs to learn.
    * *Example:* `[Face à]` | `[la colère...]`
    * *Example:* `[En raison de]` | `[la crise...]`
* **Simple Grammatical Prepositions (Merge):** If a simple preposition (`à`, `de`, `pour`) is tightly bound to a noun phrase, keep it attached.
    * *Example:* `[pour la capitale]`
    * *Example:* `[des usagers]`

## 4. Discourse Markers
Isolate words that signal a shift in logic or tone. This helps the reader navigate the argument.

* *Example:* `[Cependant,]`
* *Example:* `[Par ailleurs,]`
* *Example:* `[En revanche,]`

## 5. Punctuation Handling
* **Rule:** Punctuation marks (commas, periods, colons) must never stand alone.
* **Attachment:** Attach punctuation to the **preceding** block.
    * *Correct:* `[Cependant,]`
    * *Incorrect:* `[Cependant]` `[,]`

---

## 6. Reference Examples

Here is how these rules apply to real-world text.

### Example A: The "Goldilocks" Standard
> **Text:** *"Face à la colère des usagers, la Jirama a annoncé hier que les coupures d’électricité vont diminuer. Cependant, l’approvisionnement en carburant reste un défi majeur pour la capitale."*

**Correct Segmentation:**
1. `[Face à]` (Structural Preposition - **Split**)
2. `[la colère des usagers,]` (Noun Phrase + Punctuation)
3. `[la Jirama]` (Proper Noun)
4. `[a annoncé hier que]` (Verb + Adverb + Conjunction - **Merged**)
5. `[les coupures d’électricité]` (Complex Noun Phrase)
6. `[vont diminuer.]` (Action Verb)
7. `[Cependant,]` (Discourse Marker)
8. `[l’approvisionnement en carburant]` (Noun Phrase)
9. `[reste un défi majeur]` (Linking Verb + Attribute - **Merged**)
10. `[pour la capitale.]` (Simple Prep + Noun)

### Example B: Contrast (What to Avoid)

| Bad Segmentation | Why it fails |
| :--- | :--- |
| `[Face à la colère des usagers]` | Misses the chance to teach "Face à" as a reusable tool. |
| `[a annoncé]` `[hier]` `[que]` | Creates "crumbs" (tiny units) that interrupt the flow of reading. |
| `[reste]` `[un défi majeur]` | Isolate "reste" leaves the user with a weak, incomplete definition. |

---

## 7. Summary Checklist for Annotators/Devs

1.  **Is it a fixed expression?** $\rightarrow$ Split it (`[Grâce à]`).
2.  **Is it a linking verb?** $\rightarrow$ Merge with next word (`[est difficile]`).
3.  **Is there a small adverb in the verb phrase?** $\rightarrow$ Absorb it (`[a souvent dit]`).
4.  **Is there floating punctuation?** $\rightarrow$ Attach left.


```



---

## LLM System Prompt

The prompt sent to GPT-4o-mini (`background.js:handlePositionBasedTranslation`):

```
You are a precise translator. Analyze the input text (provided as ordered
words with position markers) and segment it into the specified linguistic
categories, translating each segment to English.

INPUT FORMAT:
You receive a JSON object with a "words" array. Each word has:
- "c": character position in the original document (unique identifier)
- "text": the word content

OUTPUT FORMAT:
Return a JSON object where each key is a category name, containing an array
of segments. Each segment MUST include:
- "start_c": the 'c' value of the FIRST word in the segment
- "end_c": the 'c' value of the LAST word in the segment
- "translation": English translation of the segment
- "type": the category name

CATEGORIES TO EXTRACT:
[dynamically built from enabled types]

CRITICAL RULES:
1. start_c and end_c MUST exactly match 'c' values from the input words
2. Segments must not overlap within the same category
3. Segments must follow document order (start_c should increase)
4. For "Word" category, start_c and end_c should be the same (single word)
5. Return ONLY valid JSON
```

**Key constraint:** The LLM must return `c` values that exactly match the input. Any hallucinated or misremembered positions break the DOM mapping.

---

## LLM Response Format

### Position-Based
```json
{
  "Clause": [
    { "start_c": 0, "end_c": 15, "translation": "...", "type": "Clause" }
  ]
}
```

### Token-Based (Legacy)
```json
{
  "Clause": [
    { "original": "exact source text", "translation": "...", "type": "Clause" }
  ]
}
```

---

## Current Issues to Address

1. **Token matching fragility** - Legacy fallback struggles with punctuation differences
2. **Overlapping segments** - Multiple types may overlap; rendering handles this but visual clarity suffers
3. **c-attribute availability** - Not all pages have `<span c="N">` markup
