use crate::db;
use crate::models::{DeletedTeam, Question, Settings, Stats, Team};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{PasswordHash, SaltString};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub conn: Mutex<Connection>,
}

/// Hashes a plain-text password with Argon2id so the database only ever
/// stores a digest.
fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    let hashed = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|error| format!("could not hash password: {error}"))?;

    Ok(hashed.to_string())
}

/// Returns every question in the bank.
#[tauri::command]
pub fn get_questions(state: State<'_, AppState>) -> Result<Vec<Question>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::list_all(&conn).map_err(|e| e.to_string())
}

/// Inserts imported questions and returns them with assigned ids.
#[tauri::command]
pub fn add_questions(
    state: State<'_, AppState>,
    questions: Vec<Question>,
) -> Result<Vec<Question>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let valid_qtypes = ["multiple-choice", "scramble", "imported"];
    let mut inserted = Vec::with_capacity(questions.len());
    for q in &questions {
        if !valid_qtypes.contains(&q.qtype.as_str()) {
            return Err(format!("Invalid question type: {}", q.qtype));
        }
        inserted.push(db::insert_question(&tx, &q.source, q).map_err(|e| e.to_string())?);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

/// Removes all user-imported questions.
#[tauri::command]
pub fn clear_imported(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::clear_imported(&conn).map_err(|e| e.to_string())
}

/// Records one quiz attempt.
#[tauri::command]
pub fn record_attempt(
    state: State<'_, AppState>,
    question_id: i64,
    given: Option<String>,
    is_correct: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::record_attempt(&conn, question_id, given, is_correct).map_err(|e| e.to_string())
}

/// Returns aggregate attempt statistics.
#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> Result<Stats, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (total, correct) = db::get_stats(&conn).map_err(|e| e.to_string())?;
    Ok(Stats { total, correct })
}

/// Clears all recorded attempts.
#[tauri::command]
pub fn reset_attempts(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::reset_attempts(&conn).map_err(|e| e.to_string())
}

/// Reads persisted app settings, applying defaults for missing keys.
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let defaults = Settings::default();

    let timer_default = db::get_setting(&conn, "timer_default")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(defaults.timer_default);

    let question_count_default = db::get_setting(&conn, "question_count_default")
        .map_err(|e| e.to_string())?
        .unwrap_or(defaults.question_count_default);

    let shuffle_choices_default = db::get_setting(&conn, "shuffle_choices_default")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(defaults.shuffle_choices_default);

    let level_default = db::get_setting(&conn, "level_default")
        .map_err(|e| e.to_string())?
        .unwrap_or(defaults.level_default);

    let level_counts = db::get_setting(&conn, "level_counts")
        .map_err(|e| e.to_string())?
        .unwrap_or(defaults.level_counts);

    let sound_default = db::get_setting(&conn, "sound_default")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(defaults.sound_default);

    let bgm_default = db::get_setting(&conn, "bgm_default")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(defaults.bgm_default);

    let bgm_volume_default = db::get_setting(&conn, "bgm_volume_default")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse::<i64>().ok())
        .map(|v| v.clamp(0, 100))
        .unwrap_or(defaults.bgm_volume_default);

    Ok(Settings {
        timer_default,
        question_count_default,
        shuffle_choices_default,
        level_default,
        level_counts,
        sound_default,
        bgm_default,
        bgm_volume_default,
    })
}

/// Persists a single setting key/value pair.
#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

/// True when at least one user is registered. Used to decide whether the app
/// should show the registration or sign-in screen on startup.
#[tauri::command]
pub fn has_users(state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    db::has_users(&conn).map_err(|e| e.to_string())
}

/// Registers the first user account.
#[tauri::command]
pub fn register(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let password_hash = hash_password(&password).map_err(|e| e.to_string())?;

    db::create_user(&conn, &username, &password_hash).map_err(|e| e.to_string())?;
    Ok(())
}

/// Signs a user in. Fails when the username or the password is wrong.
#[tauri::command]
pub fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let stored_hash = db::get_password_hash(&conn, &username).map_err(|e| e.to_string())?;

    // Keep the error identical whether the username is unknown or the
    // password is wrong, so a failed login can't be used to probe for valid
    // usernames.
    let invalid = || "Invalid username or password.".to_string();

    let stored_hash = stored_hash.ok_or_else(invalid)?;
    let parsed_hash = PasswordHash::new(&stored_hash).map_err(|_| invalid())?;

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| invalid())?;

    Ok(())
}

/// Inserts a team into the database, or returns the existing one if the name is taken.
#[tauri::command]
pub fn add_team(state: State<'_, AppState>, name: String, level: String) -> Result<Team, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::add_team(&conn, &name, &level).map_err(|e| e.to_string())
}

/// Returns all saved teams ordered by level and then by name.
#[tauri::command]
pub fn get_teams(state: State<'_, AppState>) -> Result<Vec<Team>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::get_teams(&conn).map_err(|e| e.to_string())
}

/// Deletes a team (and its score) from a level.
#[tauri::command]
pub fn remove_team(state: State<'_, AppState>, name: String, level: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::remove_team(&conn, &name, &level).map_err(|e| e.to_string())?;
    Ok(())
}

/// Moves a team from a level into the recycle bin, keeping its score and the
/// moment it was deleted so the host can recover it later.
#[tauri::command]
pub fn move_team_to_bin(state: State<'_, AppState>, name: String, level: String) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::move_team_to_bin(&conn, &name, &level).map_err(|e| e.to_string())
}

/// Returns every team currently held in the recycle bin, newest first.
#[tauri::command]
pub fn list_deleted_teams(state: State<'_, AppState>) -> Result<Vec<DeletedTeam>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::list_deleted_teams(&conn).map_err(|e| e.to_string())
}

/// Restores a team from the recycle bin back into the active list, carrying
/// the score it had when it was deleted. Skipped when the team already exists
/// on that level.
#[tauri::command]
pub fn recover_team_from_bin(state: State<'_, AppState>, name: String, level: String) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::recover_team_from_bin(&conn, &name, &level).map_err(|e| e.to_string())
}

/// Purges every bin entry older than 30 days. Returns the number removed.
#[tauri::command]
pub fn purge_expired_deleted_teams(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::purge_expired_deleted_teams(&conn).map_err(|e| e.to_string())
}

/// Permanently removes a team from the recycle bin. Returns true when a bin
/// entry was actually deleted.
#[tauri::command]
pub fn delete_team_from_bin(state: State<'_, AppState>, name: String, level: String) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::delete_team_from_bin(&conn, &name, &level).map_err(|e| e.to_string())
}

/// Stores a team's best result on a level (score, questions answered,
/// answering time). The stored result is only replaced when it is genuinely
/// better: a higher score always wins and an equal score only wins when it
/// was faster.
#[tauri::command]
pub fn set_team_result(
    state: State<'_, AppState>,
    name: String,
    level: String,
    score: i64,
    total_questions: i64,
    time_seconds: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::set_team_result(&conn, &name, &level, score, total_questions, time_seconds)
        .map_err(|e| e.to_string())
}

/// Verifies the admin account password.
///
/// Used by the answer review to unlock the correct answers: the same
/// Argon2 digest that guards sign-in is checked here, so no second
/// password has to be stored anywhere.
#[tauri::command]
pub fn verify_admin_password(state: State<'_, AppState>, password: String) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let stored_hash = db::get_admin_password_hash(&conn).map_err(|e| e.to_string())?;

    // No account registered yet: nothing can be verified.
    let stored_hash = match stored_hash {
        Some(hash) => hash,
        None => return Ok(false),
    };

    let parsed_hash = match PasswordHash::new(&stored_hash) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(false),
    };

    let matches = Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok();

    Ok(matches)
}

/// Resolves the user's Downloads folder, creating it if necessary.
fn default_download_dir() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "Could not determine the home directory.".to_string())?;

    let dir = std::path::PathBuf::from(home).join("Downloads");

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    Ok(dir)
}

/// Rejects file names that contain path separators or `..` components,
/// preventing directory traversal outside the intended directory.
fn sanitize_file_name(name: &str) -> Result<String, String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') || name.is_empty() {
        return Err("Invalid file name.".to_string());
    }
    Ok(name.to_string())
}

/// Validates that a path does not contain `..` components, preventing
/// directory traversal outside the intended directory.
fn validate_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    for component in p.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("Path traversal is not allowed.".to_string());
        }
    }
    Ok(())
}

/// Saves the import template to the default Downloads folder.
#[tauri::command]
pub fn save_template_to_downloads(contents: String, file_name: Option<String>) -> Result<String, String> {
    let name = sanitize_file_name(&file_name.unwrap_or_else(|| "quiz-questions-template.csv".to_string()))?;
    let path = default_download_dir()?.join(name);

    std::fs::write(&path, contents).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

/// Saves the import template to an explicit path chosen by the user.
#[tauri::command]
pub fn save_template_file(path: String, contents: String) -> Result<(), String> {
    validate_path(&path)?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Opens a file with the operating system's default application.
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    validate_path(&path)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
