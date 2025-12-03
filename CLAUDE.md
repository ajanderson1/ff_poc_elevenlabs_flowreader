# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) that injects inline translations into ElevenLabs Reader pages (elevenreader.io). Uses OpenAI's GPT-4o-mini API to split text into grammatical "meaning blocks" and translate them, displaying translations as hovering overlays above the original text.

## Architecture

**Extension Components:**
- `background.js` - Service worker handling OpenAI API calls via message passing. Receives `TRANSLATE_TEXT` messages from content script, manages API key retrieval from `chrome.storage.sync`
- `content.js` - Injected into elevenreader.io pages. Extracts text from `#preview-content` paragraphs, maps text nodes to character positions using `<span c="N">` attributes, creates positioned overlay elements for translations, handles keyboard navigation and audio playback control
- `popup.js` / `popup.html` - Settings UI for API key entry and toggle controls (enabled, debug mode)
- `styles.css` - Overlay positioning, floating toggle button, debug highlighting, colored underlines for meaning blocks

**Data Flow:**
1. Content script extracts paragraph text and builds word list with `c` attributes (character positions from ElevenReader DOM)
2. Sends text to background script via `chrome.runtime.sendMessage`
3. Background script calls OpenAI API with position-based format, returns JSON array of `{start_c, end_c, translation}` objects
4. Content script matches segments using `c` values, creates Range objects, positions overlays using `getBoundingClientRect()`
5. Translations are cached in `chrome.storage.local` to avoid repeated API calls

**Key Implementation Details:**
- Translation overlays are appended to `document.body` and positioned absolutely using scroll-aware coordinates
- `MutationObserver` watches `#preview-content` for dynamic content changes
- Press-and-hold "文" button (or `/` key) reveals translations
- Debug mode draws yellow dashed highlight boxes around detected clauses

**ElevenReader DOM Integration:**
- ElevenReader renders text as `<span c="N">` elements where `c` is character position
- Active word has class `active` - use `#preview-content span.active[c]` to find current playback position
- Play/Pause button identified by `aria-label="Play"` or `aria-label="Pause"`
- See `docs/MANIPULATING_AUDIO_PLAYBACK.md` for critical details on synthetic events and audio seeking gotchas

## Development

### Loading the Extension
1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select this directory
4. After code changes, click the Reload icon on the extension card

### Testing
See TESTING.md for detailed manual testing steps. Requires:
- Valid OpenAI API key configured via popup
- Test on live elevenreader.io pages

### Keyboard Shortcuts (when extension is active)
| Key | Action |
|-----|--------|
| `/` (hold) | Show translations |
| `Space` | Play/Pause audio |
| `←` | Go to start of current meaning block |
| `←` `←` (double) | Go to previous meaning block |
| `→` | Go to next meaning block |

### Debugging
- Console logs prefixed with `[ELT]` - filter in DevTools with: `/^\[ELT\]/`
- Enable "Always Show Underlines" toggle in popup to visualize block boundaries
- Check Network tab for OpenAI API request/response issues

## Text Segmentation

The extension uses "Meaning Blocks" - pedagogically-oriented text segments (not strict grammatical units). Key rules defined in `dev/SEGMENTATION.md`:
- Fixed expressions like "Face à" are isolated as reusable tools
- Linking verbs merge with their attributes ("reste un défi" not "reste" + "un défi")
- Punctuation always attaches to preceding block
- Short adverbs absorbed into verb phrases

## PRP Workflow

This project uses Product Requirement Prompts (PRPs) for development planning. See `PRPs/README.md`. Custom slash commands in `.claude/commands/prp-core/` provide PRP creation and execution workflows.
