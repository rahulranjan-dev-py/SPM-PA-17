use crate::AppState;
use htoh_core::backup::BackupInfo;
use htoh_core::models::*;
use htoh_core::printing::PrintTarget;
use htoh_core::smr::{SmrBatchSummary, SmrReport};
use htoh_core::tally::{DenominationLine, PhysicalCash, TallyResult};
use htoh_core::{CoreError, Database, ErrorPayload, Money};
use serde::{Deserialize, Serialize};
use std::sync::MutexGuard;
use tauri::State;

type CmdResult<T> = Result<T, ErrorPayload>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub user: User,
    pub actor: Actor,
    pub must_change_pin: bool,
    pub signed_in_at: String,
}

fn with_db<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Database) -> Result<T, CoreError>,
) -> CmdResult<T> {
    let guard: MutexGuard<Option<Database>> = state.db.lock().map_err(|_| ErrorPayload {
        code: "other",
        message: "database lock poisoned".into(),
    })?;
    let db = guard.as_ref().ok_or(ErrorPayload {
        code: "other",
        message: "database is not open".into(),
    })?;
    f(db).map_err(Into::into)
}

fn actor(state: &State<'_, AppState>) -> CmdResult<Actor> {
    let guard = state.session.lock().map_err(|_| ErrorPayload {
        code: "other",
        message: "session lock poisoned".into(),
    })?;
    guard.as_ref().map(|s| s.actor.clone()).ok_or(ErrorPayload {
        code: "forbidden",
        message: "sign in first".into(),
    })
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub backup_dir: String,
    pub journal_mode: String,
    pub platform: String,
    pub last_auto_backup: Option<String>,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> CmdResult<AppInfo> {
    let backup_dir = state.backup_dir().to_string_lossy().to_string();
    with_db(&state, |db| {
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            data_dir: state.data_dir.to_string_lossy().to_string(),
            db_path: state.db_path.to_string_lossy().to_string(),
            backup_dir,
            journal_mode: db.journal_mode()?,
            platform: std::env::consts::OS.to_string(),
            last_auto_backup: db.get_setting("last_auto_backup")?,
        })
    })
}

// ------------------------------------------------------------------ auth
#[tauri::command]
pub fn login(state: State<'_, AppState>, username: String, pin: String) -> CmdResult<Session> {
    let (user, actor, must_change) = with_db(&state, |db| {
        let (user, actor) = db.authenticate(&username, &pin)?;
        let must_change = user
            .username
            .eq_ignore_ascii_case(htoh_core::db::DEFAULT_SUPERVISOR)
            && db.get_setting("must_change_default_pin")?.as_deref() == Some("1");
        Ok((user, actor, must_change))
    })?;
    let session = Session {
        user,
        actor,
        must_change_pin: must_change,
        signed_in_at: htoh_core::db::now_ts(),
    };
    *state.session.lock().map_err(|_| ErrorPayload {
        code: "other",
        message: "session lock poisoned".into(),
    })? = Some(session.clone());
    Ok(session)
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> CmdResult<()> {
    if let Ok(a) = actor(&state) {
        let _ = with_db(&state, |db| {
            let tx = db.connection().unchecked_transaction()?;
            tx.execute(
                "INSERT INTO audit_logs(user_id,username,role,action,entity_type,entity_id) VALUES (?,?,?,'logout','user',?)",
                rusqlite_params(&a),
            )?;
            tx.commit()?;
            Ok(())
        });
    }
    *state.session.lock().map_err(|_| ErrorPayload {
        code: "other",
        message: "session lock poisoned".into(),
    })? = None;
    Ok(())
}

fn rusqlite_params(a: &Actor) -> [String; 4] {
    [
        a.user_id.clone().unwrap_or_default(),
        a.username.clone(),
        a.role.as_str().to_string(),
        a.user_id.clone().unwrap_or_default(),
    ]
}

#[tauri::command]
pub fn current_session(state: State<'_, AppState>) -> CmdResult<Option<Session>> {
    Ok(state
        .session
        .lock()
        .map_err(|_| ErrorPayload {
            code: "other",
            message: "session lock poisoned".into(),
        })?
        .clone())
}

#[tauri::command]
pub fn list_users(state: State<'_, AppState>) -> CmdResult<Vec<User>> {
    with_db(&state, |db| db.list_users())
}

#[tauri::command]
pub fn create_user(
    state: State<'_, AppState>,
    username: String,
    display_name: String,
    role: Role,
    office_id: Option<String>,
    pin: String,
) -> CmdResult<User> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.create_user(
            &a,
            &username,
            &display_name,
            role,
            office_id.as_deref(),
            &pin,
        )
    })
}

#[tauri::command]
pub fn set_pin(state: State<'_, AppState>, user_id: String, new_pin: String) -> CmdResult<()> {
    let a = actor(&state)?;
    with_db(&state, |db| db.set_pin(&a, &user_id, &new_pin))?;
    if a.user_id.as_deref() == Some(&user_id) {
        if let Ok(mut g) = state.session.lock() {
            if let Some(s) = g.as_mut() {
                s.must_change_pin = false;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_user_active(state: State<'_, AppState>, user_id: String, active: bool) -> CmdResult<()> {
    let a = actor(&state)?;
    with_db(&state, |db| db.set_user_active(&a, &user_id, active))
}

// ------------------------------------------------------------------ offices & holidays
#[tauri::command]
pub fn list_offices(
    state: State<'_, AppState>,
    include_inactive: Option<bool>,
) -> CmdResult<Vec<Office>> {
    with_db(&state, |db| {
        db.list_offices(include_inactive.unwrap_or(false))
    })
}

#[tauri::command]
pub fn save_office(state: State<'_, AppState>, office: Office) -> CmdResult<Office> {
    let a = actor(&state)?;
    with_db(&state, |db| db.save_office(&a, office))
}

#[tauri::command]
pub fn list_holidays(state: State<'_, AppState>, office_id: String) -> CmdResult<Vec<Holiday>> {
    with_db(&state, |db| db.list_holidays(&office_id))
}

#[tauri::command]
pub fn set_holiday(
    state: State<'_, AppState>,
    office_id: String,
    date: String,
    holiday: bool,
    note: Option<String>,
) -> CmdResult<()> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.set_holiday(
            &a,
            &office_id,
            &date,
            holiday,
            note.as_deref().unwrap_or(""),
        )
    })
}

// ------------------------------------------------------------------ ledger
#[tauri::command]
pub fn open_handover(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
    counter_label: String,
    direction: Option<String>,
) -> CmdResult<Handover> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.open_handover(
            &a,
            &office_id,
            &business_date,
            &counter_label,
            direction.as_deref().unwrap_or("pa_to_spm"),
        )
    })
}

#[tauri::command]
pub fn list_handovers(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
) -> CmdResult<Vec<Handover>> {
    with_db(&state, |db| db.list_handovers(&office_id, &business_date))
}

#[tauri::command]
pub fn update_handover_notes(
    state: State<'_, AppState>,
    handover_id: String,
    notes: String,
    system_book_balance: Option<Money>,
) -> CmdResult<Handover> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.update_handover_notes(&a, &handover_id, &notes, system_book_balance)
    })
}

#[tauri::command]
pub fn submit_handover(state: State<'_, AppState>, handover_id: String) -> CmdResult<Handover> {
    let a = actor(&state)?;
    with_db(&state, |db| db.submit_handover(&a, &handover_id))
}

#[tauri::command]
pub fn verify_handover(
    state: State<'_, AppState>,
    handover_id: String,
    accept: bool,
    note: Option<String>,
) -> CmdResult<Handover> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.verify_handover(&a, &handover_id, accept, note.as_deref().unwrap_or(""))
    })
}

#[tauri::command]
pub fn list_vouchers_for_day(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
) -> CmdResult<Vec<VoucherItem>> {
    with_db(&state, |db| {
        db.list_vouchers_for_day(&office_id, &business_date)
    })
}

#[tauri::command]
pub fn add_voucher(
    state: State<'_, AppState>,
    handover_id: String,
    input: VoucherInput,
) -> CmdResult<VoucherItem> {
    let a = actor(&state)?;
    with_db(&state, |db| db.add_voucher(&a, &handover_id, input))
}

#[tauri::command]
pub fn update_voucher(
    state: State<'_, AppState>,
    voucher_id: String,
    input: VoucherInput,
) -> CmdResult<VoucherItem> {
    let a = actor(&state)?;
    with_db(&state, |db| db.update_voucher(&a, &voucher_id, input))
}

#[tauri::command]
pub fn delete_voucher(
    state: State<'_, AppState>,
    voucher_id: String,
    reason: Option<String>,
) -> CmdResult<()> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.delete_voucher(&a, &voucher_id, reason.as_deref().unwrap_or(""))
    })
}

#[tauri::command]
pub fn verify_voucher(
    state: State<'_, AppState>,
    voucher_id: String,
    status: VerificationStatus,
    note: Option<String>,
) -> CmdResult<VoucherItem> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.verify_voucher(&a, &voucher_id, status, note.as_deref().unwrap_or(""))
    })
}

// ------------------------------------------------------------------ cash & closing
#[tauri::command]
pub fn get_denominations(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
    scope: String,
    handover_id: Option<String>,
) -> CmdResult<Vec<DenominationLine>> {
    with_db(&state, |db| {
        db.get_denominations(&office_id, &business_date, &scope, handover_id.as_deref())
    })
}

#[tauri::command]
pub fn save_denominations(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
    scope: String,
    handover_id: Option<String>,
    lines: Vec<DenominationLine>,
) -> CmdResult<PhysicalCash> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.save_denominations(
            &a,
            &office_id,
            &business_date,
            &scope,
            handover_id.as_deref(),
            &lines,
        )
    })
}

#[tauri::command]
pub fn tally_compare(system_book_balance: Money, physical_cash: Money) -> TallyResult {
    htoh_core::tally::compare(system_book_balance, physical_cash)
}

#[tauri::command]
pub fn get_daily_closing(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
) -> CmdResult<Option<DailyClosing>> {
    with_db(&state, |db| {
        db.get_daily_closing(&office_id, &business_date)
    })
}

#[tauri::command]
pub fn recalculate_day(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
) -> CmdResult<DailyClosing> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.recalculate_day(&a, &office_id, &business_date)
    })
}

#[tauri::command]
pub fn set_system_book_balance(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
    amount: Option<Money>,
    note: Option<String>,
) -> CmdResult<DailyClosing> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.set_system_book_balance(
            &a,
            &office_id,
            &business_date,
            amount,
            note.as_deref().unwrap_or(""),
        )
    })
}

#[tauri::command]
pub fn close_day(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
    remarks: Option<String>,
) -> CmdResult<DailyClosing> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.close_day(
            &a,
            &office_id,
            &business_date,
            remarks.as_deref().unwrap_or(""),
        )
    })
}

#[tauri::command]
pub fn reopen_day(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
    reason: Option<String>,
) -> CmdResult<DailyClosing> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.reopen_day(
            &a,
            &office_id,
            &business_date,
            reason.as_deref().unwrap_or(""),
        )
    })
}

#[tauri::command]
pub fn list_daily_closings(
    state: State<'_, AppState>,
    office_id: String,
    month: String,
) -> CmdResult<Vec<DailyClosing>> {
    with_db(&state, |db| db.list_daily_closings(&office_id, &month))
}

#[tauri::command]
pub fn list_violations(
    state: State<'_, AppState>,
    office_id: String,
    month: String,
) -> CmdResult<Vec<CashLimitViolation>> {
    with_db(&state, |db| db.list_violations(&office_id, &month))
}

#[derive(Serialize)]
pub struct DashboardSummary {
    pub office: Office,
    pub business_date: String,
    pub is_working_day: bool,
    pub closing: Option<DailyClosing>,
    pub chest: PhysicalCash,
    pub tally: Option<TallyResult>,
    pub pending_vouchers: i64,
    pub accepted_vouchers: i64,
    pub rejected_vouchers: i64,
    pub voucher_lines: i64,
    pub handovers: Vec<Handover>,
    pub violations_this_month: i64,
}

#[tauri::command]
pub fn dashboard_summary(
    state: State<'_, AppState>,
    office_id: String,
    business_date: String,
) -> CmdResult<DashboardSummary> {
    with_db(&state, |db| {
        let office = db.get_office(&office_id)?;
        let closing = db.get_daily_closing(&office_id, &business_date)?;
        let chest = db.physical_cash(&office_id, &business_date, "chest", None)?;
        let tally = closing.as_ref().map(|c| {
            htoh_core::tally::compare(
                c.system_book_balance.unwrap_or(c.closing_balance),
                c.physical_cash,
            )
        });
        let (pending, accepted, rejected, lines) =
            db.voucher_status_counts(&office_id, &business_date)?;
        let month = business_date.chars().take(7).collect::<String>();
        let violations = db
            .list_violations(&office_id, &month)
            .map(|v| v.len() as i64)
            .unwrap_or(0);
        let handovers = db.list_handovers(&office_id, &business_date)?;
        let is_working_day = db.is_working_day(&office_id, &business_date)?;
        Ok(DashboardSummary {
            office,
            business_date,
            is_working_day,
            closing,
            chest,
            tally,
            pending_vouchers: pending,
            accepted_vouchers: accepted,
            rejected_vouchers: rejected,
            voucher_lines: lines,
            handovers,
            violations_this_month: violations,
        })
    })
}

// ------------------------------------------------------------------ SMR
#[derive(Serialize)]
pub struct SmrBatchResult {
    pub month: String,
    pub summaries: Vec<SmrBatchSummary>,
    pub reports: Vec<SmrReport>,
}

#[tauri::command]
pub fn compile_smr_batch(state: State<'_, AppState>, month: String) -> CmdResult<SmrBatchResult> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        let (summaries, reports) = htoh_core::smr::compile_batch(db, &a, &month)?;
        Ok(SmrBatchResult {
            month,
            summaries,
            reports,
        })
    })
}

#[tauri::command]
pub fn compile_smr_office(
    state: State<'_, AppState>,
    office_id: String,
    month: String,
) -> CmdResult<SmrReport> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        let report = htoh_core::smr::compile_office(db, &office_id, &month)?;
        db.save_smr_report(
            &a,
            &office_id,
            &month,
            report.status.as_str(),
            &report.flags,
            &serde_json::to_string(&report)?,
        )?;
        Ok(report)
    })
}

#[tauri::command]
pub fn list_smr_entries(
    state: State<'_, AppState>,
    office_id: String,
    month: String,
) -> CmdResult<Vec<SmrEntry>> {
    with_db(&state, |db| db.list_smr_entries(&office_id, &month))
}

#[tauri::command]
pub fn save_smr_entry(state: State<'_, AppState>, entry: SmrEntry) -> CmdResult<SmrEntry> {
    let a = actor(&state)?;
    with_db(&state, |db| db.save_smr_entry(&a, entry))
}

#[tauri::command]
pub fn sign_off_smr(state: State<'_, AppState>, office_id: String, month: String) -> CmdResult<()> {
    let a = actor(&state)?;
    with_db(&state, |db| db.sign_off_smr(&a, &office_id, &month))
}

#[tauri::command]
pub fn list_stamp_stock(
    state: State<'_, AppState>,
    office_id: String,
    month: String,
) -> CmdResult<Vec<StampStock>> {
    with_db(&state, |db| db.list_stamp_stock(&office_id, &month))
}

#[tauri::command]
pub fn save_stamp_stock(
    state: State<'_, AppState>,
    office_id: String,
    month: String,
    category: String,
    opening: Money,
    receipts: Money,
    sales: Money,
) -> CmdResult<StampStock> {
    let a = actor(&state)?;
    with_db(&state, |db| {
        db.save_stamp_stock(&a, &office_id, &month, &category, opening, receipts, sales)
    })
}

// ------------------------------------------------------------------ audit, backup, settings
#[tauri::command]
pub fn list_audit_logs(
    state: State<'_, AppState>,
    office_id: Option<String>,
    entity_type: Option<String>,
    limit: Option<i64>,
) -> CmdResult<Vec<AuditLog>> {
    with_db(&state, |db| {
        db.list_audit_logs(
            office_id.as_deref(),
            entity_type.as_deref(),
            limit.unwrap_or(500),
        )
    })
}

#[tauri::command]
pub fn backup_now(state: State<'_, AppState>, label: Option<String>) -> CmdResult<BackupInfo> {
    let dir = state.backup_dir();
    let info = with_db(&state, |db| {
        htoh_core::backup::snapshot(db, &dir, label.as_deref().unwrap_or("manual"))
    })?;
    let _ = with_db(&state, |db| db.set_setting("last_auto_backup", &info.path));
    Ok(info)
}

#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> CmdResult<Vec<BackupInfo>> {
    let dir = state.backup_dir();
    htoh_core::backup::list(&dir).map_err(Into::into)
}

/// Restore a snapshot over the live database (supervisor only). Closes the live
/// connection, writes a safety snapshot, copies the file, and reopens.
#[tauri::command]
pub fn restore_backup(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let a = actor(&state)?;
    if !a.is_supervisor() {
        return Err(ErrorPayload {
            code: "forbidden",
            message: "only a supervisor (SPM) can restore a backup".into(),
        });
    }
    let backup_dir = state.backup_dir();
    let mut guard = state.db.lock().map_err(|_| ErrorPayload {
        code: "other",
        message: "database lock poisoned".into(),
    })?;
    let old = guard.take();
    drop(old);
    let result =
        htoh_core::backup::restore(std::path::Path::new(&path), &state.db_path, &backup_dir);
    let reopened = Database::open(&state.db_path).map_err(ErrorPayload::from)?;
    let safety = result.map_err(ErrorPayload::from)?;
    let tx_note = format!("restored from {path}; safety copy {}", safety.display());
    let _ = reopened.connection().execute(
        "INSERT INTO audit_logs(user_id,username,role,action,entity_type,entity_id,note) VALUES (?,?,?,'backup.restore','database','',?)",
        [a.user_id.clone().unwrap_or_default(), a.username.clone(), a.role.as_str().to_string(), tx_note],
    );
    *guard = Some(reopened);
    *state.session.lock().map_err(|_| ErrorPayload {
        code: "other",
        message: "session lock poisoned".into(),
    })? = None;
    Ok(safety.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> CmdResult<Option<String>> {
    with_db(&state, |db| db.get_setting(&key))
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> CmdResult<()> {
    let a = actor(&state)?;
    if !a.is_supervisor() {
        return Err(ErrorPayload {
            code: "forbidden",
            message: "only a supervisor (SPM) can change settings".into(),
        });
    }
    with_db(&state, |db| db.set_setting(&key, &value))
}

// ------------------------------------------------------------------ printing & files
#[tauri::command]
pub fn list_printers() -> CmdResult<Vec<String>> {
    htoh_core::printing::list_printers().map_err(Into::into)
}

#[tauri::command]
pub fn print_raw(target: PrintTarget, data: Vec<u8>) -> CmdResult<usize> {
    htoh_core::printing::spool(&target, &data).map_err(Into::into)
}

#[tauri::command]
pub fn write_file(path: String, data: Vec<u8>) -> CmdResult<usize> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| ErrorPayload {
            code: "io",
            message: e.to_string(),
        })?;
    }
    std::fs::write(&path, &data).map_err(|e| ErrorPayload {
        code: "io",
        message: e.to_string(),
    })?;
    Ok(data.len())
}

#[tauri::command]
pub fn classify_barcode(raw: String) -> htoh_core::barcode::BarcodeInfo {
    htoh_core::barcode::classify(&raw)
}
