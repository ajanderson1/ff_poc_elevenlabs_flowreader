# ElevenLabs Reader Translator

A Chrome extension that injects inline translations into [ElevenLabs Reader](https://elevenreader.io) pages. Uses OpenAI's GPT-5-mini to split text into grammatical "meaning blocks" and display translations as hovering overlays above the original text.

## Features

### Inline Translations
- Automatically segments text into meaningful grammatical units (clauses/phrases)
- Displays translations as floating overlays positioned above the original text
- Supports multi-line text segments with properly split translations
- Hold the **文** button to reveal translations

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `/` (hold) | Show translations (same as holding **文** button) |
| `Space` | Play/Pause audio |
| `←` | Go to start of current meaning block |
| `←` `←` (double-press) | Go to previous meaning block |
| `→` | Go to next meaning block |
| `→` `→` (double-press) | Skip ahead two meaning blocks |

Keyboard shortcuts are disabled when typing in input fields.

### Visual Feedback
- Colored underlines show meaning block boundaries when translations are visible
- Each block gets a distinct color for easy differentiation

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select this directory
5. The extension icon will appear in your toolbar

## Configuration

Click the extension icon to open settings:

| Setting | Description |
|---------|-------------|
| **Enable Extension** | Master on/off toggle |
| **OpenAI API Key** | Required for translation (enter your `sk-...` key) |
| **Always Show Underlines** | (Debug) Show block underlines even without translations visible |

## Usage

1. Configure your OpenAI API key in the extension popup
2. Navigate to any article on [elevenreader.io](https://elevenreader.io)
3. The extension automatically processes visible paragraphs
4. Hold the **文** button (bottom-right) to reveal translations
5. Use keyboard shortcuts to navigate between meaning blocks

## Development

### Project Structure

```
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker for API calls
├── content.js          # Main content script (injection & UI)
├── styles.css          # Overlay and highlight styling
└── popup.html/js       # Settings popup UI
```

### Reloading Changes

After modifying code:
1. Go to `chrome://extensions`
2. Click the reload icon on the extension card

### Debugging

- Console logs are prefixed with `[FF]`
- Filter in DevTools with: `/^\[FF\]/`

## Requirements

- Chrome browser (Manifest V3 compatible)
- OpenAI API key with access to GPT-5-mini
- Active internet connection for API calls

## License

MIT
