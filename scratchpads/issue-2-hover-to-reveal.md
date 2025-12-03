# Issue #2: Add Hover-to-Reveal for Individual Meaning Blocks

**Issue Link:** https://github.com/ajanderson1/ff_poc_elevenlabs_flowreader/issues/2

## Problem Statement

The current press-and-hold approach reveals all translations simultaneously, which:
- Is overwhelming for language learners
- Doesn't support self-testing (users want to challenge themselves)
- Undermines active comprehension practice

## Solution

Add hover-to-reveal functionality for individual meaning blocks:
- Hover over a meaning block shows only that block's translation
- Mouse leave hides the translation
- Darker underline provides visual feedback when hovering
- New "Individual Translations" toggle in popup
- Desktop-only (no touch support needed)
- Existing "文" button continues to work for revealing all

## Implementation Plan

### 1. Add Toggle to Popup UI (popup.html)

Add a new toggle under a "Partitioning" section header:
- ID: `individual-translations`
- Label: "Individual Translations"
- Default: enabled (true)

### 2. Add Storage Handling (popup.js)

- Load `individualTranslations` from `chrome.storage.sync`
- Default to `true` for new installations
- Save on toggle change

### 3. Add Hover Functionality (content.js)

Key insight from codebase analysis:
- `activeOverlays` array stores `{ range, overlayElement, debugElement, type, translation }`
- We need to associate each overlay with its corresponding spans
- Add `mouseenter`/`mouseleave` event listeners to the spans

Implementation approach:
1. In `renderSegmentations()`, store a reference to the spans in `activeOverlays`
2. Create new function `setupHoverListeners()` to add event listeners
3. On hover, show only that block's overlay and darken its underline
4. On mouse leave, hide the overlay and restore underline

### 4. Add CSS Styles (styles.css)

- `.clause-debug-highlight.elt-hovered` - darker underline when hovering
- Individual overlay visible state when hovered

### 5. Storage Change Listener

Listen for `individualTranslations` changes to enable/disable feature in real-time.

## Technical Details

### Data Flow

1. User hovers over a span with `c` attribute
2. Find which `activeOverlay` entry contains this span (check if span is within the range)
3. Show that overlay's `overlayElement` and `debugElement`
4. Add `.elt-hovered` class to debug highlight for darker underline
5. On mouseleave, reverse the above

### CSS Classes

```css
/* Individual hover state */
.clause-debug-highlight.elt-hovered {
    border-bottom-color: rgba(0, 0, 0, 0.8) !important;
    border-bottom-width: 3px !important;
}

/* Individual translation visible */
.translation-overlay-container.elt-individual-visible {
    display: block !important;
}
```

### JavaScript Changes

```javascript
// In renderSegmentations(), store spans reference:
activeOverlays.push({
    range,
    overlayElement: overlayContainer,
    debugElement: debugEl,
    type: segment.type,
    colorIndex: index % SEGMENT_COLOR_PALETTE.length,
    translation: segment.translation,
    spans: spansInRange  // NEW: store spans for hover detection
});

// New function to setup hover listeners
function setupHoverListeners(spansInRange, overlayContainer, debugEl) {
    // ... implementation
}
```

## Acceptance Criteria Checklist

- [ ] New "Individual Translations" toggle added to popup under Partitioning section
- [ ] Toggle enabled by default for new installations
- [ ] Setting persists in `chrome.storage.sync`
- [ ] Hovering a meaning block shows only its translation overlay
- [ ] Mouse leaving the meaning block immediately hides the translation
- [ ] Hovered meaning block underline becomes darker for visual feedback
- [ ] Feature only active on desktop (no touch events)
- [ ] Press-and-hold "文" button continues to show all translations regardless of toggle state
