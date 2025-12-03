# Issue #16: Translation overlays appear on top of navigation bar

**Issue Link:** https://github.com/ajanderson1/ff_poc_elevenlabs_flowreader/issues/16
**PR:** https://github.com/ajanderson1/ff_poc_elevenlabs_flowreader/pull/18

## Problem

Translation overlays appear on top of the ElevenLabs navigation bar (with playback controls) instead of scrolling behind it like the original text does. The overlays have `z-index: 10000` and are appended to `document.body` with `position: absolute`, causing them to render above the nav bar's stacking context.

## Root Cause Analysis

1. **DOM placement was the real issue**: Overlays were appended to `document.body` instead of inside the content container. This placed them in a different stacking context from the original text.
2. **z-index alone doesn't fix it**: Even with lower z-index, overlays in `document.body` are in a different stacking context than content inside `#preview-content`, so they don't get clipped by the fixed nav bar.

## Solution (Implemented)

### 1. Move overlays inside `#preview-content`
- Changed `document.body.appendChild()` to append overlays to `#preview-content`
- This puts overlays in the same stacking context as the text
- Overlays now scroll with the content and go behind the fixed nav bar

### 2. Add `position: relative` to `#preview-content`
- Makes `#preview-content` a positioning context for absolutely-positioned overlays

### 3. Update position calculations
- Changed from document-relative (`line.top + window.scrollY`) to container-relative (`line.top - containerRect.top`)
- Positions are now calculated relative to `#preview-content` instead of the document

## Files Modified

- `styles.css`: Added `position: relative` to `#preview-content`, lowered z-index values
- `content.js`:
  - `renderSegmentations()`: Append overlays to `#preview-content` instead of `document.body`
  - `updateOverlayPositions()`: Calculate positions relative to container rect
