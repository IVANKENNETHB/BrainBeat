# Plan: Add .json / .csv / .txt format options to Download Template modal

## Goal
Let the user choose the file format (`.json`, `.csv`, or `.txt`) when downloading the question import template from Settings → Question Bank → Import questions → Download Template.

## Context / findings
- The feature is **mostly implemented already**:
  - `src/js/app.js:3935-3980` — `buildTemplateCsv()`, `buildTemplateJson()`, `buildTemplateTxt()` build content per format.
  - `src/js/app.js:3982-4007` — `getTemplateFormat()` (defaults to `"csv"`), `setTemplateFormat()`, `buildTemplateContent()`, `getTemplateFileName()` (picks `.csv`/`.json`/`.txt` extension).
  - `src/js/app.js:537-539` — `case "template-format"` dispatches to `setTemplateFormat(element.dataset.format)`.
  - `src/js/app.js:4057+` — `saveTemplateToDownloads()` uses `buildTemplateContent()` + `getTemplateFileName()` and calls Tauri `save_template_to_downloads` (falls back to browser blob download).
  - `src/css/styles.css:1891-1912` — `.template-format-group`, `.template-format-chip`, `.template-format-chip.is-active` styles already exist.
  - `src-tauri/src\commands.rs:342` — `save_template_to_downloads(contents, file_name)` already accepts any file name/extension.
- **What is missing**: the modal HTML (`src/index.html:421-432`) has no format-selection UI, so the format chips never render and the download always defaults to CSV.

## Changes
1. `src/index.html` — template modal (`#template-modal`):
   - Add a `.template-format-group` containing three `.template-format-chip` buttons (`data-action="template-format"`, `data-format="csv|json|txt"`), with `csv` active by default.
   - Update `#template-message` to be format-agnostic (e.g., "Choose the file format for the question template.").
2. `src/js/app.js` — `openTemplateModal()` (`src/js/app.js:4010`):
   - Call `this.setTemplateFormat("csv")` (or restore last chosen format) when opening so the active chip matches `getTemplateFormat()` default. No other JS changes required.

## Affected boundaries / data flow
- UI: settings screen → Download Template modal → format chips → Save.
- JS: chip click → `template-format` action → `setTemplateFormat()` → `getTemplateFormat()` → `buildTemplateContent()`/`getTemplateFileName()` → `saveTemplateToDownloads()` → Tauri `save_template_to_downloads` (or blob fallback).
- File written to Downloads with the matching extension and matching content type.

## Failure modes / rollback
- If chips fail to render, `getTemplateFormat()` still defaults to `"csv"` → download works as today (CSV). Safe degradation.
- Rollback: revert the two HTML/JS edits; no Tauri/CSS changes.

## Validation
- Open Settings → Question Bank → Import questions → Download Template.
- Verify three chips (CSV/JSON/TXT) render; CSV highlighted by default.
- Click each chip → active state switches; `getTemplateFormat()` returns the chosen format.
- Click Save → file downloaded with correct extension and content:
  - CSV: header row + example rows, `.csv`.
  - JSON: JSON array of question objects, `.json`.
  - TXT: `key: value` blocks, `.txt`.
- Verify Escape / Cancel closes the modal without downloading.

## Open questions (none blocking)
- None; persist last-chosen format across opens can be added later as a follow-up.
