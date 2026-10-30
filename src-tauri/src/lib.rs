mod commands;
mod db;
mod models;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let db_path = data_dir.join("quizbee.db");
            let conn = db::open(&db_path).expect("failed to initialize database");
            // The recycle bin holds deleted teams for 30 days; purge anything
            // that has outlived its grace period on every startup.
            if let Err(error) = db::purge_expired_deleted_teams(&conn) {
                eprintln!("could not purge expired deleted teams: {error}");
            }
            app.manage(AppState {
                conn: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_questions,
            commands::add_questions,
            commands::clear_imported,
            commands::record_attempt,
            commands::get_stats,
            commands::reset_attempts,
            commands::get_settings,
            commands::set_setting,
            commands::has_users,
            commands::register,
            commands::login,
            commands::add_team,
            commands::get_teams,
            commands::remove_team,
            commands::move_team_to_bin,
            commands::list_deleted_teams,
            commands::recover_team_from_bin,
            commands::purge_expired_deleted_teams,
            commands::delete_team_from_bin,
            commands::get_topics,
            commands::get_topics_with_counts,
            commands::add_topic,
            commands::update_topic,
            commands::delete_topic,
            commands::list_deleted_topics,
            commands::recover_topic_from_bin,
            commands::purge_expired_deleted_topics,
            commands::delete_topic_from_bin,
            commands::set_team_result,
            commands::verify_admin_password,
            commands::save_template_to_downloads,
            commands::save_template_file,
            commands::open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
