# Manipulating Audio Playback in ElevenLabs Reader

This document describes how the extension interacts with ElevenLabs Reader's audio playback system, including implementation details and gotchas discovered during development.

## ElevenLabs DOM Structure

### Word Spans
ElevenLabs Reader renders text as individual `<span>` elements with a `c` attribute representing character position:

```html
<span c="0">Hello</span>
<span c="6">world</span>
```

The `c` attribute is used internally by ElevenLabs to map text positions to audio timestamps.

### Active Word Highlighting
The currently playing word has the `active` class applied:

```html
<span c="6" class="active">world</span>
```

Query the active word with:
```javascript
document.querySelector('#preview-content span.active[c]')
```

### Play/Pause Button
The play/pause button changes its `aria-label` based on state:
- `[aria-label="Pause"]` - Audio is currently **playing**
- `[aria-label="Play"]` - Audio is currently **paused**

Multiple selectors may be needed as ElevenLabs updates their UI:
```javascript
const selectors = [
    '[data-testid="play-pause-button"]',
    '[aria-label="Play"]',
    '[aria-label="Pause"]',
    'button[aria-label*="Play"]',
    'button[aria-label*="Pause"]',
    // ... fallbacks
];
```

## Seeking Audio Position

### Basic Mechanism
Clicking on a `span[c]` element seeks the audio to that word's position. ElevenLabs listens for pointer/mouse events on these spans.

### Synthetic Events vs Real Clicks
**Key gotcha:** Synthetic events dispatched via JavaScript behave differently than real user clicks.

Real clicks:
- Seek precisely to the word
- No audio clipping

Synthetic events:
- May cause first syllable to be clipped
- May seek to slightly before the target word
- React state updates may not trigger reliably

### Event Sequence for Seeking
Dispatch a full event sequence for best compatibility:

```javascript
const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    screenX: clientX,
    screenY: clientY
};

// Modern pointer events
span.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, pointerId: 1, pointerType: 'mouse' }));
span.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, pointerId: 1, pointerType: 'mouse' }));

// Legacy mouse events for compatibility
span.dispatchEvent(new MouseEvent('mousedown', { ...eventOptions, button: 0 }));
span.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, button: 0 }));
span.dispatchEvent(new MouseEvent('click', { ...eventOptions, button: 0 }));
```

**Important:** Include realistic coordinates from `getBoundingClientRect()`. Some event handlers validate pointer position.

## Pause-Seek-Resume Pattern

To prevent audio clipping when seeking via synthetic events, use this pattern:

```javascript
function seekToSpan(span) {
    const wasPlaying = isAudioPlaying();

    // 1. Pause if playing
    if (wasPlaying) {
        togglePlayPause();
    }

    // 2. Wait for pause to take effect before seeking
    const performSeek = () => {
        // Dispatch click events on target span
        // ...

        // 3. After seek, check state before resuming
        setTimeout(() => {
            // Only resume if still paused (click didn't auto-start)
            if (wasPlaying && !isAudioPlaying()) {
                togglePlayPause();
            }
        }, 50);
    };

    if (wasPlaying) {
        setTimeout(performSeek, 18);  // Let pause settle
    } else {
        performSeek();
    }
}
```

### Why Check State Before Resuming?
Clicking on a span may or may not auto-start playback depending on:
- Current player state
- Timing of events
- ElevenLabs internal logic

If we blindly toggle after seeking, we might:
1. Pause (playing → paused)
2. Click causes auto-resume (paused → playing)
3. Toggle again (playing → paused) ← Wrong!

Always check `isAudioPlaying()` before the final toggle.

## Gotchas and Edge Cases

### 1. Timing Sensitivity
The delay between pause and seek matters. Too short and the seek may occur during a transitional state, causing incorrect positioning. Current working value: ~18-50ms.

### 2. React State Synchronization
ElevenLabs uses React. Synthetic events don't always trigger React's event handlers or state updates. The `active` class may not update even though audio seeked.

**Workaround:** Verify highlight position after seeking and force update if needed:
```javascript
function forceHighlightUpdate(targetSpan) {
    const currentActive = document.querySelector('#preview-content span.active[c]');
    if (currentActive) {
        currentActive.classList.remove('active');
    }
    targetSpan.classList.add('active');
}
```

### 3. DOM Order vs Reading Order
When finding spans within a range, `querySelectorAll` returns DOM order which may not match reading order. Use the `c` attribute to determine actual text position:

```javascript
const cValues = spans.map(s => parseInt(s.getAttribute('c'), 10));
const startC = Math.min(...cValues);
```

### 4. Button Selector Fragility
ElevenLabs may change button selectors between updates. Use multiple fallback selectors and handle `:has()` selector failures gracefully:

```javascript
for (const selector of selectors) {
    try {
        const btn = document.querySelector(selector);
        if (btn) return btn;
    } catch (err) {
        // :has() may not be supported
    }
}
```

## Helper Functions Reference

```javascript
// Check if audio is playing
function isAudioPlaying() {
    return document.querySelector('[aria-label="Pause"]') !== null;
}

// Toggle play/pause
function togglePlayPause() {
    const btn = document.querySelector('[aria-label="Play"], [aria-label="Pause"]');
    if (btn) btn.click();
}

// Get current playback position
function getCurrentPlaybackPosition() {
    const activeWord = document.querySelector('#preview-content span.active[c]');
    return activeWord ? parseInt(activeWord.getAttribute('c'), 10) : -1;
}

// Get active highlight span
function getActiveHighlightSpan() {
    return document.querySelector('#preview-content span.active[c]');
}
```

## Testing Checklist

When modifying audio playback code, verify:

- [ ] Keyboard navigation while playing resumes playback after seek
- [ ] Keyboard navigation while paused stays paused after seek
- [ ] No audio clipping at start of words after seek
- [ ] Seek position is accurate (not before or after target word)
- [ ] Rapid key presses debounce correctly
- [ ] Manual clicks on words still work normally
- [ ] Highlight stays in sync with audio position
