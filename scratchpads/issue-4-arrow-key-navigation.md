# Issue #4: Arrow Key Navigation Limited to Two Presses

**GitHub Issue:** https://github.com/ajanderson1/ff_poc_elevenlabs_flowreader/issues/4

## Problem Summary

The arrow key navigation had two issues:
1. **Limited to binary detection**: Navigation only distinguished single vs double press, not accumulated presses (3rd, 4th, etc. presses were ignored)
2. **Intermediate audio snippets**: Audio started immediately on each navigation action, causing brief audio from intermediate blocks when rapidly skipping

## Root Cause Analysis

The original implementation used simple `isDouble` boolean detection:
```javascript
const isDouble = (now - lastLeftArrowTime) < DOUBLE_PRESS_THRESHOLD;
```

This only detected "is the current press within 300ms of the last press" - it didn't accumulate a count. And critically, `seekToSpan()` was called immediately, which triggered audio playback before rapid presses could complete.

## Solution

### Key Insight
Instead of binary single/double detection, track:
1. **Base position**: The block index at the START of a rapid-press sequence
2. **Press count**: How many rapid presses have occurred
3. **Debounced seek**: Only execute the final seek after presses stop

### Implementation

1. **State structure** - Each arrow key direction has its own state:
```javascript
let navState = {
    left: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null },
    right: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null },
    shiftLeft: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null },
    shiftRight: { lastTime: 0, count: 0, baseIndex: -1, seekTimer: null }
};
```

2. **Accumulated counting logic**:
```javascript
if (isRapidPress && state.count > 0) {
    state.count++;  // Keep counting rapid presses
} else {
    state.baseIndex = currentIndex;  // New sequence: capture base position
    state.count = 1;
}
```

3. **Target calculation from base**:
- Left: `targetIndex = baseIndex - (count - 1)`
  - 1st press = base (start of current), 2nd = 1 back, 3rd = 2 back...
- Right: `targetIndex = baseIndex + count`
  - 1st press = 1 forward, 2nd = 2 forward, 3rd = 3 forward...

4. **Debounced seek** - Cancel pending seek on each press, only execute after 300ms:
```javascript
if (state.seekTimer) clearTimeout(state.seekTimer);
state.seekTimer = setTimeout(() => {
    seekToSpan(boundaries[targetIndex].firstSpan);
}, DOUBLE_PRESS_THRESHOLD);
```

## Files Modified

- `content.js` - Navigation state and logic
