# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) that injects inline translations into ElevenLabs Reader pages (elevenreader.io). Uses OpenAI's GPT-4o-mini API to split text into grammatical clauses and translate them, displaying translations as hovering overlays above the original text.

## Architecture

**Extension Components:**
- `background.js` - Service worker handling OpenAI API calls via message passing. Receives `TRANSLATE_TEXT` messages from content script, manages API key retrieval from chrome.storage.sync
- `content.js` - Injected into elevenreader.io pages. Extracts text from `#preview-content` paragraphs, maps text nodes to character positions, creates positioned overlay elements for translations
- `popup.js` / `popup.html` - Settings UI for API key entry and toggle controls (enabled, debug mode)
- `styles.css` - Overlay positioning, floating toggle button, debug highlighting styles

**Data Flow:**
1. Content script extracts paragraph text and builds textNode-to-position map
2. Sends text to background script via `chrome.runtime.sendMessage`
3. Background script calls OpenAI API, returns JSON array of `{original, translation}` objects
4. Content script matches clause positions using normalized text search, creates Range objects, positions overlays using `getBoundingClientRect()`

**Key Implementation Details:**
- Translation overlays are appended to `document.body` and positioned absolutely using scroll-aware coordinates
- `MutationObserver` watches `#preview-content` for dynamic content changes
- Press-and-hold "文" button reveals translations (mousedown/touchstart shows, mouseup/touchend hides)
- Debug mode draws yellow dashed highlight boxes around detected clauses

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

### Debugging
- Console logs prefixed with "ElevenLabs Translator:"
- Enable "Debug Clauses" toggle in popup to visualize clause boundaries
- Check Network tab for OpenAI API request/response issues
