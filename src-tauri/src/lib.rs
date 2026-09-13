//! Tauri shell for HandToHand X. Every IPC command is a thin wrapper over
//! `htoh_core`; the shell owns the database handle, the signed-in session and
//! the close-time backup snapshot.

mod commands;

use htoh_core::Database;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Option<Database>>,
    pub session: Mutex<Option<commands::Session>>,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
}

impl AppState {
    pub fn backup_dir(&self) -> PathBuf {
        let configured = self.db.lock().ok().and_then(|g| {
            g.as_ref()
                .and_then(|db| db.get_setting("backup_dir").ok().flatten())
        });
        match configured {
            Some(p) if !p.trim().is_empty() => PathBuf::from(p),
            _ => self.data_dir.join("Automatic Backup"),
        }
    }
}

fn automatic_backup(state: &AppState, label: &str) {
    let dir = state.backup_dir();
    if let Ok(guard) = state.db.lock() {
        if let Some(db) = guard.as_ref() {
            match htoh_core::backup::snapshot(db, &dir, label) {
                Ok(info) => {
                    let _ = db.set_setting("last_auto_backup", &info.path);
                    let keep = db
                        .get_setting("backup_keep")
                        .ok()
                        .flatten()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(30usize);
                    let _ = htoh_core::backup::prune(&dir, keep);
                }
                Err(e) => eprintln!("automatic backup failed: {e}"),
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = match std::env::var("HTOH_DATA_DIR") {
                Ok(dir) if !dir.is_empty() => PathBuf::from(dir),
                _ => app.path().app_data_dir().expect("app data dir"),
            };
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("HandToHand.db");
            let db = Database::open(&db_path)?;
            app.manage(AppState {
                db: Mutex::new(Some(db)),
                session: Mutex::new(None),
                data_dir,
                db_path,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<AppState>();
                automatic_backup(&state, "close");
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::login,
            commands::logout,
            commands::current_session,
            commands::list_users,
            commands::create_user,
            commands::set_pin,
            commands::set_user_active,
            commands::list_offices,
            commands::save_office,
            commands::list_holidays,
            commands::set_holiday,
            commands::open_handover,
            commands::list_handovers,
            commands::update_handover_notes,
            commands::submit_handover,
            commands::verify_handover,
            commands::list_vouchers_for_day,
            commands::add_voucher,
            commands::update_voucher,
            commands::delete_voucher,
            commands::verify_voucher,
            commands::get_denominations,
            commands::save_denominations,
            commands::tally_compare,
            commands::get_daily_closing,
            commands::recalculate_day,
            commands::set_system_book_balance,
            commands::close_day,
            commands::reopen_day,
            commands::list_daily_closings,
            commands::list_violations,
            commands::dashboard_summary,
            commands::compile_smr_batch,
            commands::compile_smr_office,
            commands::list_smr_entries,
            commands::save_smr_entry,
            commands::sign_off_smr,
            commands::list_stamp_stock,
            commands::save_stamp_stock,
            commands::list_audit_logs,
            commands::backup_now,
            commands::list_backups,
            commands::restore_backup,
            commands::get_setting,
            commands::set_setting,
            commands::list_printers,
            commands::print_raw,
            commands::write_file,
            commands::classify_barcode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HandToHand X");
}
