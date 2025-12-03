# Issue #17: Add Console Cost Debugging

**Issue Link:** https://github.com/ajanderson1/ff_poc_elevenlabs_flowreader/issues/17

## Summary

Add console logging that displays cost information after each translation API call:
- ElevenLabs Reader minutes (estimated from text length, ~833 chars/minute)
- OpenAI API cost (calculated from actual token usage in API response)

## Implementation Plan

### Step 1: Modify `background.js` to capture token usage

The OpenAI API response includes token usage data:
```json
{
  "usage": {
    "prompt_tokens": 142,
    "completion_tokens": 89,
    "total_tokens": 231
  }
}
```

Modify `handlePositionBasedPartitioning()` to:
1. Extract `data.usage` from the API response
2. Include token counts in the returned response object alongside the blocks

### Step 2: Modify `content.js` to calculate and log costs

Add cost calculation constants:
- GPT-4o-mini pricing: $0.15/1M input tokens, $0.60/1M output tokens
- ElevenLabs Reader: ~833 chars/minute estimate

Add cost tracking state:
- Running totals for ElevenLabs minutes, OpenAI cost, and token counts
- Only count successful API calls

Add per-paragraph logging after each successful translation in `processParagraphs()`:
```
[ELT] 📊 Paragraph 1 Cost:
      → ElevenLabs Reader: 0.4 min (of your subscription)
      → OpenAI API: $0.00023 (142 in / 89 out tokens)
```

Add final summary logging after all paragraphs processed:
```
[ELT] 📊 TOTAL COST SUMMARY:
      → ElevenLabs Reader: 4.2 min (of your subscription)
      → OpenAI API: $0.00189 (1,420 in / 890 out tokens)
```

### Step 3: Key Implementation Details

- Cost logging is **always active** (not tied to Debug Clauses toggle)
- Only count successful API calls (including successful retries)
- Calculate costs immediately per-paragraph, don't wait for all to complete
- Use the `Logger` class but bypass the debug flag for cost output

## Files to Modify

1. `background.js` - Extract and return token usage from OpenAI response
2. `content.js` - Calculate costs and add logging

## Acceptance Criteria Checklist

- [ ] Capture token usage (`prompt_tokens`, `completion_tokens`) from OpenAI API response in `background.js`
- [ ] Return token counts to content script alongside translation data
- [ ] Calculate OpenAI costs using GPT-4o-mini pricing ($0.15/1M input, $0.60/1M output tokens)
- [ ] Estimate ElevenLabs minutes from original text character count (~833 chars/min)
- [ ] Log per-paragraph costs immediately after each successful translation
- [ ] Log final summary totals after all paragraphs are processed
- [ ] Only count successful API calls (include retries that succeed, exclude failures)
- [ ] Cost logging always active (not tied to Debug Clauses toggle)
