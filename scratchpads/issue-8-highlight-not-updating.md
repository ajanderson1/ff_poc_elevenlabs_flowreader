# Issue #8: Arrow Key Navigation - Highlighted Word Not Updating

**GitHub Issue:** https://github.com/ajanderson1/elevenlabs_flowreader/issues/8

## Problem Summary

When using arrow keys to navigate between meaning blocks, the audio playback position moves but the ElevenLabs highlighted word (the span with `class="active"`) does not update to reflect the new position.

## Root Cause Analysis

The current `seekToSpan()` function (content.js:1239-1261) dispatches synthetic pointer/mouse events to trigger seeking:

```javascript
function seekToSpan(span) {
    // Dispatches pointerdown/pointerup and mousedown/mouseup/click
    span.dispatchEvent(new PointerEvent('pointerdown', {...}));
    span.dispatchEvent(new PointerEvent('pointerup', {...}));
    span.dispatchEvent(new MouseEvent('mousedown', {...}));
    span.dispatchEvent(new MouseEvent('mouseup', {...}));
    span.dispatchEvent(new MouseEvent('click', {...}));
}
```

**The Problem:** ElevenLabs Reader uses a React-based event system that doesn't fully respond to these synthetic DOM events. The audio may move via some mechanism, but React's internal state controlling the `class="active"` attribute isn't updated because:

1. React uses its own synthetic event system that intercepts native events
2. Simply dispatching DOM events doesn't trigger React's state updates
3. There's no verification that the highlighting actually changed

## Solution Strategy

### Approach 1: Polling-based Verification with Retry

After dispatching events, poll to check if the `active` class moved to the expected span. If not, try alternative event dispatch methods or force a UI update.

### Approach 2: Direct DOM Manipulation (Fallback)

If synthetic events consistently fail to update React's highlighting, we could:
1. Remove `active` class from current span
2. Add `active` class to target span
3. This is a visual workaround that keeps our navigation consistent

### Approach 3: Find ElevenLabs Audio Element

Look for the audio element or player API that ElevenLabs exposes and try to set currentTime directly based on the span's character position.

## Implementation Plan

1. **Add verification after seek**
   - After calling `seekToSpan()`, wait briefly then check if `active` class moved
   - Log success/failure for debugging

2. **Implement polling-based retry**
   - If verification fails, try dispatching events with different options
   - Try adding `isTrusted: true` simulation (may not work in Chrome)

3. **Add fallback DOM manipulation**
   - If all event dispatch attempts fail, manually update the `active` class
   - This ensures visual consistency even if audio doesn't perfectly sync

4. **Investigate audio element seek**
   - Search for audio element in the DOM
   - Check if we can access currentTime and set it based on character position

## Files to Modify

- `content.js` - seekToSpan function and navigation logic

## Testing

- Start audio playback
- Press arrow keys and verify:
  1. Audio moves to correct position
  2. Highlighted word (active class) updates to match
- Test rapid pressing to ensure debouncing still works
