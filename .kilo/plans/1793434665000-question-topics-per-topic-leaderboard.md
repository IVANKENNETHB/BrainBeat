# Plan: Question Topics, Per-Topic Leaderboard & Topic Panel

## Goal
Add user-defined **topics** (subjects) so imported questions are organized by topic, each topic gets its own leaderboard + team panel (like level is today), and a dedicated **topic panel** replaces the Settings import group with a topics table (CRUD topics + questions). Template download gains a topic-title field. Topic selection happens in test setup before mode, so only questions from the chosen topic appear in a round.

## Decisions (resolved)

1. **Topics coexist with levels.** Level (easy/normal/hard/expert) stays for question difficulty bands + scramble mix. Questions carry BOTH `difficulty` and `topic_id`.
2. **Teams + leaderboard move to per-topic.** `teams.topic_id` replaces level as the team grouping; leaderboard is per topic (topic replaces level for standings). Level still drives which questions a round draws.
3. **A question may be uncategorized** (`topic_id NULL`) so existing/legacy questions keep working.
4. **Deleting a topic** moves the topic row to a `deleted_topics` bin (30-day purge like teams) and sets its questions' `topic_id = NULL` (they stay in the bank, uncategorized). Questions are NOT moved to the recycle bin on topic delete.
5. **Import questions move to the topic panel.** The Settings "Import questions" group is replaced by a Topics panel showing all topics with question counts; import targets a chosen topic. The import flow prompts the user for the topic name (or selects from existing topics) before importing, so imported questions are tagged with that topic's `topic_id`.
6. **Template download** gains a "Topic title" input; downloaded CSV/JSON/TXT includes a `topic` column/field pre-filled with the title.
7. **Topic selection in setup.** Test setup shows a topic selector BEFORE the mode selector. Only questions belonging to the active topic appear in the pool/count chips. When no topic is selected, all uncategorized questions are shown (legacy behavior).
8. **Topic bin modal** follows the same Escape/backdrop-close pattern as the recycle bin modal.

## Affected files

Backend:
- `src-tauri/src/models.rs` — add `Topic` model; add `DeletedTopic` model; add `topic_id` to `Question` and `Team`
- `src-tauri/src/db.rs` — `topics` + `deleted_topics` tables; `topic_id` columns on `questions`/`teams`; topic CRUD + topic bin + purge on startup
- `src-tauri/src/commands.rs` — topic commands (`get_topics`, `add_topic`, `update_topic`, `delete_topic`, `recover_topic_from_bin`, `delete_topic_from_bin`, `purge_expired_deleted_topics`, `get_topics_with_counts`)
- `src-tauri/src/lib.rs` — register new topic commands + purge on startup

Frontend:
- `src/js/api.js` — topic API methods mirroring new commands
- `src/js/app.js` — topic state, CRUD, leaderboard/teams per topic, topic selector in setup, import-per-topic, template topic title, getActivePool filtered by active topic
- `src/js/levels.js` — optional: `getPoolByTopic(questions, topicId)` helper
- `src/index.html` — Topics panel screen, topic bin modal, template topic-title input, topic selector in setup, move import UI to Topics panel
- `src/css/styles.css` — topics panel + topic bin styles + setup topic selector styling

Tests:
- `tests/logic.test.js` — topic fixture assertions (optional)

## Tasks (ordered, implementation-ready)

### 1. Backend data model (models.rs)
- Add `Topic { id, name, created_at }` struct with serde camelCase.
- Add `DeletedTopic { id, name, created_at, deleted_at }` struct with serde camelCase.
- Add `topic_id: Option<i64>` to `Question` and `Team` (nullable for backward compat).
- Add serialization tests for Topic, DeletedTopic, Question with topic_id, Team with topic_id.

### 2. Backend schema + topic CRUD (db.rs)
- `init_schema`: create `topics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL)` and `deleted_topics (... + deleted_at TEXT NOT NULL)`; add `topic_id INTEGER` columns to `questions` and `teams` (idempotent via `ensure_column`).
- Call `purge_expired_deleted_topics()` on startup (same as teams).
- `list_topics() -> Vec<Topic>` ordered by name ASC.
- `get_topics_with_counts() -> Vec<{id, name, question_count}>`.
- `add_topic(name) -> Topic`.
- `update_topic(id, name) -> bool`.
- `delete_topic(id) -> bool` (moves to `deleted_topics`, nullifies `topic_id` on questions AND teams of that topic).
- `list_deleted_topics() -> Vec<DeletedTopic>` newest first.
- `recover_topic_from_bin(id) -> bool`.
- `delete_topic_from_bin(id) -> bool`.
- `purge_expired_deleted_topics() -> usize` (30 days, `datetime('now', '-30 days')`).

### 3. Backend commands (commands.rs) + lib.rs
- Add Tauri commands for all topic CRUD + bin operations.
- Register them in `lib.rs` invoke_handler.
- Call `purge_expired_deleted_topics()` in lib.rs setup alongside teams purge.

### 4. Frontend API (api.js)
- `getTopics()`, `addTopic(name)`, `updateTopic(id, name)`, `deleteTopic(id)`, `recoverTopicFromBin(id)`, `deleteTopicFromBin(id)`, `purgeExpiredDeletedTopics()`, `getTopicsWithCounts()`.

### 5. Frontend app state & logic (app.js)
- Add `this.topics = []`, `this.activeTopicId` (nullable), `this.topicsById` map.
- Load topics on startup (merge with `getQuestions` load via `QuizApi.getTopics()`).
- Topic CRUD methods + renderTopicsPanel() (topics table with question counts, add/edit/delete topic rows; delete row → confirm → move to bin).
- `getTopicPool(topicId)` → questions where `topic_id === topicId` (or all when topicId is null/undefined for legacy uncategorized).
- `getActivePool()` filtered by active topic when one is selected.
- Topic selector in setup screen (before mode): dropdown of available topics + "All/uncategorized" option.
- Leaderboard per topic: `getScoreboard(topicId)`, lobby leaderboard/team selector filtered by active topic; `tallyTeamScores` uses `activeTopicId`.
- Teams per topic: `getTeamDrafts(topicId)`, team panel shows teams of active topic.
- Import questions target active topic; `topic_id` sent with each imported question.
- Template download: read topic title input, include `topic` column in template content, pass title to file name.
- Update `updateBankStats()` to show per-topic counts in Topics panel.

### 6. Frontend UI (index.html + styles.css)
- New `#screen-topics` section (Topics panel): topics table (name, question count, actions), add-topic input, per-topic question list with edit/delete, delete-topic button (→ bin).
- Topic selector in `#screen-home` setup (before mode group): dropdown of topics.
- Topic bin modal (`#topic-bin-modal`) with recover/delete per topic.
- Template modal: add `<input id="template-topic-title">` + pass to `buildTemplateContent`/file name.
- Move import-buttons into the Topics panel; keep Settings Question Bank stats only.

### 7. Validation
- `cargo test --manifest-path src-tauri/Cargo.toml` (Rust backend tests)
- `npm test` (Node logic tests)
- Manual: open Topics panel, add topic, import questions into topic, verify leaderboard/teams per topic, delete topic → bin, recover, template download with topic title, topic selection in setup filters questions.

## Open questions (non-blocking)
- None blocking. Topic replaces level as team/leaderboard grouping (matching the user's "same as sa panel team" request).
