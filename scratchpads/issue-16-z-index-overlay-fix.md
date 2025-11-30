# Issue #16: Translation overlays appear on top of navigation bar

**Issue Link:** https://github.com/ajanderson1/elevenlabs_flowreader/issues/16

## Problem

Translation overlays appear on top of the ElevenLabs navigation bar (with playback controls) instead of scrolling behind it like the original text does. The overlays have `z-index: 10000` and are appended to `document.body` with `position: absolute`, causing them to render above the nav bar's stacking context.

## Root Cause Analysis

1. **CSS z-index too high**: `styles.css:33` and `styles.css:207` set `z-index: 10000` on `.translation-overlay` and `.translation-overlay-container`
2. **DOM placement**: `content.js:545` appends overlays to `document.body` rather than within the content container (`#preview-content`)

When elements are appended to `document.body` with high z-index, they sit above everything including fixed position navigation bars.

## Solution

The fix requires two changes:

### 1. Lower z-index values
The translation overlays don't need to be above the navigation bar. They should be visible above the text content but below fixed UI elements like the nav bar.

### 2. Append overlays within content container (if needed)
Consider appending overlays within `#preview-content` so they inherit the same stacking context as the text. However, this might affect positioning calculations.

**Simpler approach:** Keep overlays in `document.body` but use a lower z-index. The ElevenLabs nav bar likely has a z-index that's reasonable (e.g., 1000 or less), so using z-index: 100-500 should allow overlays to be above content but below the nav.

## Implementation Plan

1. **Change z-index in CSS**:
   - `.translation-overlay`: change from `10000` to a lower value (e.g., `100`)
   - `.translation-overlay-container`: change from `10000` to a lower value (e.g., `100`)
   - `.clause-debug-container`: already at `9990`, lower to `99`
   - Processing banner at `10001` can stay high since it's a temporary notification
   - Toggle button at `10000` should stay high to remain accessible

2. **Keep overlay placement in document.body**:
   - The current positioning logic uses `getBoundingClientRect()` + `window.scrollY/scrollX`
   - This assumes overlays are direct children of body
   - Changing container would require recalculating positions relative to new parent

## Files to Modify

- `styles.css`: Update z-index values for overlay classes
