# Issue #7: Shadowing Mode for Language Learning

**Issue Link:** https://github.com/ajanderson1/elevenlabs_flowreader/issues/7

## Summary

Implement a "Shadowing" mode that automatically inserts pauses after each audio segment, giving users time to repeat what they heard aloud for language learning practice.

## Requirements (from issue + comments)

### Core Behavior
1. After each block (meaning block or sentence) finishes playing, audio pauses automatically
2. Pause duration = segment audio duration × pause speed multiplier × detected playback rate
3. Visual feedback during pause:
   - Animated ellipsis on play button (but don't change look/feel of play/pause or translate button)
   - In debug mode: countdown timer shows remaining pause time
4. Block can repeat multiple times before moving to next (configurable)

### Popup Settings
1. **Shadowing** (toggle) - enables/disables the feature (default: off)
2. **Repetitions** (number input) - how many times each block plays (range: 1-10, default: 1)
3. **Pause Speed** (slider) - multiplier for pause duration (range: 0.5x - 5.0x, default: 1.0x) - per comment
4. **Block Type** (toggle) - "Meaning Block" vs "Sentence" determines granularity

### Keyboard Controls During Shadowing
- **Left Arrow**: Replay the current block and restart the pause
- **Right Arrow**: Skip to the next block immediately
- **Spacebar (during pause)**: Cancel the pause, pause audio, resume from current position when pressed again

### Technical Notes
- Pause duration calculated from word count × WPM estimate, adjusted by detected playback rate
- Meaning blocks already exist from the OpenAI translation API response
- Sentence boundaries can be detected via punctuation (. ! ?)
- Playback rate can be detected from audio element's `playbackRate` property
- Settings persist via chrome.storage.sync

## Implementation Plan

### Phase 1: Popup UI Changes

**File: popup.html**
Add new "Shadowing" section with:
- Toggle for enabling shadowing mode
- Number input for repetitions (1-10)
- Range slider for pause speed (0.5x - 5.0x)
- Toggle for block type (Meaning Block / Sentence)

**File: popup.js**
- Load/save new settings from chrome.storage.sync
- Event handlers for new controls

### Phase 2: Shadowing State Machine (content.js)

New state module to track:
- `shadowingEnabled`: boolean
- `shadowingRepetitions`: number (1-10)
- `shadowingPauseSpeed`: number (0.5-5.0)
- `shadowingBlockType`: 'meaning' | 'sentence'
- `currentBlockIndex`: number
- `currentRepetition`: number
- `isPausing`: boolean
- `pauseStartTime`: timestamp
- `pauseDuration`: ms
- `pauseTimer`: setTimeout reference

### Phase 3: Audio Event Detection

Key challenge: Detect when ElevenLabs Reader finishes playing a block.

**Approach:**
1. Use MutationObserver to watch for highlight changes on spans with `c` attribute
2. When highlight moves from one block boundary to the next, we know a block just finished
3. Compare current highlighted word's `c` value against block boundaries
4. Use existing `getBlockBoundaries()` or `getSentenceBoundaries()` based on block type setting

**Detection Logic:**
- Track last known active span's c value
- When highlight changes, check if we crossed a block boundary
- If crossed and shadowing enabled: trigger pause

### Phase 4: Pause Implementation

When block boundary crossed:
1. Pause the audio (find and click play/pause button or use audio element API)
2. Calculate pause duration:
   - Estimate audio duration from word count (WPM estimate ~150-180)
   - Multiply by pause speed setting
   - Adjust by playback rate if detectable
3. Set up timer to auto-resume
4. Track repetition count

### Phase 5: Visual Feedback

**Countdown Timer (debug mode only):**
- Create fixed position overlay element
- Show remaining seconds during pause
- Style similar to processing banner

**Ellipsis Animation:**
- Per comment: "Do not change the look or feel of the play/pause button"
- Option: Add small floating indicator near toggle button instead

### Phase 6: Keyboard Controls

Modify existing keyboard handler:
- During pause state, arrow keys have special behavior:
  - Left: Seek to start of current block, reset repetition count, restart pause
  - Right: Cancel pause, skip to next block, start playing
- Spacebar during pause: Cancel pause, pause audio

### Phase 7: Edge Cases & Cleanup

- Handle page navigation / content changes
- Clean up timers on disable
- Persist settings correctly
- Handle rapid toggling
- Handle reaching end of content

## File Changes

| File | Changes |
|------|---------|
| popup.html | Add Shadowing section with 4 controls |
| popup.js | Load/save new settings, event handlers |
| content.js | Shadowing state machine, audio detection, pause logic |
| styles.css | Countdown timer styles (minimal) |

## Testing Checklist

- [ ] Toggle enables/disables shadowing
- [ ] Repetitions setting works (1-10)
- [ ] Pause speed slider works (0.5x - 5.0x)
- [ ] Block type toggle works (meaning block vs sentence)
- [ ] Audio pauses after each block
- [ ] Pause duration respects settings
- [ ] Countdown shows in debug mode
- [ ] Left arrow replays current block
- [ ] Right arrow skips to next block
- [ ] Spacebar cancels pause
- [ ] Settings persist across sessions
- [ ] Feature works with playback speed changes

## Previous Attempt Notes

PR #22 was closed with comment "Scrapping this approach - will restart with updated requirements"

Key changes from original issue (based on comments):
1. Pause speed range extended to 0.5x - 5.0x (not 0.5x - 2.0x)
2. Don't change look/feel of play/pause button or translate button
3. Countdown timer shows during pause (visual feedback mechanism)
