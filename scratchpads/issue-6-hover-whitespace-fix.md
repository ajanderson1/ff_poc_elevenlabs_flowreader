# Issue #6: Hover Translation Disappears on Whitespace

**Issue Link:** https://github.com/ajanderson1/elevenlabs_flowreader/issues/6

## Problem

When "Individual Translations" is enabled, moving the mouse over whitespace between words in a multi-word meaning block causes the translation to disappear.

## Failed Approaches

### Attempt 1: Wrapper Elements
Created invisible positioned `<div>` elements over each meaning block.
**Failed because**: Positioning was wrong, interfered with clicks for audio seeking.

### Attempt 2: Mouse Position Tracking
Tracked mouse position with bounding box calculations and `mousemove` listener.
**Failed because**: Bounding boxes of adjacent blocks overlap, causing multiple overlays to be visible simultaneously. Complex and error-prone.

## Correct Solution: Debounced Hide + Global Tracking

The simplest approach:

1. **Global tracking**: Only ONE overlay can be visible at a time
2. **Immediate switch**: When hovering a new block, immediately hide the previous one
3. **Debounced hide**: When leaving a span, delay the hide by ~100ms to allow whitespace traversal

### Why This Works

- **No DOM changes**: Just JavaScript logic
- **No bounding box overlap issues**: We never compare bounding boxes
- **Only one visible**: Global tracking prevents multiple overlays
- **Smooth whitespace traversal**: Debounce allows moving between words
- **Immediate block switching**: Moving to a new block instantly hides the old one

### Implementation

```javascript
// Global state
let currentIndividualOverlay = null;  // Which overlay is currently shown
let individualHideTimeout = null;      // Pending hide timeout

function showIndividualTranslation(overlayData) {
    // Cancel pending hide
    if (individualHideTimeout) {
        clearTimeout(individualHideTimeout);
        individualHideTimeout = null;
    }

    // Hide previous if different
    if (currentIndividualOverlay && currentIndividualOverlay !== overlayData) {
        doHideOverlay(currentIndividualOverlay);
    }

    currentIndividualOverlay = overlayData;
    // ... show overlay
}

function setupHoverListeners(spans, overlayData) {
    spans.forEach(span => {
        span.addEventListener('mouseenter', () => {
            showIndividualTranslation(overlayData);
        });

        span.addEventListener('mouseleave', (e) => {
            if (e.relatedTarget && spans.includes(e.relatedTarget)) {
                return; // Moving within same block
            }
            // Delay hide to allow whitespace traversal
            scheduleHide(overlayData, 100);
        });
    });
}
```

### Behavior

| Scenario | Result |
|----------|--------|
| Hover word in block A | A shows |
| Move to whitespace (same block) | A stays (debounce) |
| Move to another word (same block) | A stays |
| Move to block B | A hides immediately, B shows |
| Leave all blocks | A hides after 100ms |
