# Issue #7: Shadowing Mode for Language Learning Practice

**GitHub Issue:** https://github.com/ajanderson1/elevenlabs_flowreader/issues/7

## Problem Statement
Language learners need to hear their own voice making the sounds of the target language to improve pronunciation. The current workflow requires manually pausing the audio, repeating the phrase, and resuming - creating significant friction that disrupts the learning flow.

## Solution Overview
A "Shadowing" mode that automatically inserts pauses after each audio segment, giving the user time to repeat what they heard aloud.

## Technical Analysis

### Existing Architecture
1. **Meaning blocks** - Already detected by OpenAI API and stored in `activeOverlays` array
2. **Sentence boundaries** - Already detected via `getSentenceBoundaries()` function
3. **Navigation** - Arrow key navigation already works between blocks/sentences
4. **Playback detection** - Already tracking highlighted word via `getCurrentPlaybackPosition()`
5. **Storage** - Uses `chrome.storage.sync` for settings

### Key Components to Modify/Add

1. **popup.html** - Add shadowing settings UI
2. **popup.js** - Handle new settings persistence
3. **content.js** - Main shadowing logic
4. **styles.css** - Visual feedback styles

## Implementation Plan

### Phase 1: Popup Settings (popup.html, popup.js)

Add new settings section:
- **Shadowing** (toggle) - enables/disables the feature
- **Repetitions** (number input, 1-10, default: 1)
- **Pause Speed** (range slider, 0.5x - 2.0x, default: 1.0x)
- **Block Type** (toggle) - "Meaning Block" vs "Sentence"

### Phase 2: Shadowing State Management (content.js)

Add new state variables:
```javascript
const shadowingState = {
    enabled: false,
    repetitions: 1,
    pauseSpeed: 1.0,
    blockType: 'meaningBlock', // or 'sentence'
    isInPause: false,
    currentBlockIndex: -1,
    currentRepetition: 0,
    pauseTimer: null,
    pauseStartTime: 0,
    pauseDuration: 0
};
```

### Phase 3: Audio Detection & Control

Need to find and control the audio element:
```javascript
function getAudioElement() {
    // ElevenLabs Reader likely uses an audio element
    return document.querySelector('audio');
}

function pauseAudio() {
    const audio = getAudioElement();
    if (audio) audio.pause();
}

function resumeAudio() {
    const audio = getAudioElement();
    if (audio) audio.play();
}

function getPlaybackRate() {
    const audio = getAudioElement();
    return audio ? audio.playbackRate : 1.0;
}
```

### Phase 4: Block End Detection

Use MutationObserver to watch for highlighted word changes:
```javascript
function watchForBlockEnd() {
    // Watch for when the highlighted word changes
    // Detect if we've crossed a block boundary
    // If so, trigger shadowing pause
}
```

Calculate pause duration:
```javascript
function calculatePauseDuration(blockText) {
    // Estimate spoken duration from word count and WPM
    const words = blockText.split(/\s+/).length;
    const WPM = 150; // Approximate speaking rate
    const baseMinutes = words / WPM;
    const baseMs = baseMinutes * 60 * 1000;

    // Adjust for playback rate and pause speed multiplier
    const playbackRate = getPlaybackRate();
    const adjustedMs = (baseMs / playbackRate) * shadowingState.pauseSpeed;

    return adjustedMs;
}
```

### Phase 5: Visual Feedback

1. **Play button ellipsis** - Add CSS animation for "..." during pause
2. **Debug countdown** - Show remaining pause time when debug mode enabled
3. **Current block highlight** - Highlight the block being practiced

### Phase 6: Keyboard Controls During Shadowing Pause

Modify existing keyboard handler:
- **Left Arrow (during pause)**: Replay current block, restart pause
- **Right Arrow (during pause)**: Skip to next block immediately
- **Spacebar (during pause)**: Cancel pause, pause audio

### Architecture Decision: Event-Driven vs Polling

**Event-Driven approach (preferred):**
- Use `timeupdate` event on audio element
- Track current time relative to word positions
- More efficient, less CPU usage

**Polling approach (fallback):**
- Check highlighted word every 100ms
- Simpler but more resource intensive

## Files to Modify

1. **popup.html** - Add shadowing settings section
2. **popup.js** - Add settings handlers
3. **content.js** - Add shadowing logic
4. **styles.css** - Add visual feedback styles

## Acceptance Criteria Checklist

- [ ] Shadowing toggle in popup enables/disables the feature
- [ ] Repetitions setting controls how many times each block plays (range: 1-10)
- [ ] Pause Speed slider adjusts pause duration (range: 0.5x - 2.0x)
- [ ] Block Type toggle switches between meaning blocks and sentences
- [ ] Audio pauses after each block when shadowing is enabled
- [ ] Pause duration = segment duration x pause speed x detected playback rate
- [ ] Play button shows animated ellipsis during readback pause
- [ ] Debug mode shows countdown timer during pause
- [ ] Left arrow replays current block and restarts pause
- [ ] Right arrow skips to next block immediately
- [ ] Spacebar during pause cancels pause and pauses audio
- [ ] Settings persist via chrome.storage.sync

## Commits Plan

1. Add shadowing settings to popup UI
2. Implement shadowing state management
3. Add audio detection and control
4. Implement pause timer logic
5. Add visual feedback (ellipsis, countdown)
6. Implement keyboard controls during pause
7. Add CSS styles
8. Final testing and refinements
