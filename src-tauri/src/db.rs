use crate::models::{DeletedTeam, DeletedTopic, Question, Team, Topic};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

/// Opens (or creates) the SQLite database and applies the schema.
///
/// The app ships without a built-in question bank: the questions come from
/// the imports of the user.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    init_schema(&conn)?;
    Ok(conn)
}

/// Creates the tables if they do not already exist.
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS questions (
            id               INTEGER PRIMARY KEY,
            source           TEXT NOT NULL DEFAULT 'builtin',
            type             TEXT NOT NULL,
            difficulty       TEXT NOT NULL DEFAULT 'normal',
            text             TEXT NOT NULL,
            options          TEXT,
            correct_answer   TEXT NOT NULL,
            accepted_answers TEXT NOT NULL DEFAULT '[]',
            explanation      TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS teams (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            level           TEXT NOT NULL DEFAULT 'normal',
            score           INTEGER NOT NULL DEFAULT 0,
            total_questions INTEGER NOT NULL DEFAULT 0,
            time_seconds    INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            UNIQUE (name, level)
        );

        CREATE TABLE IF NOT EXISTS attempts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            given       TEXT,
            is_correct  INTEGER NOT NULL,
            answered_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS deleted_teams (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            level           TEXT NOT NULL DEFAULT 'normal',
            score           INTEGER NOT NULL DEFAULT 0,
            total_questions INTEGER NOT NULL DEFAULT 0,
            time_seconds    INTEGER NOT NULL DEFAULT 0,
            deleted_at      TEXT NOT NULL
        );
        ",
    )?;

    // Databases created before team scores existed miss the column; add it
    // without touching existing rows.
    ensure_column(conn, "teams", "score", "INTEGER NOT NULL DEFAULT 0")?;
    // Leaderboard now breaks score ties on answering time, so a team also
    // stores how many questions it played and how long it took.
    ensure_column(conn, "teams", "total_questions", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "teams", "time_seconds", "INTEGER NOT NULL DEFAULT 0")?;
    // Questions carry a difficulty band used to build the level pools.
    ensure_column(conn, "questions", "difficulty", "TEXT NOT NULL DEFAULT 'normal'")?;

    // Every level has its own team list, so a team name may only be used
    // once per level.
    migrate_teams_for_levels(conn)?;

    // The recycle bin holds teams that were removed from a level. Older
    // databases never had one, so the table is created here alongside the
    // other migrations.
    ensure_table(conn, "deleted_teams", "
        CREATE TABLE IF NOT EXISTS deleted_teams (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            level           TEXT NOT NULL DEFAULT 'normal',
            score           INTEGER NOT NULL DEFAULT 0,
            total_questions INTEGER NOT NULL DEFAULT 0,
            time_seconds    INTEGER NOT NULL DEFAULT 0,
            deleted_at      TEXT NOT NULL
        );
    ")?;
    ensure_column(conn, "deleted_teams", "score", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "deleted_teams", "total_questions", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "deleted_teams", "time_seconds", "INTEGER NOT NULL DEFAULT 0")?;

    // Topics organize questions independently of levels. Each topic has its
    // own team list and leaderboard.
    ensure_table(conn, "topics", "
        CREATE TABLE IF NOT EXISTS topics (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
    ")?;

    // The topic bin holds removed topics for 30 days before automatic purge.
    ensure_table(conn, "deleted_topics", "
        CREATE TABLE IF NOT EXISTS deleted_topics (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            deleted_at  TEXT NOT NULL
        );
    ")?;

    // Questions and teams may optionally belong to a topic. Null means
    // uncategorized; existing rows keep working without a topic.
    ensure_column(conn, "questions", "topic_id", "INTEGER")?;
    ensure_column(conn, "teams", "topic_id", "INTEGER")?;

    // Purge expired topic-bin entries on startup, same as the team bin.
    if let Err(error) = purge_expired_deleted_topics(conn) {
        eprintln!("could not purge expired deleted topics: {error}");
    }

    // The app ships without a built-in bank, so the questions of older
    // builds are dropped on start up. Imported questions are kept.
    conn.execute("DELETE FROM questions WHERE source = 'builtin'", [])?;

    Ok(())
}

/// True when `table` already has the given column.
fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;

    while let Some(row) = rows.next()? {
        let name: String = row.get("name")?;

        if name == column {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Rebuilds the teams table so a team can exist once per level.
///
/// Older databases made `name` unique on its own, which would stop the same
/// team name from being used on two different levels. SQLite cannot drop a
/// UNIQUE constraint, so the table is rebuilt and the existing rows move to
/// the "normal" level.
fn migrate_teams_for_levels(conn: &Connection) -> rusqlite::Result<()> {
    if column_exists(conn, "teams", "level")? {
        return Ok(());
    }

    conn.execute_batch(
        "
        BEGIN;
        CREATE TABLE teams_by_level (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            level           TEXT NOT NULL DEFAULT 'normal',
            score           INTEGER NOT NULL DEFAULT 0,
            total_questions INTEGER NOT NULL DEFAULT 0,
            time_seconds    INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL
        );
        INSERT INTO teams_by_level (id, name, level, score, total_questions, time_seconds, created_at)
            SELECT id, name, 'normal', score, total_questions, time_seconds, created_at FROM teams;
        DROP TABLE teams;
        ALTER TABLE teams_by_level RENAME TO teams;
        CREATE UNIQUE INDEX idx_teams_name_level ON teams (name, level);
        COMMIT;
        ",
    )?;

    Ok(())
}

/// Adds `column` to `table` when it is missing (idempotent migration helper).
fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> rusqlite::Result<()> {
    if column_exists(conn, table, column)? {
        return Ok(());
    }

    conn.execute(
        &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition),
        [],
    )?;

    Ok(())
}

/// Creates `table` with the given SQL when it does not already exist.
fn ensure_table(conn: &Connection, table: &str, sql: &str) -> rusqlite::Result<()> {
    if table_exists(conn, table)? {
        return Ok(());
    }

    conn.execute_batch(sql)?;
    Ok(())
}

/// True when `table` already exists in the schema.
fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")?;
    let mut rows = stmt.query(params![table])?;
    Ok(rows.next()?.is_some())
}

/// Inserts a single question and returns it with the assigned id.
pub fn insert_question(conn: &Connection, source: &str, q: &Question) -> rusqlite::Result<Question> {
    let options_json = match &q.options {
        Some(opts) => Some(serde_json::to_string(opts).unwrap()),
        None => None,
    };
    let correct_json = serde_json::to_string(&q.correct_answer).unwrap();
    let accepted_json = serde_json::to_string(&q.accepted_answers).unwrap();

    conn.execute(
        "INSERT INTO questions (source, type, difficulty, text, options, correct_answer, accepted_answers, explanation, topic_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            source,
            q.qtype,
            q.difficulty,
            q.text,
            options_json,
            correct_json,
            accepted_json,
            q.explanation,
            q.topic_id
        ],
    )?;

    let mut inserted = q.clone();
    inserted.id = conn.last_insert_rowid();
    inserted.source = source.to_string();
    Ok(inserted)
}

/// Maps a DB row into a `Question` for the frontend.
fn row_to_question(row: &rusqlite::Row) -> rusqlite::Result<Question> {
    let options_json: Option<String> = row.get("options")?;
    let correct_json: String = row.get("correct_answer")?;
    let accepted_json: String = row.get("accepted_answers")?;

    let options = options_json.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok());
    let correct_answer: serde_json::Value =
        serde_json::from_str(&correct_json).unwrap_or(serde_json::Value::Null);
    let accepted_answers: Vec<String> = serde_json::from_str(&accepted_json).unwrap_or_default();

    Ok(Question {
        id: row.get("id")?,
        source: row.get("source")?,
        qtype: row.get("type")?,
        difficulty: row.get("difficulty")?,
        text: row.get("text")?,
        options,
        correct_answer,
        accepted_answers,
        explanation: row.get("explanation")?,
        topic_id: row.get("topic_id")?,
    })
}

/// Returns every question in the bank, ordered by id.
pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<Question>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, type, difficulty, text, options, correct_answer, accepted_answers, explanation, topic_id
         FROM questions ORDER BY id ASC",
    )?;

    let rows = stmt.query_map([], |row| row_to_question(row))?;
    rows.collect()
}

/// Removes all user-imported questions.
pub fn clear_imported(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM questions WHERE source = 'imported'", [])
}

/// Records a single attempt.
pub fn record_attempt(
    conn: &Connection,
    question_id: i64,
    given: Option<String>,
    is_correct: bool,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attempts (question_id, given, is_correct, answered_at) VALUES (?1, ?2, ?3, ?4)",
        params![question_id, given, if is_correct { 1 } else { 0 }, now],
    )?;
    Ok(())
}

/// Reads a setting value, falling back to `None` when unset.
pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// Upserts a setting value.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Inserts a team on a level, or returns the existing one if the name is
/// already taken on that level.
pub fn add_team(conn: &Connection, name: &str, level: &str) -> rusqlite::Result<Team> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO teams (name, level, topic_id, created_at) VALUES (?1, ?2, NULL, ?3)",
        params![name, level, now],
    )?;

    conn.query_row(
        "SELECT id, name, level, topic_id, score, total_questions, time_seconds
         FROM teams WHERE name = ?1 AND level = ?2",
        params![name, level],
        |row| {
            Ok(Team {
                id: row.get(0)?,
                name: row.get(1)?,
                level: row.get(2)?,
                topic_id: row.get(3)?,
                score: row.get(4)?,
                total_questions: row.get(5)?,
                time_seconds: row.get(6)?,
            })
        },
    )
}

/// Returns all saved teams, ordered by level and then by name.
pub fn get_teams(conn: &Connection) -> rusqlite::Result<Vec<Team>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, level, topic_id, score, total_questions, time_seconds
         FROM teams ORDER BY level ASC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Team {
            id: row.get(0)?,
            name: row.get(1)?,
            level: row.get(2)?,
            topic_id: row.get(3)?,
            score: row.get(4)?,
            total_questions: row.get(5)?,
            time_seconds: row.get(6)?,
        })
    })?;
    rows.collect()
}

/// Removes a team (and its score) from a level.
pub fn remove_team(conn: &Connection, name: &str, level: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM teams WHERE name = ?1 AND level = ?2",
        params![name, level],
    )
}

/// Moves a team from the active list into the recycle bin.
///
/// The row is deleted from `teams` and re-inserted into `deleted_teams` with a
/// timestamp, so the host can recover it (and its score) within 30 days. When
/// the team is not present on the level nothing is moved.
pub fn move_team_to_bin(conn: &Connection, name: &str, level: &str) -> rusqlite::Result<bool> {
    let row: Option<(i64, i64, i64, i64)> = conn
        .query_row(
            "SELECT id, score, total_questions, time_seconds
             FROM teams WHERE name = ?1 AND level = ?2",
            params![name, level],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;

    let row = match row {
        Some(row) => row,
        None => return Ok(false),
    };

    conn.execute(
        "DELETE FROM teams WHERE name = ?1 AND level = ?2",
        params![name, level],
    )?;

    // A team may have been moved to the bin before and re-added since, so the
    // bin could already hold a stale entry for this name and level. Drop it
    // before re-inserting so the UNIQUE(name, level) constraint never trips.
    conn.execute(
        "DELETE FROM deleted_teams WHERE name = ?1 AND level = ?2",
        params![name, level],
    )?;

    // Store the timestamp in SQLite's native format so the 30-day purge in
    // `purge_expired_deleted_teams` can compare it with `datetime('now')`.
    conn.execute(
        "INSERT INTO deleted_teams (name, level, score, total_questions, time_seconds, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        params![name, level, row.1, row.2, row.3],
    )?;

    Ok(true)
}

/// Returns the teams currently held in the recycle bin, newest first.
pub fn list_deleted_teams(conn: &Connection) -> rusqlite::Result<Vec<DeletedTeam>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, level, score, total_questions, time_seconds, deleted_at
         FROM deleted_teams ORDER BY deleted_at DESC, id DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(DeletedTeam {
            id: row.get(0)?,
            name: row.get(1)?,
            level: row.get(2)?,
            score: row.get(3)?,
            total_questions: row.get(4)?,
            time_seconds: row.get(5)?,
            deleted_at: row.get(6)?,
        })
    })?;

    rows.collect()
}

/// Restores a team from the recycle bin back into the active list.
///
/// The team is re-inserted on its original level with the score it had when it
/// was deleted. When a team with the same name already exists on that level
/// the restore is skipped, so a re-added team is never silently overwritten.
/// Returns true when a row was actually restored.
pub fn recover_team_from_bin(conn: &Connection, name: &str, level: &str) -> rusqlite::Result<bool> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM teams WHERE name = ?1 AND level = ?2",
            params![name, level],
            |row| row.get(0),
        )
        .optional()?;

    if existing.is_some() {
        return Ok(false);
    }

    let row: Option<DeletedTeam> = conn
        .query_row(
            "SELECT id, name, level, score, total_questions, time_seconds, deleted_at
             FROM deleted_teams WHERE name = ?1 AND level = ?2",
            params![name, level],
            |row| {
                Ok(DeletedTeam {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    level: row.get(2)?,
                    score: row.get(3)?,
                    total_questions: row.get(4)?,
                    time_seconds: row.get(5)?,
                    deleted_at: row.get(6)?,
                })
            },
        )
        .optional()?;

    let row = match row {
        Some(row) => row,
        None => return Ok(false),
    };

    conn.execute(
        "INSERT INTO teams (name, level, score, total_questions, time_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![row.name, row.level, row.score, row.total_questions, row.time_seconds, row.deleted_at],
    )?;

    conn.execute(
        "DELETE FROM deleted_teams WHERE id = ?1",
        params![row.id],
    )?;

    Ok(true)
}

/// Deletes every bin entry older than 30 days. Returns the number removed.
pub fn purge_expired_deleted_teams(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM deleted_teams
         WHERE deleted_at < datetime('now', '-30 days')",
        [],
    )
}

/// Permanently removes a team from the recycle bin. Unlike recovery, this
/// cannot be undone: the team and its score are gone.
///
/// Returns true when a bin entry was actually deleted.
pub fn delete_team_from_bin(conn: &Connection, name: &str, level: &str) -> rusqlite::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM deleted_teams WHERE name = ?1 AND level = ?2",
        params![name, level],
    )?;

    Ok(affected > 0)
}

/// Returns every topic ordered by name.
pub fn list_topics(conn: &Connection) -> rusqlite::Result<Vec<Topic>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at FROM topics ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Topic {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// Returns every topic with its question count.
pub fn get_topics_with_counts(conn: &Connection) -> rusqlite::Result<Vec<(Topic, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.created_at, COUNT(q.id)
         FROM topics t
         LEFT JOIN questions q ON q.topic_id = t.id
         GROUP BY t.id, t.name, t.created_at
         ORDER BY t.name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let topic = Topic {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        };
        let count: i64 = row.get(3)?;
        Ok((topic, count))
    })?;
    rows.collect()
}

/// Inserts a new topic and returns it with the assigned id.
pub fn add_topic(conn: &Connection, name: &str) -> rusqlite::Result<Topic> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO topics (name, created_at) VALUES (?1, ?2)",
        params![name, now],
    )?;

    Ok(Topic {
        id: conn.last_insert_rowid(),
        name: name.to_string(),
        created_at: now,
    })
}

/// Renames a topic. Returns true when a row was actually updated.
pub fn update_topic(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<bool> {
    let affected = conn.execute(
        "UPDATE topics SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;

    Ok(affected > 0)
}

/// Removes a topic: moves it to the topic bin and nullifies topic_id on its
/// questions and teams. The questions and teams themselves are not deleted.
pub fn delete_topic(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let row: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT id, name, created_at FROM topics WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let row = match row {
        Some(row) => row,
        None => return Ok(false),
    };

    conn.execute("DELETE FROM topics WHERE id = ?1", params![id])?;

    // Nullify topic_id on questions and teams of this topic so they remain
    // usable but uncategorized.
    conn.execute(
        "UPDATE questions SET topic_id = NULL WHERE topic_id = ?1",
        params![id],
    )?;
    conn.execute(
        "UPDATE teams SET topic_id = NULL WHERE topic_id = ?1",
        params![id],
    )?;

    // Store the timestamp in SQLite's native format so the 30-day purge can
    // compare it with datetime('now').
    conn.execute(
        "INSERT INTO deleted_topics (id, name, created_at, deleted_at)
         VALUES (?1, ?2, ?3, datetime('now'))",
        params![row.0, row.1, row.2],
    )?;

    Ok(true)
}

/// Returns every topic currently held in the topic bin, newest first.
pub fn list_deleted_topics(conn: &Connection) -> rusqlite::Result<Vec<DeletedTopic>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, created_at, deleted_at FROM deleted_topics ORDER BY deleted_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DeletedTopic {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            deleted_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// Restores a topic from the topic bin back into the active list.
///
/// Returns true when a row was actually restored.
pub fn recover_topic_from_bin(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM topics WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;

    if existing.is_some() {
        return Ok(false);
    }

    let row: Option<DeletedTopic> = conn
        .query_row(
            "SELECT id, name, created_at, deleted_at FROM deleted_topics WHERE id = ?1",
            params![id],
            |row| {
                Ok(DeletedTopic {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    deleted_at: row.get(3)?,
                })
            },
        )
        .optional()?;

    let row = match row {
        Some(row) => row,
        None => return Ok(false),
    };

    conn.execute(
        "INSERT INTO topics (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![row.id, row.name, row.created_at],
    )?;

    conn.execute(
        "DELETE FROM deleted_topics WHERE id = ?1",
        params![row.id],
    )?;

    Ok(true)
}

/// Permanently removes a topic from the topic bin. Cannot be undone.
///
/// Returns true when a bin entry was actually deleted.
pub fn delete_topic_from_bin(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM deleted_topics WHERE id = ?1",
        params![id],
    )?;

    Ok(affected > 0)
}

/// Deletes every topic-bin entry older than 30 days. Returns the number removed.
pub fn purge_expired_deleted_topics(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM deleted_topics
         WHERE deleted_at < datetime('now', '-30 days')",
        [],
    )
}

/// Stores a team's best result on a level.
///
/// The stored result is only replaced when the new run is genuinely better:
/// a higher score always wins, and an equal score only wins when it was
/// achieved faster. The question count and the time always travel with the
/// score they belong to, so the leaderboard can always show a consistent
/// "8/10 pts in 5:00".
pub fn set_team_result(
    conn: &Connection,
    name: &str,
    level: &str,
    score: i64,
    total_questions: i64,
    time_seconds: i64,
) -> rusqlite::Result<()> {
    let score = score.max(0);
    let total_questions = total_questions.max(0);
    let time_seconds = time_seconds.max(0);

    let current: Option<(i64, i64)> = conn
        .query_row(
            "SELECT score, time_seconds FROM teams WHERE name = ?1 AND level = ?2",
            params![name, level],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let should_replace = match current {
        None => true,
        Some((current_score, current_time)) => {
            score > current_score || (score == current_score && time_seconds < current_time)
        }
    };

    if should_replace {
        conn.execute(
            "UPDATE teams SET score = ?3, total_questions = ?4, time_seconds = ?5
             WHERE name = ?1 AND level = ?2",
            params![name, level, score, total_questions, time_seconds],
        )?;
    }

    Ok(())
}

/// Aggregate attempt totals.
pub fn get_stats(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(is_correct), 0) FROM attempts",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

/// Deletes every recorded attempt.
pub fn reset_attempts(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM attempts", [])
}

/// True when at least one user is registered. Used to decide between the
/// registration and sign-in screens on startup.
pub fn has_users(conn: &Connection) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;

    Ok(count > 0)
}

/// Inserts a user together with the password digest computed by the caller.
pub fn create_user(conn: &Connection, username: &str, password_hash: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?1, ?2, datetime('now'))",
        params![username, password_hash],
    )?;

    Ok(())
}

/// Compares a password digest against the stored one. Returns false when the
/// username is unknown or when the password does not match.
///
/// Note: this only makes sense when `password_hash` was produced with the
/// *same* salt as the stored digest (e.g. in tests, with plain placeholder
/// strings standing in for real hashes). Argon2 hashes embed a fresh random
/// salt per call, so comparing two independently-hashed digests for the same
/// password will never match. To verify a real login, fetch the stored hash
/// with `get_password_hash` and check it with `argon2::PasswordVerifier`
/// instead of hashing the candidate password yourself.

/// Returns the stored password digest for a username, if the user exists.
pub fn get_password_hash(conn: &Connection, username: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT password_hash FROM users WHERE username = ?1",
        params![username],
        |row| row.get("password_hash"),
    )
    .optional()
}

/// Returns the stored password digest of the first registered user.
///
/// The app registers a single admin account on first launch, so this is
/// what the "reveal answers" gate verifies against.
pub fn get_admin_password_hash(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT password_hash FROM users ORDER BY id ASC LIMIT 1",
        [],
        |row| row.get("password_hash"),
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Connection {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "quizbee_test_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let conn = Connection::open(&path).unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn mcq(id: i64) -> Question {
        Question {
            id,
            source: "imported".to_string(),
            qtype: "multiple-choice".to_string(),
            difficulty: "normal".to_string(),
            text: "Sample?".to_string(),
            options: Some(vec!["A".into(), "B".into()]),
            correct_answer: serde_json::json!(0),
            accepted_answers: vec![],
            explanation: "because".to_string(),
            topic_id: None,
        }
    }

    fn scramble(id: i64) -> Question {
        Question {
            id,
            source: "imported".to_string(),
            qtype: "scramble".to_string(),
            difficulty: "normal".to_string(),
            text: "Term?".to_string(),
            options: None,
            correct_answer: serde_json::json!("Phishing"),
            accepted_answers: vec!["phishing".into()],
            explanation: "".to_string(),
            topic_id: None,
        }
    }

    #[test]
    fn ships_without_a_builtin_bank() {
        let conn = temp_db();
        let all = list_all(&conn).unwrap();
        assert!(all.is_empty(), "a fresh database holds no questions");
    }

    #[test]
    fn removes_the_builtin_questions_of_older_builds() {
        let conn = temp_db();

        // A database created by an older build still holds the built-in bank.
        conn.execute(
            "INSERT INTO questions (id, source, type, text, options, correct_answer, accepted_answers, explanation)
             VALUES (29, 'builtin', 'scramble', 'old prompt', NULL, '\"Token\"', '[\"token\"]', '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO questions (id, source, type, text, options, correct_answer, accepted_answers, explanation)
             VALUES (41, 'imported', 'scramble', 'keep me', NULL, '\"Firewall\"', '[\"firewall\"]', '')",
            [],
        )
        .unwrap();

        init_schema(&conn).unwrap();

        let all = list_all(&conn).unwrap();

        // The built-in bank is gone...
        assert!(
            all.iter().all(|q| q.source != "builtin"),
            "the built-in questions are removed"
        );
        // ...while imported questions are preserved.
        assert!(all.iter().any(|q| q.source == "imported" && q.text == "keep me"));
    }

    #[test]
    fn round_trips_answer_types() {
        let conn = temp_db();
        insert_question(&conn, "imported", &mcq(0)).unwrap();
        insert_question(&conn, "imported", &scramble(0)).unwrap();
        let all = list_all(&conn).unwrap();

        let mc = all.iter().find(|q| q.qtype == "multiple-choice").unwrap();
        assert_eq!(mc.correct_answer, serde_json::json!(0));

        let id_q = all.iter().find(|q| q.qtype == "scramble").unwrap();
        assert!(id_q.correct_answer.is_string());
        assert!(id_q.options.is_none());
    }

    #[test]
    fn import_add_and_clear_keeps_only_imported() {
        let conn = temp_db();

        let inserted = insert_question(&conn, "imported", &mcq(0)).unwrap();
        assert!(inserted.id > 0);
        insert_question(&conn, "imported", &scramble(0)).unwrap();
        assert_eq!(list_all(&conn).unwrap().len(), 2);

        let removed = clear_imported(&conn).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(list_all(&conn).unwrap().len(), 0);
    }

    #[test]
    fn settings_upsert_and_defaults() {
        let conn = temp_db();
        assert!(get_setting(&conn, "timer_default").unwrap().is_none());

        set_setting(&conn, "timer_default", "30").unwrap();
        assert_eq!(get_setting(&conn, "timer_default").unwrap().unwrap(), "30");

        set_setting(&conn, "timer_default", "15").unwrap();
        assert_eq!(get_setting(&conn, "timer_default").unwrap().unwrap(), "15");
    }

    #[test]
    fn records_and_resets_attempts() {
        let conn = temp_db();
        record_attempt(&conn, 1, Some("0".into()), true).unwrap();
        record_attempt(&conn, 2, None, false).unwrap();

        let (total, correct) = get_stats(&conn).unwrap();
        assert_eq!(total, 2);
        assert_eq!(correct, 1);

        reset_attempts(&conn).unwrap();
        let (total, correct) = get_stats(&conn).unwrap();
        assert_eq!(total, 0);
        assert_eq!(correct, 0);
    }

    #[test]
    fn deserializes_frontend_payload_and_imports() {
        let conn = temp_db();

        // Shape sent by src/js/api.js: camelCase keys, null options for
        // scramble, numeric or string correctAnswer.
        let payload = r#"[
            {
                "type": "multiple-choice",
                "text": "Imported MCQ?",
                "options": ["A", "B", "C", "D"],
                "correctAnswer": 2,
                "acceptedAnswers": [],
                "explanation": "because"
            },
            {
                "type": "scramble",
                "text": "Imported ID?",
                "options": null,
                "correctAnswer": "Firewall",
                "acceptedAnswers": ["firewall"],
                "explanation": ""
            }
        ]"#;

        let questions: Vec<Question> = serde_json::from_str(payload).unwrap();
        assert_eq!(questions.len(), 2);
        assert_eq!(questions[0].correct_answer, serde_json::json!(2));
        assert_eq!(questions[1].correct_answer, serde_json::json!("Firewall"));
        assert!(questions[1].options.is_none());
        // A payload without a difficulty tag falls back to "normal".
        assert_eq!(questions[0].difficulty, "normal");

        for q in &questions {
            let inserted = insert_question(&conn, "imported", q).unwrap();
            assert_eq!(inserted.source, "imported");
        }

        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(
            all.iter().filter(|q| q.source == "imported").count(),
            2
        );
    }

    #[test]
    fn adds_and_retrieves_teams() {
        let conn = temp_db();

        let team = add_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(team.name, "Alpha");
        assert_eq!(team.level, "normal");
        assert_eq!(team.score, 0);
        assert!(team.id > 0);

        add_team(&conn, "Beta", "normal").unwrap();
        add_team(&conn, "Gamma", "expert").unwrap();

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 3);

        let names: Vec<&str> = teams.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"Alpha"));
        assert!(names.contains(&"Beta"));
        assert!(names.contains(&"Gamma"));
    }

    #[test]
    fn add_team_is_idempotent_for_duplicate_name() {
        let conn = temp_db();

        let first = add_team(&conn, "Alpha", "normal").unwrap();
        let second = add_team(&conn, "Alpha", "normal").unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(first.name, second.name);

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
    }

    #[test]
    fn keeps_teams_apart_per_level() {
        let conn = temp_db();

        let normal = add_team(&conn, "Alpha", "normal").unwrap();
        let expert = add_team(&conn, "Alpha", "expert").unwrap();

        // The same name may be used once per level.
        assert_ne!(normal.id, expert.id);
        assert_eq!(normal.level, "normal");
        assert_eq!(expert.level, "expert");

        set_team_result(&conn, "Alpha", "normal", 8, 10, 300).unwrap();
        set_team_result(&conn, "Alpha", "expert", 3, 10, 120).unwrap();

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 2);

        let normal_team = teams.iter().find(|t| t.level == "normal").unwrap();
        let expert_team = teams.iter().find(|t| t.level == "expert").unwrap();

        assert_eq!(normal_team.score, 8);
        assert_eq!(normal_team.time_seconds, 300);
        assert_eq!(expert_team.score, 3);
        assert_eq!(expert_team.time_seconds, 120);

        // Removing a team only touches its own level.
        assert_eq!(remove_team(&conn, "Alpha", "expert").unwrap(), 1);
        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].level, "normal");
    }

    #[test]
    fn set_team_result_keeps_the_best_result() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();

        set_team_result(&conn, "Alpha", "normal", 7, 10, 300).unwrap();
        let team = add_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(team.score, 7);
        assert_eq!(team.total_questions, 10);
        assert_eq!(team.time_seconds, 300);

        // A lower score must not overwrite the best.
        set_team_result(&conn, "Alpha", "normal", 4, 10, 100).unwrap();
        let team = add_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(team.score, 7);
        assert_eq!(team.time_seconds, 300);

        // The same score but slower is not an improvement either.
        set_team_result(&conn, "Alpha", "normal", 7, 10, 400).unwrap();
        let team = add_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(team.time_seconds, 300);

        // The same score in less time wins: the leaderboard uses it to
        // break a tie.
        set_team_result(&conn, "Alpha", "normal", 7, 10, 200).unwrap();
        let team = add_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(team.score, 7);
        assert_eq!(team.time_seconds, 200);

        // A higher score replaces it.
        set_team_result(&conn, "Alpha", "normal", 9, 10, 500).unwrap();
        let team = add_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(team.score, 9);
        assert_eq!(team.time_seconds, 500);
    }

    #[test]
    fn remove_team_deletes_the_row_and_score() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        add_team(&conn, "Beta", "normal").unwrap();
        set_team_result(&conn, "Alpha", "normal", 5, 10, 120).unwrap();

        let removed = remove_team(&conn, "Alpha", "normal").unwrap();
        assert_eq!(removed, 1);

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].name, "Beta");

        assert_eq!(remove_team(&conn, "Alpha", "normal").unwrap(), 0);
    }

    #[test]
    fn migrates_legacy_teams_without_score_column() {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "quizbee_legacy_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let conn = Connection::open(&path).unwrap();

        // Simulate an old database missing the score column.
        conn.execute_batch(
            "CREATE TABLE teams (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            INSERT INTO teams (name, created_at) VALUES ('Alpha', '2024-01-01T00:00:00Z');",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].name, "Alpha");
        assert_eq!(teams[0].score, 0);
        assert_eq!(teams[0].total_questions, 0);
        assert_eq!(teams[0].time_seconds, 0);
        // The old rows move to the normal level.
        assert_eq!(teams[0].level, "normal");

        set_team_result(&conn, "Alpha", "normal", 3, 10, 60).unwrap();
        let team = &get_teams(&conn).unwrap()[0];
        assert_eq!(team.score, 3);
        assert_eq!(team.total_questions, 10);
        assert_eq!(team.time_seconds, 60);
    }

    #[test]
    fn migrates_legacy_teams_with_a_unique_name() {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "quizbee_legacy_unique_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let conn = Connection::open(&path).unwrap();

        // Simulate the previous release: the score columns are there, but
        // the name is unique on its own and there is no level yet.
        conn.execute_batch(
            "CREATE TABLE teams (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL UNIQUE,
                score           INTEGER NOT NULL DEFAULT 0,
                total_questions INTEGER NOT NULL DEFAULT 0,
                time_seconds    INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL
            );
            INSERT INTO teams (name, score, total_questions, time_seconds, created_at)
            VALUES ('Alpha', 8, 10, 300, '2024-01-01T00:00:00Z');",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].name, "Alpha");
        assert_eq!(teams[0].level, "normal");
        assert_eq!(teams[0].score, 8);
        assert_eq!(teams[0].total_questions, 10);
        assert_eq!(teams[0].time_seconds, 300);

        // The same name may now be used on another level.
        let expert = add_team(&conn, "Alpha", "expert").unwrap();
        assert_eq!(expert.level, "expert");
        assert_eq!(expert.score, 0);
        assert_eq!(get_teams(&conn).unwrap().len(), 2);
    }

    #[test]
    fn migrates_legacy_questions_without_difficulty_column() {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "quizbee_legacy_questions_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        path.push(unique);
        let conn = Connection::open(&path).unwrap();

        // Simulate an old database without the difficulty column.
        conn.execute_batch(
            "CREATE TABLE questions (
                id               INTEGER PRIMARY KEY,
                source           TEXT NOT NULL DEFAULT 'builtin',
                type             TEXT NOT NULL,
                text             TEXT NOT NULL,
                options          TEXT,
                correct_answer   TEXT NOT NULL,
                accepted_answers TEXT NOT NULL DEFAULT '[]',
                explanation      TEXT NOT NULL DEFAULT ''
            );
            INSERT INTO questions (id, source, type, text, options, correct_answer, accepted_answers, explanation)
            VALUES (1, 'imported', 'multiple-choice', 'Old?', '[\"A\",\"B\"]', '0', '[]', '');",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].difficulty, "normal");
    }

    #[test]
    fn admin_password_hash_is_the_first_registered_user() {
        let conn = temp_db();

        assert!(get_admin_password_hash(&conn).unwrap().is_none());

        create_user(&conn, "admin", "admin-hash").unwrap();
        create_user(&conn, "teacher", "teacher-hash").unwrap();

        assert_eq!(
            get_admin_password_hash(&conn).unwrap().as_deref(),
            Some("admin-hash")
        );
    }

    #[test]
    fn has_users_reflects_registration() {
        let conn = temp_db();

        assert!(!has_users(&conn).unwrap());

        create_user(&conn, "admin", "admin-hash").unwrap();
        assert!(has_users(&conn).unwrap());

        create_user(&conn, "teacher", "teacher-hash").unwrap();
        assert!(has_users(&conn).unwrap());
    }

    #[test]
    fn create_user_rejects_a_taken_username() {
        let conn = temp_db();
        create_user(&conn, "admin", "admin-hash").unwrap();

        let error = create_user(&conn, "admin", "other-hash").unwrap_err();
        assert!(error.to_string().contains("UNIQUE"));
    }

    /* ===================== Recycle bin ===================== */

    #[test]
    fn moves_a_team_into_the_bin_and_keeps_its_score() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        set_team_result(&conn, "Alpha", "normal", 8, 10, 300).unwrap();

        let moved = move_team_to_bin(&conn, "Alpha", "normal").unwrap();
        assert!(moved, "a present team is moved into the bin");

        // The active list is empty again.
        assert!(get_teams(&conn).unwrap().is_empty(), "the team left the active list");

        // The bin holds the deleted team with its score and answering time.
        let bin = list_deleted_teams(&conn).unwrap();
        assert_eq!(bin.len(), 1);
        assert_eq!(bin[0].name, "Alpha");
        assert_eq!(bin[0].level, "normal");
        assert_eq!(bin[0].score, 8);
        assert_eq!(bin[0].total_questions, 10);
        assert_eq!(bin[0].time_seconds, 300);
        assert!(!bin[0].deleted_at.is_empty(), "the bin records when it was deleted");
    }

    #[test]
    fn moving_a_missing_team_is_a_noop() {
        let conn = temp_db();
        assert!(!move_team_to_bin(&conn, "Ghost", "normal").unwrap(), "a missing team is not moved");
        assert!(list_deleted_teams(&conn).unwrap().is_empty(), "the bin stays empty");
    }

    #[test]
    fn recover_team_from_bin_restores_the_score() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        set_team_result(&conn, "Alpha", "normal", 8, 10, 300).unwrap();
        move_team_to_bin(&conn, "Alpha", "normal").unwrap();

        let restored = recover_team_from_bin(&conn, "Alpha", "normal").unwrap();
        assert!(restored, "the team is restored from the bin");

        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].name, "Alpha");
        assert_eq!(teams[0].score, 8);
        assert_eq!(teams[0].total_questions, 10);
        assert_eq!(teams[0].time_seconds, 300);

        // The bin entry is gone.
        assert!(list_deleted_teams(&conn).unwrap().is_empty(), "the bin entry is removed on restore");
    }

    #[test]
    fn recover_skips_when_the_team_already_exists_on_the_level() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        set_team_result(&conn, "Alpha", "normal", 8, 10, 300).unwrap();
        move_team_to_bin(&conn, "Alpha", "normal").unwrap();

        // Re-add the team while the bin entry still exists.
        add_team(&conn, "Alpha", "normal").unwrap();

        let restored = recover_team_from_bin(&conn, "Alpha", "normal").unwrap();
        assert!(!restored, "an existing team is not overwritten");

        // The live row wins and the stale bin entry is left alone.
        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].score, 0, "the live zero-score row is untouched");
        assert_eq!(list_deleted_teams(&conn).unwrap().len(), 1, "the bin entry is left in place");
    }

    #[test]
    fn recover_is_idempotent_and_only_restores_once() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        move_team_to_bin(&conn, "Alpha", "normal").unwrap();

        assert!(recover_team_from_bin(&conn, "Alpha", "normal").unwrap());
        // A second call finds no bin entry, so it is a no-op.
        assert!(!recover_team_from_bin(&conn, "Alpha", "normal").unwrap());

        assert_eq!(get_teams(&conn).unwrap().len(), 1);
        assert!(list_deleted_teams(&conn).unwrap().is_empty());
    }

    #[test]
    fn purge_expired_deleted_teams_drops_old_rows_only() {
        let conn = temp_db();
        add_team(&conn, "Fresh", "normal").unwrap();
        add_team(&conn, "Stale", "normal").unwrap();
        move_team_to_bin(&conn, "Fresh", "normal").unwrap();
        move_team_to_bin(&conn, "Stale", "normal").unwrap();

        // Age the stale entry past the 30-day window.
        conn.execute(
            "UPDATE deleted_teams SET deleted_at = datetime('now', '-31 days')
             WHERE name = 'Stale'",
            [],
        )
        .unwrap();

        let removed = purge_expired_deleted_teams(&conn).unwrap();
        assert_eq!(removed, 1, "only the stale entry is purged");

        let names: Vec<String> = list_deleted_teams(&conn)
            .unwrap()
            .into_iter()
            .map(|row| row.name)
            .collect();
        assert_eq!(names, vec!["Fresh".to_string()]);
    }

    #[test]
    fn move_team_to_bin_stores_purge_compatible_timestamp() {
        // Regression: `move_team_to_bin` used to store `deleted_at` as an
        // RFC-3339 string ("2024-01-01T00:00:00.000000000Z") while
        // `purge_expired_deleted_teams` compared it against SQLite's
        // `datetime('now', '-30 days')` ("2024-01-01 00:00:00"). The formats
        // never matched, so the recycle bin never emptied. This test asserts
        // the stored timestamp is in the SQLite format the purge expects.
        let conn = temp_db();
        add_team(&conn, "Test", "normal").unwrap();
        move_team_to_bin(&conn, "Test", "normal").unwrap();

        let deleted_at: String = conn
            .query_row(
                "SELECT deleted_at FROM deleted_teams WHERE name = 'Test'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert!(
            deleted_at.contains(' '),
            "deleted_at must be in SQLite datetime format, got: {}",
            deleted_at
        );
        assert!(
            !deleted_at.contains('T'),
            "deleted_at must not be RFC-3339 format, got: {}",
            deleted_at
        );

        // Age the entry using the same format and confirm the purge removes it.
        conn.execute(
            "UPDATE deleted_teams SET deleted_at = datetime('now', '-31 days')
             WHERE name = 'Test'",
            [],
        )
        .unwrap();

        let removed = purge_expired_deleted_teams(&conn).unwrap();
        assert_eq!(removed, 1, "the aged entry is purged");
        assert!(list_deleted_teams(&conn).unwrap().is_empty());
    }

    #[test]
    fn bin_keeps_teams_apart_per_level() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        add_team(&conn, "Alpha", "expert").unwrap();
        set_team_result(&conn, "Alpha", "normal", 5, 10, 120).unwrap();
        set_team_result(&conn, "Alpha", "expert", 9, 10, 60).unwrap();

        move_team_to_bin(&conn, "Alpha", "expert").unwrap();

        // Only the expert copy is gone; the normal one stays.
        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 1);
        assert_eq!(teams[0].level, "normal");
        assert_eq!(teams[0].score, 5);

        let bin = list_deleted_teams(&conn).unwrap();
        assert_eq!(bin.len(), 1);
        assert_eq!(bin[0].level, "expert");
        assert_eq!(bin[0].score, 9);

        // Recovering the expert copy must not collide with the normal one.
        assert!(recover_team_from_bin(&conn, "Alpha", "expert").unwrap());
        let teams = get_teams(&conn).unwrap();
        assert_eq!(teams.len(), 2);
    }

    #[test]
    fn delete_team_from_bin_removes_the_entry_permanently() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        set_team_result(&conn, "Alpha", "normal", 8, 10, 300).unwrap();
        move_team_to_bin(&conn, "Alpha", "normal").unwrap();

        assert_eq!(list_deleted_teams(&conn).unwrap().len(), 1);

        let deleted = delete_team_from_bin(&conn, "Alpha", "normal").unwrap();
        assert!(deleted, "a present bin entry is deleted");

        assert!(list_deleted_teams(&conn).unwrap().is_empty(), "the bin entry is gone");
        assert!(get_teams(&conn).unwrap().is_empty(), "the active list is still empty");

        // A second call finds nothing to delete.
        assert!(!delete_team_from_bin(&conn, "Alpha", "normal").unwrap());
    }

    #[test]
    fn delete_team_from_bin_only_touches_the_named_level() {
        let conn = temp_db();
        add_team(&conn, "Alpha", "normal").unwrap();
        add_team(&conn, "Alpha", "expert").unwrap();
        move_team_to_bin(&conn, "Alpha", "normal").unwrap();
        move_team_to_bin(&conn, "Alpha", "expert").unwrap();

        delete_team_from_bin(&conn, "Alpha", "expert").unwrap();

        let names: Vec<String> = list_deleted_teams(&conn)
            .unwrap()
            .into_iter()
            .map(|row| format!("{}:{}", row.name, row.level))
            .collect();
        assert_eq!(names, vec!["Alpha:normal".to_string()]);
    }

    /* ===================== Topics ===================== */

    #[test]
    fn lists_topics_ordered_by_name() {
        let conn = temp_db();
        add_topic(&conn, "Zebra").unwrap();
        add_topic(&conn, "Alpha").unwrap();
        add_topic(&conn, "Meadow").unwrap();

        let topics = list_topics(&conn).unwrap();
        assert_eq!(topics.len(), 3);
        assert_eq!(topics[0].name, "Alpha");
        assert_eq!(topics[1].name, "Meadow");
        assert_eq!(topics[2].name, "Zebra");
    }

    #[test]
    fn get_topics_with_counts_reports_question_counts() {
        let conn = temp_db();
        let history = add_topic(&conn, "History").unwrap();
        let coding = add_topic(&conn, "Coding").unwrap();

        // Insert questions into each topic.
        insert_question(
            &conn,
            "imported",
            &Question {
                id: 0,
                source: "imported".into(),
                qtype: "multiple-choice".into(),
                difficulty: "normal".into(),
                text: "H1?".into(),
                options: Some(vec!["A".into(), "B".into()]),
                correct_answer: serde_json::json!(0),
                accepted_answers: vec![],
                explanation: "".into(),
                topic_id: Some(history.id),
            },
        )
        .unwrap();
        insert_question(
            &conn,
            "imported",
            &Question {
                id: 0,
                source: "imported".into(),
                qtype: "scramble".into(),
                difficulty: "hard".into(),
                text: "H2?".into(),
                options: None,
                correct_answer: serde_json::json!("Answer"),
                accepted_answers: vec!["answer".into()],
                explanation: "".into(),
                topic_id: Some(history.id),
            },
        )
        .unwrap();
        insert_question(
            &conn,
            "imported",
            &Question {
                id: 0,
                source: "imported".into(),
                qtype: "multiple-choice".into(),
                difficulty: "easy".into(),
                text: "C1?".into(),
                options: Some(vec!["A".into(), "B".into()]),
                correct_answer: serde_json::json!(0),
                accepted_answers: vec![],
                explanation: "".into(),
                topic_id: Some(coding.id),
            },
        )
        .unwrap();

        let counts = get_topics_with_counts(&conn).unwrap();
        assert_eq!(counts.len(), 2);

        let history_entry = counts.iter().find(|(t, _)| t.name == "History").unwrap();
        assert_eq!(history_entry.1, 2);

        let coding_entry = counts.iter().find(|(t, _)| t.name == "Coding").unwrap();
        assert_eq!(coding_entry.1, 1);
    }

    #[test]
    fn update_topic_renames() {
        let conn = temp_db();
        let topic = add_topic(&conn, "Old Name").unwrap();

        let updated = update_topic(&conn, topic.id, "New Name").unwrap();
        assert!(updated);

        let topics = list_topics(&conn).unwrap();
        assert_eq!(topics.len(), 1);
        assert_eq!(topics[0].name, "New Name");
    }

    #[test]
    fn delete_topic_moves_to_bin_and_nullifies_topic_id() {
        let conn = temp_db();
        let topic = add_topic(&conn, "To Delete").unwrap();

        insert_question(
            &conn,
            "imported",
            &Question {
                id: 0,
                source: "imported".into(),
                qtype: "multiple-choice".into(),
                difficulty: "normal".into(),
                text: "Q1?".into(),
                options: Some(vec!["A".into(), "B".into()]),
                correct_answer: serde_json::json!(0),
                accepted_answers: vec![],
                explanation: "".into(),
                topic_id: Some(topic.id),
            },
        )
        .unwrap();

        let deleted = delete_topic(&conn, topic.id).unwrap();
        assert!(deleted);

        // The topic is gone from the active list.
        assert!(list_topics(&conn).unwrap().is_empty());

        // The topic is in the bin.
        let bin = list_deleted_topics(&conn).unwrap();
        assert_eq!(bin.len(), 1);
        assert_eq!(bin[0].name, "To Delete");
        assert!(bin[0].deleted_at.contains(' '));

        // The question's topic_id is nullified (question stays uncategorized).
        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].topic_id, None);
    }

    #[test]
    fn delete_nonexistent_topic_is_noop() {
        let conn = temp_db();
        let deleted = delete_topic(&conn, 999).unwrap();
        assert!(!deleted);
    }

    #[test]
    fn recover_topic_from_bin_restores() {
        let conn = temp_db();
        let topic = add_topic(&conn, "Recover Me").unwrap();
        delete_topic(&conn, topic.id).unwrap();

        let restored = recover_topic_from_bin(&conn, topic.id).unwrap();
        assert!(restored);

        let topics = list_topics(&conn).unwrap();
        assert_eq!(topics.len(), 1);
        assert_eq!(topics[0].name, "Recover Me");
        assert!(list_deleted_topics(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_topic_from_bin_removes_permanently() {
        let conn = temp_db();
        let topic = add_topic(&conn, "Permanent").unwrap();
        delete_topic(&conn, topic.id).unwrap();

        let deleted = delete_topic_from_bin(&conn, topic.id).unwrap();
        assert!(deleted);
        assert!(list_deleted_topics(&conn).unwrap().is_empty());

        // A second call finds nothing.
        assert!(!delete_topic_from_bin(&conn, topic.id).unwrap());
    }

    #[test]
    fn purge_expired_deleted_topics_drops_old_rows_only() {
        let conn = temp_db();
        add_topic(&conn, "Fresh").unwrap();
        add_topic(&conn, "Stale").unwrap();
        let fresh = list_topics(&conn).unwrap()[0].id;
        let stale = list_topics(&conn).unwrap()[1].id;
        delete_topic(&conn, fresh).unwrap();
        delete_topic(&conn, stale).unwrap();

        // Age the stale entry past the 30-day window.
        conn.execute(
            "UPDATE deleted_topics SET deleted_at = datetime('now', '-31 days')
             WHERE name = 'Stale'",
            [],
        )
        .unwrap();

        let removed = purge_expired_deleted_topics(&conn).unwrap();
        assert_eq!(removed, 1, "only the stale entry is purged");

        let names: Vec<String> = list_deleted_topics(&conn)
            .unwrap()
            .into_iter()
            .map(|row| row.name)
            .collect();
        assert_eq!(names, vec!["Fresh".to_string()]);
    }
}
