# Issue #11: Replace Underlines with Background Color Highlighting

**Issue Link:** https://github.com/ajanderson1/ff_poc_elevenlabs_flowreader/issues/11

## Problem

The current "Always Show Underlines" toggle displays dotted underlines beneath meaning blocks, but this visual style doesn't clearly delineate block boundaries. It's difficult to see where one meaning block ends and another begins, especially when blocks contain internal whitespace.

## Solution

Replace the underline styling with a solid background color on each meaning block:

1. **Rename the toggle** from "Always Show Underlines" to "Show Meaning Blocks"
2. **Apply semi-transparent background colors** (~0.3 opacity) using alternating colors from palette
3. **Ensure background extends through whitespace** within each meaning block
4. **Support light/dark mode** with appropriate color adjustments
5. **Keep hover underline** for interaction feedback

## Technical Approach

### Current Implementation Analysis

1. **Meaning Block Wrappers** (`content.js:574-596`): The `wrapMeaningBlockSpans()` function already wraps meaning block spans in `.elt-meaning-block` span elements. This is crucial because these wrappers include the whitespace between words.

2. **Debug Highlights** (`styles.css:88-139`): Currently, `.clause-debug-highlight` elements are positioned absolutely and use dotted underlines. These are created per-line in `updateOverlayPositions()`.

3. **Storage Setting**: Uses `partitioningEnabled` boolean, controlled by toggle in popup.

### Implementation Plan

#### Step 1: Rename Toggle in Popup UI
- Change label from "Always Show Underlines" to "Show Meaning Blocks"
- Rename the setting from `partitioningEnabled` to `showMeaningBlocks` (optional - can keep existing for backwards compat)

#### Step 2: Update CSS for Background Highlighting
- Remove `border-bottom` styles from `.clause-debug-highlight`
- Add `background-color` with semi-transparent colors
- Apply background directly to `.elt-meaning-block` wrapper (simpler approach)
- Ensure continuous coverage through whitespace

#### Step 3: Apply Alternating Colors to Meaning Block Wrappers
- Pass color index to wrapper elements via data attribute or inline style
- Use existing `SEGMENT_COLOR_PALETTE` from content.js

#### Step 4: Light/Dark Mode Support
- Use CSS variables or media queries for color adjustments
- Light mode: lighter/pastel versions
- Dark mode: darker versions via opacity

#### Step 5: Preserve Hover Behavior
- Keep darker underline on hover for `.elt-hovered` class
- This provides clear interaction feedback

### Key CSS Changes

```css
/* Background highlight on meaning block wrapper */
.elt-meaning-block {
    display: inline;
    cursor: pointer;
    border-radius: 3px;
}

/* Apply background when "Show Meaning Blocks" is enabled */
body.elt-show-highlighting .elt-meaning-block {
    /* Color applied via inline style from JS */
}

/* Also show backgrounds when translations are visible (button held) */
body.elt-translations-visible .elt-meaning-block {
    /* Color applied via inline style from JS */
}

/* Hover: add darker underline for feedback */
body.elt-show-highlighting .elt-meaning-block:hover,
body.elt-translations-visible .elt-meaning-block:hover {
    border-bottom: 3px solid currentColor;
}
```

### Key JS Changes

1. In `wrapMeaningBlockSpans()` or `renderSegmentations()`:
   - Apply background color via inline style based on color index
   - Use existing `SEGMENT_COLOR_PALETTE`

2. Update color palette to have appropriate opacity for backgrounds

## Testing Plan

1. Enable "Show Meaning Blocks" toggle
2. Verify background colors appear on meaning blocks
3. Verify backgrounds cover whitespace within blocks
4. Verify gaps between blocks remain visible (no background)
5. Test hover behavior shows underline
6. Test dark mode colors
7. Test with translations visible (holding button)
