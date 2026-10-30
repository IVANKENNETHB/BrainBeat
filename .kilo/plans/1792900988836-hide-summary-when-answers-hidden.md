# Plan: Hide result summary when answers are hidden

## Goal
Hide the `results-summary` block (score percent, stat tiles, performance note) when the answer review is locked/hidden, and show it again when answers are revealed. Keep the UI clean with a subtle fade transition.

## Current behavior
- `renderResults()` (src/js/app.js:3332) always calls `renderSummary()`, populating `results-summary` (src/index.html:250).
- `hideAnswers()` (src/js/app.js:3740) only re-renders `review-list` and toggles the Reveal/Hide buttons. `results-summary` stays visible regardless of `answersRevealed`.
- `revealAnswers()` presumably mirrors `hideAnswers()` — same gap.

## Desired behavior
- `answersRevealed === false` → `results-summary` hidden (collapsed out of layout + hidden from assistive tech).
- `answersRevealed === true` → `results-summary` visible with a clean fade-in.
- Title (`results-title`) and review toolbar stay visible in both states.

## Design decisions
1. Toggle the `hidden` attribute on `this.dom.resultsSummary` based on `this.answersRevealed` — consistent with existing `[hidden] { display: none !important; }` pattern used by buttons (src/css/styles.css:75).
2. Add a CSS fade transition so the summary smoothly appears/disappears instead of snapping. Because `[hidden]` forces `display: none`, transitions on `hidden` itself won't animate; use a companion class `.summary-visible` / opacity transition on the non-hidden state for entrance polish.
3. Hook visibility into both `hideAnswers()` and `revealAnswers()` so the summary toggles whenever the lock state changes. Also call once in `renderResults()` so the initial end-of-quiz state is correct.

## Files to change
- `src/js/app.js`
  - Add a private helper `toggleSummaryVisibility()` that sets `this.dom.resultsSummary.hidden = !this.answersRevealed` and toggles a CSS class for the fade.
  - Call it from `hideAnswers()`, `revealAnswers()`, and `renderResults()`.
- `src/css/styles.css`
  - Add `transition: opacity ...` on `.results-summary`.
  - Add a collapsed/opacity state for when hidden (without fighting `[hidden]`) — e.g. `.results-summary.summary-collapsed { opacity: 0; }` paired with JS class toggle, plus `@keyframes` entrance on reveal.

## Edge cases
- Practice mode vs quizmaster mode both render via `renderSummary()`; toggle applies to both identically.
- If `resultsSummary` is null (defensive), guard the helper.
- Initial page load before any quiz ends: summary is empty anyway; no visible flash.

## Validation
- End a quiz in practice mode → summary starts hidden (confirmed).
- Click "Reveal answers" → summary fades in.
- Click "Hide answers" → summary fades out / removed.
- Review list still locks/unlocks independently (summary visibility tied only to `answersRevealed`).

## Decisions resolved
- Summary starts hidden on first results render (user confirmed).
