# Release Notes

## Version 1.1 (December 2025)

### Model Upgrade: GPT-4o-mini → GPT-5-mini

This release upgrades the underlying language model from **GPT-4o-mini** to **GPT-5-mini-2025-08-07**.

#### Why GPT-5-mini?

Testing revealed significant quality improvements in meaning block segmentation with GPT-5-mini:

- **Better adherence to block size constraints** — GPT-5-mini more consistently produces 2-5 word blocks, avoiding the overly long segments that GPT-4o-mini occasionally generated
- **Improved handling of French grammatical structures** — More accurate splitting at prepositions, conjunctions, and fixed expressions
- **More reliable JSON output** — Fewer malformed responses requiring retries
- **Better pedagogical judgment** — Improved decisions on when to merge linking verbs with attributes vs. when to split action verbs

The switch maintains the same pricing tier while delivering noticeably better translation segmentation quality.

### Architecture Improvements

**Centralized Configuration (`config.js`)**
- All configuration now lives in a single `config.js` file
- Model selection, retry strategies, timing thresholds, and DOM selectors are configurable in one place
- Easier to switch models or adjust behavior without modifying core logic

**Prompt Decoupling (`prompts.js`)**
- System prompts and semantic validation rules extracted to dedicated file
- Prompt versioning (now at v1.2) for easier iteration
- Includes comprehensive linking verb detection and fixed expression handling

**Logging Standardization**
- Console log prefix changed from `[ELT]` to `[FF]` (Frictionless FlowReader)
- Consistent logging across all extension components

### Technical Notes

- GPT-5-mini only supports `temperature=1` (the default), so the retry strategy no longer varies temperature between attempts
- Retry delays remain at 0ms, 1000ms, 2000ms for the three attempts

---

## Version 1.0 (November 2025)

Initial release with core functionality:
- Inline translation overlays for ElevenLabs Reader
- Meaning block segmentation using GPT-4o-mini
- Keyboard navigation (/, Space, ←, →)
- Translation caching via chrome.storage.local
- Debug mode with clause highlighting
- Recommended voice list for French learning
