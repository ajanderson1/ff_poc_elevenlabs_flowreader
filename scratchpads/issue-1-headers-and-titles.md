# Issue #1: Translation skips headers and titles

**GitHub Issue:** https://github.com/ajanderson1/elevenlabs_flowreader/issues/1

## Problem Summary

The extension only translates `<p>` paragraph elements, skipping headers (`<h1>` through `<h6>`) and title divs. Headers that contain `span[c]` elements should be translatable using the same position-based mapping system.

## Root Cause Analysis

Multiple selectors in `content.js` only target `p` elements:
1. **Line 911** - `reRenderAll()`: `document.querySelectorAll('#preview-content p')`
2. **Line 1023** - `processParagraphs()`: `contentDiv.querySelectorAll('p')`
3. **Line 1110** - `applyDoubleSpacing()`: `contentDiv.querySelectorAll('p')`
4. **Line 1461** - `getSentenceBoundaries()`: `document.querySelectorAll('#preview-content p')`

## Implementation Plan

### Step 1: Define a reusable selector constant

Create a constant at the top of the file that includes all translatable elements:
```javascript
const TRANSLATABLE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6';
```

### Step 2: Update all querySelector calls

Replace the hardcoded `'p'` selectors with the constant in these locations:
- `reRenderAll()` - line 911
- `processParagraphs()` - line 1023
- `applyDoubleSpacing()` - line 1110
- `getSentenceBoundaries()` - line 1461

### Step 3: Consider title div handling

The `.font-waldenburg` title div may lack `span[c]` structure. The existing code already handles this gracefully:
- `extractWordMap()` returns empty array if no `span[c]` elements found
- `processParagraphs()` skips elements with empty word maps (line 1082-1085)

So we don't need special handling - elements without `span[c]` will simply be skipped.

## Testing Notes

- Test on an article with `<h2>` section headers
- Verify paragraph translations still work
- Verify header translations appear correctly
- Verify double-spacing applies to headers
- Verify keyboard navigation works across headers and paragraphs

## Affected Files

- `content.js` - 4 selector changes
