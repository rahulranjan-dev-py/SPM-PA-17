//! SQLite persistence. One `Database` per process, opened in WAL mode with
//! foreign keys enforced. Every mutating operation takes an [`Actor`] and
//! writes an immutable audit row inside the same transaction.

use crate::error::{CoreError, CoreResult};
use crate::models::*;
use crate::money::Money;
use crate::tally::{self, DenominationKind, DenominationLine};
use chrono::{Datelike, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

pub const SCHEMA_SQL: &str = include_str!("../schema.sql");
pub const DEFAULT_SUPERVISOR: &str = "spm";
pub const DEFAULT_SUPERVISOR_PIN: &str = "1234";

pub struct Database {
    conn: Connection,
}

pub fn now_ts() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn parse_date(s: &str) -> CoreResult<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| CoreError::Validation(format!("invalid date `{s}` (expected YYYY-MM-DD)")))
}

pub fn validate_month(s: &str) -> CoreResult<()> {
    if s.len() == 7 && NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d").is_ok() {
        Ok(())
    } else {
        Err(CoreError::Validation(format!(
            "invalid month `{s}` (expected YYYY-MM)"
        )))
    }
}

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut digest = Sha256::digest(format!("{salt}:{pin}").as_bytes()).to_vec();
    for _ in 0..10_000 {
        let mut h = Sha256::new();
        h.update(salt.as_bytes());
        h.update(&digest);
        digest = h.finalize().to_vec();
    }
    hex::encode(digest)
}

impl Database {
    pub fn open<P: AsRef<Path>>(path: P) -> CoreResult<Database> {
        if let Some(parent) = path.as_ref().parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> CoreResult<Database> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> CoreResult<Database> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        conn.execute_batch(SCHEMA_SQL)?;
        let db = Database { conn };
        db.bootstrap_default_user()?;
        Ok(db)
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn journal_mode(&self) -> CoreResult<String> {
        Ok(self
            .conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))?)
    }

    pub fn integrity_check(&self) -> CoreResult<bool> {
        let s: String = self
            .conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        Ok(s == "ok")
    }

    /// Checkpoint the WAL so the main file is self-contained (used before backups).
    pub fn checkpoint(&self) -> CoreResult<()> {
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        Ok(())
    }

    fn bootstrap_default_user(&self) -> CoreResult<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        if count == 0 {
            let salt = new_id();
            self.conn.execute(
                "INSERT INTO users(id, username, display_name, role, office_id, pin_salt, pin_hash) VALUES (?,?,?,?,NULL,?,?)",
                params![new_id(), DEFAULT_SUPERVISOR, "Sub Postmaster", "supervisor", salt, hash_pin(&salt, DEFAULT_SUPERVISOR_PIN)],
            )?;
            self.set_setting("must_change_default_pin", "1")?;
        }
        Ok(())
    }

    // ------------------------------------------------------------------ settings
    pub fn get_setting(&self, key: &str) -> CoreResult<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM app_settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> CoreResult<()> {
        self.conn.execute(
            "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------ audit
    fn audit_tx<B: Serialize, A: Serialize>(
        tx: &Transaction,
        actor: &Actor,
        office_id: Option<&str>,
        action: &str,
        entity_type: &str,
        entity_id: &str,
        before: Option<&B>,
        after: Option<&A>,
        note: &str,
    ) -> CoreResult<()> {
        let before_json = before.map(serde_json::to_string).transpose()?;
        let after_json = after.map(serde_json::to_string).transpose()?;
        tx.execute(
            "INSERT INTO audit_logs(office_id,user_id,username,role,action,entity_type,entity_id,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![office_id, actor.user_id, actor.username, actor.role.as_str(), action, entity_type, entity_id, before_json, after_json, note],
        )?;
        Ok(())
    }

    pub fn list_audit_logs(
        &self,
        office_id: Option<&str>,
        entity_type: Option<&str>,
        limit: i64,
    ) -> CoreResult<Vec<AuditLog>> {
        let mut stmt = self.conn.prepare(
            "SELECT id,occurred_at,office_id,user_id,username,role,action,entity_type,entity_id,before_json,after_json,note
             FROM audit_logs WHERE (?1 IS NULL OR office_id=?1) AND (?2 IS NULL OR entity_type=?2)
             ORDER BY id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![office_id, entity_type, limit], |r| {
            Ok(AuditLog {
                id: r.get(0)?,
                occurred_at: r.get(1)?,
                office_id: r.get(2)?,
                user_id: r.get(3)?,
                username: r.get(4)?,
                role: r.get(5)?,
                action: r.get(6)?,
                entity_type: r.get(7)?,
                entity_id: r.get(8)?,
                before_json: r.get(9)?,
                after_json: r.get(10)?,
                note: r.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    // ------------------------------------------------------------------ users
    fn row_user(r: &Row) -> rusqlite::Result<User> {
        Ok(User {
            id: r.get(0)?,
            username: r.get(1)?,
            display_name: r.get(2)?,
            role: Role::parse(&r.get::<_, String>(3)?).unwrap_or(Role::Operator),
            office_id: r.get(4)?,
            active: r.get::<_, i64>(5)? == 1,
            last_login_at: r.get(6)?,
        })
    }

    pub fn list_users(&self) -> CoreResult<Vec<User>> {
        let mut stmt = self.conn.prepare("SELECT id,username,display_name,role,office_id,active,last_login_at FROM users ORDER BY role DESC, username")?;
        let rows = stmt.query_map([], Self::row_user)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn authenticate(&self, username: &str, pin: &str) -> CoreResult<(User, Actor)> {
        let (id, salt, hash): (String, String, String) = self
            .conn
            .query_row("SELECT id,pin_salt,pin_hash FROM users WHERE username=? COLLATE NOCASE AND active=1", [username], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?
            .ok_or_else(|| CoreError::Forbidden("unknown user or wrong PIN".into()))?;
        if hash_pin(&salt, pin) != hash {
            let tx_actor = Actor {
                user_id: Some(id.clone()),
                username: username.to_string(),
                role: Role::Operator,
            };
            let tx = self.conn.unchecked_transaction()?;
            Self::audit_tx::<(), ()>(
                &tx,
                &tx_actor,
                None,
                "login.failed",
                "user",
                &id,
                None,
                None,
                "wrong PIN",
            )?;
            tx.commit()?;
            return Err(CoreError::Forbidden("unknown user or wrong PIN".into()));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE users SET last_login_at=? WHERE id=?",
            params![now_ts(), id],
        )?;
        let user = tx.query_row("SELECT id,username,display_name,role,office_id,active,last_login_at FROM users WHERE id=?", [&id], Self::row_user)?;
        let actor = Actor {
            user_id: Some(user.id.clone()),
            username: user.username.clone(),
            role: user.role,
        };
        Self::audit_tx::<(), ()>(&tx, &actor, None, "login", "user", &id, None, None, "")?;
        tx.commit()?;
        Ok((user, actor))
    }

    pub fn create_user(
        &self,
        actor: &Actor,
        username: &str,
        display_name: &str,
        role: Role,
        office_id: Option<&str>,
        pin: &str,
    ) -> CoreResult<User> {
        require_supervisor(actor, "create users")?;
        if pin.len() < 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(CoreError::Validation(
                "PIN must be at least 4 digits".into(),
            ));
        }
        let id = new_id();
        let salt = new_id();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO users(id,username,display_name,role,office_id,pin_salt,pin_hash) VALUES (?,?,?,?,?,?,?)",
            params![id, username.trim(), display_name.trim(), role.as_str(), office_id, salt, hash_pin(&salt, pin)],
        )?;
        let user = tx.query_row("SELECT id,username,display_name,role,office_id,active,last_login_at FROM users WHERE id=?", [&id], Self::row_user)?;
        Self::audit_tx::<(), User>(
            &tx,
            actor,
            office_id,
            "user.create",
            "user",
            &id,
            None,
            Some(&user),
            "",
        )?;
        tx.commit()?;
        Ok(user)
    }

    pub fn set_pin(&self, actor: &Actor, user_id: &str, new_pin: &str) -> CoreResult<()> {
        if !actor.is_supervisor() && actor.user_id.as_deref() != Some(user_id) {
            return Err(CoreError::Forbidden(
                "operators may only change their own PIN".into(),
            ));
        }
        if new_pin.len() < 4 || !new_pin.chars().all(|c| c.is_ascii_digit()) {
            return Err(CoreError::Validation(
                "PIN must be at least 4 digits".into(),
            ));
        }
        let salt = new_id();
        let tx = self.conn.unchecked_transaction()?;
        let n = tx.execute(
            "UPDATE users SET pin_salt=?, pin_hash=? WHERE id=?",
            params![salt, hash_pin(&salt, new_pin), user_id],
        )?;
        if n == 0 {
            return Err(CoreError::NotFound(format!("user {user_id}")));
        }
        Self::audit_tx::<(), ()>(
            &tx,
            actor,
            None,
            "user.set_pin",
            "user",
            user_id,
            None,
            None,
            "",
        )?;
        tx.commit()?;
        if actor.user_id.as_deref() == Some(user_id) {
            self.set_setting("must_change_default_pin", "0")?;
        }
        Ok(())
    }

    pub fn set_user_active(&self, actor: &Actor, user_id: &str, active: bool) -> CoreResult<()> {
        require_supervisor(actor, "deactivate users")?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE users SET active=? WHERE id=?",
            params![active as i64, user_id],
        )?;
        Self::audit_tx::<(), bool>(
            &tx,
            actor,
            None,
            "user.set_active",
            "user",
            user_id,
            None,
            Some(&active),
            "",
        )?;
        tx.commit()?;
        Ok(())
    }

    // ------------------------------------------------------------------ offices
    fn row_office(r: &Row) -> rusqlite::Result<Office> {
        Ok(Office {
            id: r.get(0)?,
            name: r.get(1)?,
            pincode: r.get(2)?,
            facility_id: r.get(3)?,
            office_type: r.get(4)?,
            division: r.get(5)?,
            sub_division: r.get(6)?,
            head_office: r.get(7)?,
            postmaster_name: r.get(8)?,
            postmaster_designation: r.get(9)?,
            postmaster_phone: r.get(10)?,
            min_cash_limit: r.get(11)?,
            max_cash_limit: r.get(12)?,
            register_start_date: r.get(13)?,
            initial_opening: r.get(14)?,
            active: r.get::<_, i64>(15)? == 1,
        })
    }

    const OFFICE_COLS: &'static str = "id,name,pincode,facility_id,office_type,division,sub_division,head_office,postmaster_name,postmaster_designation,postmaster_phone,min_cash_limit_paise,max_cash_limit_paise,register_start_date,initial_opening_paise,active";

    pub fn list_offices(&self, include_inactive: bool) -> CoreResult<Vec<Office>> {
        let sql = format!(
            "SELECT {} FROM offices WHERE (?1=1 OR active=1) ORDER BY name",
            Self::OFFICE_COLS
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![include_inactive as i64], Self::row_office)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_office(&self, id: &str) -> CoreResult<Office> {
        let sql = format!("SELECT {} FROM offices WHERE id=?", Self::OFFICE_COLS);
        self.conn
            .query_row(&sql, [id], Self::row_office)
            .optional()?
            .ok_or_else(|| CoreError::NotFound(format!("office {id}")))
    }

    /// Create or update an office (supervisor only). An empty `id` creates a new office.
    pub fn save_office(&self, actor: &Actor, mut office: Office) -> CoreResult<Office> {
        require_supervisor(actor, "configure offices")?;
        if office.name.trim().is_empty() {
            return Err(CoreError::Validation("office name is required".into()));
        }
        if office.pincode.len() != 6 || !office.pincode.chars().all(|c| c.is_ascii_digit()) {
            return Err(CoreError::Validation("pincode must be 6 digits".into()));
        }
        if !office.max_cash_limit.is_zero() && office.max_cash_limit < office.min_cash_limit {
            return Err(CoreError::Validation(
                "maximum cash limit must not be below the minimum".into(),
            ));
        }
        if let Some(d) = &office.register_start_date {
            parse_date(d)?;
        }
        let tx = self.conn.unchecked_transaction()?;
        let before = if office.id.is_empty() {
            office.id = new_id();
            None
        } else {
            let sql = format!("SELECT {} FROM offices WHERE id=?", Self::OFFICE_COLS);
            tx.query_row(&sql, [&office.id], Self::row_office)
                .optional()?
        };
        tx.execute(
            "INSERT INTO offices(id,name,pincode,facility_id,office_type,division,sub_division,head_office,postmaster_name,postmaster_designation,postmaster_phone,min_cash_limit_paise,max_cash_limit_paise,register_start_date,initial_opening_paise,active)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,pincode=excluded.pincode,facility_id=excluded.facility_id,office_type=excluded.office_type,division=excluded.division,sub_division=excluded.sub_division,head_office=excluded.head_office,postmaster_name=excluded.postmaster_name,postmaster_designation=excluded.postmaster_designation,postmaster_phone=excluded.postmaster_phone,min_cash_limit_paise=excluded.min_cash_limit_paise,max_cash_limit_paise=excluded.max_cash_limit_paise,register_start_date=excluded.register_start_date,initial_opening_paise=excluded.initial_opening_paise,active=excluded.active",
            params![
                office.id, office.name.trim(), office.pincode, office.facility_id.trim(), if office.office_type.is_empty() { "SO" } else { &office.office_type },
                office.division.trim(), office.sub_division.trim(), office.head_office.trim(), office.postmaster_name.trim(),
                if office.postmaster_designation.is_empty() { "SPM" } else { &office.postmaster_designation }, office.postmaster_phone.trim(),
                office.min_cash_limit, office.max_cash_limit, office.register_start_date, office.initial_opening, office.active as i64
            ],
        )?;
        let saved = tx.query_row(
            &format!("SELECT {} FROM offices WHERE id=?", Self::OFFICE_COLS),
            [&office.id],
            Self::row_office,
        )?;
        let action = if before.is_some() {
            "office.update"
        } else {
            "office.create"
        };
        Self::audit_tx(
            &tx,
            actor,
            Some(&saved.id),
            action,
            "office",
            &saved.id,
            before.as_ref(),
            Some(&saved),
            "",
        )?;
        tx.commit()?;
        Ok(saved)
    }

    // ------------------------------------------------------------------ holidays
    pub fn is_working_day(&self, office_id: &str, date: &str) -> CoreResult<bool> {
        let d = parse_date(date)?;
        if d.weekday() == chrono::Weekday::Sun {
            return Ok(false);
        }
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM holidays WHERE holiday_date=?1 AND (office_id='*' OR office_id=?2)",
            params![date, office_id],
            |r| r.get(0),
        )?;
        Ok(n == 0)
    }

    pub fn set_holiday(
        &self,
        actor: &Actor,
        office_id: &str,
        date: &str,
        holiday: bool,
        note: &str,
    ) -> CoreResult<()> {
        parse_date(date)?;
        let tx = self.conn.unchecked_transaction()?;
        if holiday {
            tx.execute(
                "INSERT OR REPLACE INTO holidays(office_id,holiday_date,note) VALUES (?,?,?)",
                params![office_id, date, note],
            )?;
        } else {
            tx.execute(
                "DELETE FROM holidays WHERE office_id=? AND holiday_date=?",
                params![office_id, date],
            )?;
        }
        Self::audit_tx::<(), bool>(
            &tx,
            actor,
            Some(office_id),
            "holiday.set",
            "holiday",
            date,
            None,
            Some(&holiday),
            note,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_holidays(&self, office_id: &str) -> CoreResult<Vec<Holiday>> {
        let mut stmt = self.conn.prepare("SELECT office_id,holiday_date,note FROM holidays WHERE office_id='*' OR office_id=? ORDER BY holiday_date DESC")?;
        let rows = stmt.query_map([office_id], |r| {
            Ok(Holiday {
                office_id: r.get(0)?,
                holiday_date: r.get(1)?,
                note: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    // ------------------------------------------------------------------ handovers
    const HANDOVER_COLS: &'static str = "id,office_id,business_date,counter_label,sequence_no,direction,from_user_id,to_user_id,status,system_book_balance_paise,physical_cash_paise,notes,submitted_at,verified_by,verified_at,created_at,updated_at";

    fn row_handover(r: &Row) -> rusqlite::Result<Handover> {
        Ok(Handover {
            id: r.get(0)?,
            office_id: r.get(1)?,
            business_date: r.get(2)?,
            counter_label: r.get(3)?,
            sequence_no: r.get(4)?,
            direction: r.get(5)?,
            from_user_id: r.get(6)?,
            to_user_id: r.get(7)?,
            status: r.get(8)?,
            system_book_balance: r.get(9)?,
            physical_cash: r.get(10)?,
            notes: r.get(11)?,
            submitted_at: r.get(12)?,
            verified_by: r.get(13)?,
            verified_at: r.get(14)?,
            created_at: r.get(15)?,
            updated_at: r.get(16)?,
        })
    }

    pub fn get_handover(&self, id: &str) -> CoreResult<Handover> {
        self.conn
            .query_row(
                &format!("SELECT {} FROM handovers WHERE id=?", Self::HANDOVER_COLS),
                [id],
                Self::row_handover,
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound(format!("handover {id}")))
    }

    pub fn list_handovers(
        &self,
        office_id: &str,
        business_date: &str,
    ) -> CoreResult<Vec<Handover>> {
        let sql = format!("SELECT {} FROM handovers WHERE office_id=? AND business_date=? ORDER BY counter_label, sequence_no", Self::HANDOVER_COLS);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![office_id, business_date], Self::row_handover)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Returns the open ledger sheet for a counter on a date, creating it if needed.
    pub fn open_handover(
        &self,
        actor: &Actor,
        office_id: &str,
        business_date: &str,
        counter_label: &str,
        direction: &str,
    ) -> CoreResult<Handover> {
        parse_date(business_date)?;
        self.get_office(office_id)?;
        let counter_label = if counter_label.trim().is_empty() {
            "Counter 1"
        } else {
            counter_label.trim()
        };
        if !["pa_to_spm", "spm_to_pa", "treasury"].contains(&direction) {
            return Err(CoreError::Validation(format!(
                "invalid direction `{direction}`"
            )));
        }
        let existing = self
            .conn
            .query_row(
                &format!("SELECT {} FROM handovers WHERE office_id=? AND business_date=? AND counter_label=? AND status IN ('open','rejected') ORDER BY sequence_no DESC LIMIT 1", Self::HANDOVER_COLS),
                params![office_id, business_date, counter_label],
                Self::row_handover,
            )
            .optional()?;
        if let Some(h) = existing {
            return Ok(h);
        }
        let seq: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(sequence_no),0)+1 FROM handovers WHERE office_id=? AND business_date=? AND counter_label=?",
            params![office_id, business_date, counter_label],
            |r| r.get(0),
        )?;
        let id = new_id();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO handovers(id,office_id,business_date,counter_label,sequence_no,direction,from_user_id) VALUES (?,?,?,?,?,?,?)",
            params![id, office_id, business_date, counter_label, seq, direction, actor.user_id],
        )?;
        let h = tx.query_row(
            &format!("SELECT {} FROM handovers WHERE id=?", Self::HANDOVER_COLS),
            [&id],
            Self::row_handover,
        )?;
        Self::audit_tx::<(), Handover>(
            &tx,
            actor,
            Some(office_id),
            "handover.open",
            "handover",
            &id,
            None,
            Some(&h),
            "",
        )?;
        tx.commit()?;
        Ok(h)
    }

    pub fn update_handover_notes(
        &self,
        actor: &Actor,
        handover_id: &str,
        notes: &str,
        system_book_balance: Option<Money>,
    ) -> CoreResult<Handover> {
        let before = self.get_handover(handover_id)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE handovers SET notes=?, system_book_balance_paise=? WHERE id=?",
            params![notes, system_book_balance, handover_id],
        )?;
        let after = tx.query_row(
            &format!("SELECT {} FROM handovers WHERE id=?", Self::HANDOVER_COLS),
            [handover_id],
            Self::row_handover,
        )?;
        Self::audit_tx(
            &tx,
            actor,
            Some(&before.office_id),
            "handover.update",
            "handover",
            handover_id,
            Some(&before),
            Some(&after),
            "",
        )?;
        tx.commit()?;
        Ok(after)
    }

    /// Operator hands the sheet over to the SPM. Physical cash is snapshotted from the handover-scope denominations.
    pub fn submit_handover(&self, actor: &Actor, handover_id: &str) -> CoreResult<Handover> {
        let before = self.get_handover(handover_id)?;
        if before.status == "submitted" || before.status == "verified" {
            return Err(CoreError::Validation("handover already submitted".into()));
        }
        let physical = self.physical_cash(
            &before.office_id,
            &before.business_date,
            "handover",
            Some(handover_id),
        )?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE handovers SET status='submitted', submitted_at=?, physical_cash_paise=?, from_user_id=COALESCE(from_user_id, ?) WHERE id=?",
            params![now_ts(), physical.total, actor.user_id, handover_id],
        )?;
        let after = tx.query_row(
            &format!("SELECT {} FROM handovers WHERE id=?", Self::HANDOVER_COLS),
            [handover_id],
            Self::row_handover,
        )?;
        Self::audit_tx(
            &tx,
            actor,
            Some(&before.office_id),
            "handover.submit",
            "handover",
            handover_id,
            Some(&before),
            Some(&after),
            "",
        )?;
        tx.commit()?;
        Ok(after)
    }

    /// Supervisor accepts or rejects a submitted sheet; accepting also accepts every pending voucher on it.
    pub fn verify_handover(
        &self,
        actor: &Actor,
        handover_id: &str,
        accept: bool,
        note: &str,
    ) -> CoreResult<Handover> {
        require_supervisor(actor, "verify handovers")?;
        let before = self.get_handover(handover_id)?;
        let tx = self.conn.unchecked_transaction()?;
        let status = if accept { "verified" } else { "rejected" };
        let ts = now_ts();
        tx.execute(
            "UPDATE handovers SET status=?, verified_by=?, verified_at=?, to_user_id=COALESCE(to_user_id, ?) WHERE id=?",
            params![status, actor.user_id, ts, actor.user_id, handover_id],
        )?;
        let vstatus = if accept { "accepted" } else { "rejected" };
        tx.execute(
            "UPDATE voucher_items SET verification_status=?, verified_by=?, verified_at=? WHERE handover_id=? AND verification_status='pending'",
            params![vstatus, actor.user_id, ts, handover_id],
        )?;
        let after = tx.query_row(
            &format!("SELECT {} FROM handovers WHERE id=?", Self::HANDOVER_COLS),
            [handover_id],
            Self::row_handover,
        )?;
        Self::audit_tx(
            &tx,
            actor,
            Some(&before.office_id),
            if accept {
                "handover.verify"
            } else {
                "handover.reject"
            },
            "handover",
            handover_id,
            Some(&before),
            Some(&after),
            note,
        )?;
        tx.commit()?;
        self.recalculate_day(actor, &before.office_id, &before.business_date)?;
        Ok(after)
    }

    // ------------------------------------------------------------------ vouchers
    const VOUCHER_COLS: &'static str = "id,handover_id,category,voucher_type,flow,account_or_barcode_id,voucher_count,amount_paise,reference_id,submitted_at,verification_status,verified_by,verified_at,remarks,created_by,created_at,updated_at";

    fn row_voucher(r: &Row) -> rusqlite::Result<VoucherItem> {
        Ok(VoucherItem {
            id: r.get(0)?,
            handover_id: r.get(1)?,
            category: VoucherCategory::parse(&r.get::<_, String>(2)?)
                .unwrap_or(VoucherCategory::SavingsBank),
            voucher_type: r.get(3)?,
            flow: Flow::parse(&r.get::<_, String>(4)?).unwrap_or(Flow::Receipt),
            account_or_barcode_id: r.get(5)?,
            voucher_count: r.get(6)?,
            amount: r.get(7)?,
            reference_id: r.get(8)?,
            submitted_at: r.get(9)?,
            verification_status: VerificationStatus::parse(&r.get::<_, String>(10)?)
                .unwrap_or(VerificationStatus::Pending),
            verified_by: r.get(11)?,
            verified_at: r.get(12)?,
            remarks: r.get(13)?,
            created_by: r.get(14)?,
            created_at: r.get(15)?,
            updated_at: r.get(16)?,
        })
    }

    pub fn get_voucher(&self, id: &str) -> CoreResult<VoucherItem> {
        self.conn
            .query_row(
                &format!(
                    "SELECT {} FROM voucher_items WHERE id=?",
                    Self::VOUCHER_COLS
                ),
                [id],
                Self::row_voucher,
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound(format!("voucher {id}")))
    }

    pub fn list_vouchers(&self, handover_id: &str) -> CoreResult<Vec<VoucherItem>> {
        let sql = format!(
            "SELECT {} FROM voucher_items WHERE handover_id=? ORDER BY created_at, rowid",
            Self::VOUCHER_COLS
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([handover_id], Self::row_voucher)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn list_vouchers_for_day(
        &self,
        office_id: &str,
        business_date: &str,
    ) -> CoreResult<Vec<VoucherItem>> {
        let sql = format!(
            "SELECT {} FROM voucher_items v WHERE handover_id IN (SELECT id FROM handovers WHERE office_id=? AND business_date=?) ORDER BY v.created_at, v.rowid",
            Self::VOUCHER_COLS.split(',').map(|c| format!("v.{c}")).collect::<Vec<_>>().join(",")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![office_id, business_date], Self::row_voucher)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    fn validate_voucher(input: &VoucherInput) -> CoreResult<()> {
        if input.voucher_type.trim().is_empty() {
            return Err(CoreError::Validation("voucher type is required".into()));
        }
        if input.voucher_count < 1 {
            return Err(CoreError::Validation(
                "number of vouchers must be at least 1".into(),
            ));
        }
        if input.amount.is_negative() {
            return Err(CoreError::Validation("amount must not be negative".into()));
        }
        Ok(())
    }

    pub fn add_voucher(
        &self,
        actor: &Actor,
        handover_id: &str,
        input: VoucherInput,
    ) -> CoreResult<VoucherItem> {
        Self::validate_voucher(&input)?;
        let h = self.get_handover(handover_id)?;
        if h.status == "verified" && !actor.is_supervisor() {
            return Err(CoreError::Forbidden(
                "handover already verified; ask the SPM to reopen".into(),
            ));
        }
        let id = new_id();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO voucher_items(id,handover_id,category,voucher_type,flow,account_or_barcode_id,voucher_count,amount_paise,reference_id,remarks,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            params![
                id, handover_id, input.category.as_str(), input.voucher_type.trim().to_ascii_uppercase(), input.flow.as_str(),
                input.account_or_barcode_id.trim(), input.voucher_count, input.amount, input.reference_id.trim(), input.remarks.trim(), actor.user_id
            ],
        )?;
        let v = tx.query_row(
            &format!(
                "SELECT {} FROM voucher_items WHERE id=?",
                Self::VOUCHER_COLS
            ),
            [&id],
            Self::row_voucher,
        )?;
        Self::audit_tx::<(), VoucherItem>(
            &tx,
            actor,
            Some(&h.office_id),
            "voucher.create",
            "voucher",
            &id,
            None,
            Some(&v),
            "",
        )?;
        tx.commit()?;
        self.recalculate_day(actor, &h.office_id, &h.business_date)?;
        Ok(v)
    }

    pub fn update_voucher(
        &self,
        actor: &Actor,
        voucher_id: &str,
        input: VoucherInput,
    ) -> CoreResult<VoucherItem> {
        Self::validate_voucher(&input)?;
        let before = self.get_voucher(voucher_id)?;
        let h = self.get_handover(&before.handover_id)?;
        if before.verification_status != VerificationStatus::Pending && !actor.is_supervisor() {
            return Err(CoreError::Forbidden(
                "verified vouchers can only be changed by the SPM".into(),
            ));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE voucher_items SET category=?,voucher_type=?,flow=?,account_or_barcode_id=?,voucher_count=?,amount_paise=?,reference_id=?,remarks=? WHERE id=?",
            params![
                input.category.as_str(), input.voucher_type.trim().to_ascii_uppercase(), input.flow.as_str(), input.account_or_barcode_id.trim(),
                input.voucher_count, input.amount, input.reference_id.trim(), input.remarks.trim(), voucher_id
            ],
        )?;
        let after = tx.query_row(
            &format!(
                "SELECT {} FROM voucher_items WHERE id=?",
                Self::VOUCHER_COLS
            ),
            [voucher_id],
            Self::row_voucher,
        )?;
        Self::audit_tx(
            &tx,
            actor,
            Some(&h.office_id),
            "voucher.update",
            "voucher",
            voucher_id,
            Some(&before),
            Some(&after),
            "",
        )?;
        tx.commit()?;
        self.recalculate_day(actor, &h.office_id, &h.business_date)?;
        Ok(after)
    }

    pub fn delete_voucher(&self, actor: &Actor, voucher_id: &str, reason: &str) -> CoreResult<()> {
        let before = self.get_voucher(voucher_id)?;
        let h = self.get_handover(&before.handover_id)?;
        if before.verification_status != VerificationStatus::Pending && !actor.is_supervisor() {
            return Err(CoreError::Forbidden(
                "verified vouchers can only be deleted by the SPM".into(),
            ));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM voucher_items WHERE id=?", [voucher_id])?;
        Self::audit_tx::<VoucherItem, ()>(
            &tx,
            actor,
            Some(&h.office_id),
            "voucher.delete",
            "voucher",
            voucher_id,
            Some(&before),
            None,
            reason,
        )?;
        tx.commit()?;
        self.recalculate_day(actor, &h.office_id, &h.business_date)?;
        Ok(())
    }

    pub fn verify_voucher(
        &self,
        actor: &Actor,
        voucher_id: &str,
        status: VerificationStatus,
        note: &str,
    ) -> CoreResult<VoucherItem> {
        require_supervisor(actor, "verify vouchers")?;
        let before = self.get_voucher(voucher_id)?;
        let h = self.get_handover(&before.handover_id)?;
        let tx = self.conn.unchecked_transaction()?;
        match status {
            VerificationStatus::Pending => {
                tx.execute("UPDATE voucher_items SET verification_status='pending', verified_by=NULL, verified_at=NULL WHERE id=?", [voucher_id])?;
            }
            _ => {
                tx.execute(
                    "UPDATE voucher_items SET verification_status=?, verified_by=?, verified_at=? WHERE id=?",
                    params![status.as_str(), actor.user_id, now_ts(), voucher_id],
                )?;
            }
        }
        let after = tx.query_row(
            &format!(
                "SELECT {} FROM voucher_items WHERE id=?",
                Self::VOUCHER_COLS
            ),
            [voucher_id],
            Self::row_voucher,
        )?;
        Self::audit_tx(
            &tx,
            actor,
            Some(&h.office_id),
            "voucher.verify",
            "voucher",
            voucher_id,
            Some(&before),
            Some(&after),
            note,
        )?;
        tx.commit()?;
        self.recalculate_day(actor, &h.office_id, &h.business_date)?;
        Ok(after)
    }

    // ------------------------------------------------------------------ denominations
    pub fn get_denominations(
        &self,
        office_id: &str,
        business_date: &str,
        scope: &str,
        handover_id: Option<&str>,
    ) -> CoreResult<Vec<DenominationLine>> {
        let mut stmt = self.conn.prepare(
            "SELECT kind, face_value_paise, quantity, line_total_paise FROM cash_denominations
             WHERE office_id=?1 AND business_date=?2 AND scope=?3 AND COALESCE(handover_id,'')=COALESCE(?4,'')
             ORDER BY kind, face_value_paise DESC",
        )?;
        let rows = stmt.query_map(params![office_id, business_date, scope, handover_id], |r| {
            Ok(DenominationLine {
                kind: DenominationKind::parse(&r.get::<_, String>(0)?)
                    .unwrap_or(DenominationKind::Note),
                face_value_paise: r.get(1)?,
                quantity: r.get(2)?,
                amount: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn physical_cash(
        &self,
        office_id: &str,
        business_date: &str,
        scope: &str,
        handover_id: Option<&str>,
    ) -> CoreResult<tally::PhysicalCash> {
        let lines = self.get_denominations(office_id, business_date, scope, handover_id)?;
        Ok(tally::physical_total(&lines)?)
    }

    /// Replace the full denomination set for a scope/date (chest, handover or customer counter).
    pub fn save_denominations(
        &self,
        actor: &Actor,
        office_id: &str,
        business_date: &str,
        scope: &str,
        handover_id: Option<&str>,
        lines: &[DenominationLine],
    ) -> CoreResult<tally::PhysicalCash> {
        parse_date(business_date)?;
        if !["chest", "handover", "customer"].contains(&scope) {
            return Err(CoreError::Validation(format!("invalid scope `{scope}`")));
        }
        if (scope == "handover") != handover_id.is_some() {
            return Err(CoreError::Validation(
                "handover scope requires a handover id".into(),
            ));
        }
        let totals = tally::physical_total(lines)?;
        let before = self.get_denominations(office_id, business_date, scope, handover_id)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM cash_denominations WHERE office_id=?1 AND business_date=?2 AND scope=?3 AND COALESCE(handover_id,'')=COALESCE(?4,'')",
            params![office_id, business_date, scope, handover_id],
        )?;
        for line in lines {
            if line.amount.is_zero() && line.quantity == 0 {
                continue;
            }
            tx.execute(
                "INSERT INTO cash_denominations(id,office_id,business_date,scope,handover_id,kind,face_value_paise,quantity,line_total_paise,entered_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
                params![new_id(), office_id, business_date, scope, handover_id, line.kind.as_str(), line.face_value_paise, line.quantity, line.amount, actor.user_id],
            )?;
        }
        let entity = handover_id
            .map(|h| format!("{business_date}:{scope}:{h}"))
            .unwrap_or_else(|| format!("{business_date}:{scope}"));
        Self::audit_tx(
            &tx,
            actor,
            Some(office_id),
            "cash.count",
            "cash_denominations",
            &entity,
            Some(&before),
            Some(&lines.to_vec()),
            &format!("total {}", totals.total),
        )?;
        tx.commit()?;
        if scope == "chest" {
            self.recalculate_day(actor, office_id, business_date)?;
        }
        Ok(totals)
    }

    // ------------------------------------------------------------------ daily closing & limits
    fn row_closing(r: &Row) -> rusqlite::Result<DailyClosing> {
        Ok(DailyClosing {
            office_id: r.get(0)?,
            business_date: r.get(1)?,
            opening_balance: r.get(2)?,
            total_receipts: r.get(3)?,
            total_payments: r.get(4)?,
            closing_balance: r.get(5)?,
            system_book_balance: r.get(6)?,
            physical_cash: r.get(7)?,
            variance: r.get(8)?,
            status: r.get(9)?,
            closed_by: r.get(10)?,
            closed_at: r.get(11)?,
            remarks: r.get(12)?,
            is_holiday: false,
        })
    }

    const CLOSING_COLS: &'static str = "office_id,business_date,opening_balance_paise,total_receipts_paise,total_payments_paise,closing_balance_paise,system_book_balance_paise,physical_cash_paise,variance_paise,status,closed_by,closed_at,remarks";

    pub fn get_daily_closing(
        &self,
        office_id: &str,
        business_date: &str,
    ) -> CoreResult<Option<DailyClosing>> {
        let sql = format!(
            "SELECT {} FROM daily_closings WHERE office_id=? AND business_date=?",
            Self::CLOSING_COLS
        );
        let mut c = self
            .conn
            .query_row(&sql, params![office_id, business_date], Self::row_closing)
            .optional()?;
        if let Some(c) = c.as_mut() {
            c.is_holiday = !self.is_working_day(office_id, business_date)?;
        }
        Ok(c)
    }

    pub fn list_daily_closings(
        &self,
        office_id: &str,
        month: &str,
    ) -> CoreResult<Vec<DailyClosing>> {
        validate_month(month)?;
        let sql = format!("SELECT {} FROM daily_closings WHERE office_id=? AND substr(business_date,1,7)=? ORDER BY business_date", Self::CLOSING_COLS);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![office_id, month], Self::row_closing)?;
        let mut out: Vec<DailyClosing> = rows.collect::<Result<_, _>>()?;
        for c in out.iter_mut() {
            c.is_holiday = !self.is_working_day(office_id, &c.business_date)?;
        }
        Ok(out)
    }

    /// Opening balance for a date = closing of the latest saved day before it,
    /// else the office's initial opening balance (if the register has started).
    pub fn opening_balance_for(&self, office_id: &str, business_date: &str) -> CoreResult<Money> {
        let prev: Option<Money> = self
            .conn
            .query_row(
                "SELECT closing_balance_paise FROM daily_closings WHERE office_id=? AND business_date<? ORDER BY business_date DESC LIMIT 1",
                params![office_id, business_date],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(p) = prev {
            return Ok(p);
        }
        let office = self.get_office(office_id)?;
        match office.register_start_date.as_deref() {
            Some(start) if start <= business_date => Ok(office.initial_opening),
            _ => Ok(Money::ZERO),
        }
    }

    /// Recompute the book figures for a day from its (non-rejected) vouchers and
    /// chest count, log cash-limit breaches, then roll the closing forward into
    /// every later saved day (legacy "update future working days" rule).
    pub fn recalculate_day(
        &self,
        actor: &Actor,
        office_id: &str,
        business_date: &str,
    ) -> CoreResult<DailyClosing> {
        parse_date(business_date)?;
        let office = self.get_office(office_id)?;
        let mut current = business_date.to_string();
        let mut result: Option<DailyClosing> = None;
        loop {
            let closing = self.recalculate_single(actor, &office, &current)?;
            if result.is_none() {
                result = Some(closing);
            }
            let next: Option<String> = self
                .conn
                .query_row(
                    "SELECT business_date FROM daily_closings WHERE office_id=? AND business_date>? ORDER BY business_date LIMIT 1",
                    params![office_id, current],
                    |r| r.get(0),
                )
                .optional()?;
            match next {
                Some(n) => current = n,
                None => break,
            }
        }
        Ok(result.expect("at least one closing"))
    }

    fn recalculate_single(
        &self,
        actor: &Actor,
        office: &Office,
        business_date: &str,
    ) -> CoreResult<DailyClosing> {
        let opening = self.opening_balance_for(&office.id, business_date)?;
        let (receipts, payments): (Money, Money) = self.conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN v.flow='receipt' THEN v.amount_paise ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN v.flow='payment' THEN v.amount_paise ELSE 0 END),0)
             FROM voucher_items v JOIN handovers h ON h.id=v.handover_id
             WHERE h.office_id=? AND h.business_date=? AND v.verification_status<>'rejected' AND h.status<>'rejected'",
            params![office.id, business_date],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let closing = opening.checked_add(receipts)?.checked_sub(payments)?;
        let physical = self.physical_cash(&office.id, business_date, "chest", None)?;
        let existing = self.get_daily_closing(&office.id, business_date)?;
        let variance = physical.total - closing;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO daily_closings(office_id,business_date,opening_balance_paise,total_receipts_paise,total_payments_paise,closing_balance_paise,system_book_balance_paise,physical_cash_paise,variance_paise,status,remarks,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'open','',?10)
             ON CONFLICT(office_id,business_date) DO UPDATE SET opening_balance_paise=excluded.opening_balance_paise,total_receipts_paise=excluded.total_receipts_paise,total_payments_paise=excluded.total_payments_paise,closing_balance_paise=excluded.closing_balance_paise,physical_cash_paise=excluded.physical_cash_paise,variance_paise=excluded.variance_paise,updated_at=excluded.updated_at",
            params![office.id, business_date, opening, receipts, payments, closing, existing.as_ref().and_then(|e| e.system_book_balance), physical.total, variance, now_ts()],
        )?;
        // cash limit violations
        tx.execute(
            "DELETE FROM cash_limit_violations WHERE office_id=? AND business_date=?",
            params![office.id, business_date],
        )?;
        let working = self.is_working_day(&office.id, business_date)?;
        if working {
            if !office.max_cash_limit.is_zero() && closing > office.max_cash_limit {
                tx.execute(
                    "INSERT INTO cash_limit_violations(id,office_id,business_date,limit_type,limit_paise,closing_balance_paise,breach_paise) VALUES (?,?,?,'max',?,?,?)",
                    params![new_id(), office.id, business_date, office.max_cash_limit, closing, closing - office.max_cash_limit],
                )?;
                let _ = actor;
            }
            if !office.min_cash_limit.is_zero() && closing < office.min_cash_limit {
                tx.execute(
                    "INSERT INTO cash_limit_violations(id,office_id,business_date,limit_type,limit_paise,closing_balance_paise,breach_paise) VALUES (?,?,?,'min',?,?,?)",
                    params![new_id(), office.id, business_date, office.min_cash_limit, closing, office.min_cash_limit - closing],
                )?;
            }
        }
        tx.commit()?;
        Ok(self
            .get_daily_closing(&office.id, business_date)?
            .expect("just written"))
    }

    /// Record the Finacle / SAP closing figure for the day (audited as a cash override).
    pub fn set_system_book_balance(
        &self,
        actor: &Actor,
        office_id: &str,
        business_date: &str,
        amount: Option<Money>,
        note: &str,
    ) -> CoreResult<DailyClosing> {
        let before = match self.get_daily_closing(office_id, business_date)? {
            Some(c) => c,
            None => self.recalculate_day(actor, office_id, business_date)?,
        };
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE daily_closings SET system_book_balance_paise=?, updated_at=? WHERE office_id=? AND business_date=?", params![amount, now_ts(), office_id, business_date])?;
        Self::audit_tx(
            &tx,
            actor,
            Some(office_id),
            "cash.override",
            "daily_closing",
            business_date,
            Some(&before.system_book_balance),
            Some(&amount),
            note,
        )?;
        tx.commit()?;
        Ok(self
            .get_daily_closing(office_id, business_date)?
            .expect("exists"))
    }

    pub fn close_day(
        &self,
        actor: &Actor,
        office_id: &str,
        business_date: &str,
        remarks: &str,
    ) -> CoreResult<DailyClosing> {
        require_supervisor(actor, "close the day")?;
        let before = self.recalculate_day(actor, office_id, business_date)?;
        let pending: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM voucher_items v JOIN handovers h ON h.id=v.handover_id WHERE h.office_id=? AND h.business_date=? AND v.verification_status='pending'",
            params![office_id, business_date],
            |r| r.get(0),
        )?;
        if pending > 0 {
            return Err(CoreError::Validation(format!(
                "{pending} voucher(s) still pending verification"
            )));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE daily_closings SET status='closed', closed_by=?, closed_at=?, remarks=? WHERE office_id=? AND business_date=?",
            params![actor.user_id, now_ts(), remarks, office_id, business_date],
        )?;
        let after = tx.query_row(
            &format!(
                "SELECT {} FROM daily_closings WHERE office_id=? AND business_date=?",
                Self::CLOSING_COLS
            ),
            params![office_id, business_date],
            Self::row_closing,
        )?;
        Self::audit_tx(
            &tx,
            actor,
            Some(office_id),
            "day.close",
            "daily_closing",
            business_date,
            Some(&before),
            Some(&after),
            remarks,
        )?;
        tx.commit()?;
        Ok(self
            .get_daily_closing(office_id, business_date)?
            .expect("exists"))
    }

    pub fn reopen_day(
        &self,
        actor: &Actor,
        office_id: &str,
        business_date: &str,
        reason: &str,
    ) -> CoreResult<DailyClosing> {
        require_supervisor(actor, "reopen the day")?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE daily_closings SET status='open', closed_by=NULL, closed_at=NULL WHERE office_id=? AND business_date=?", params![office_id, business_date])?;
        Self::audit_tx::<(), ()>(
            &tx,
            actor,
            Some(office_id),
            "day.reopen",
            "daily_closing",
            business_date,
            None,
            None,
            reason,
        )?;
        tx.commit()?;
        self.recalculate_day(actor, office_id, business_date)
    }

    pub fn list_violations(
        &self,
        office_id: &str,
        month: &str,
    ) -> CoreResult<Vec<CashLimitViolation>> {
        validate_month(month)?;
        let mut stmt = self.conn.prepare(
            "SELECT id,office_id,business_date,limit_type,limit_paise,closing_balance_paise,breach_paise,detected_at FROM cash_limit_violations WHERE office_id=? AND substr(business_date,1,7)=? ORDER BY business_date, limit_type",
        )?;
        let rows = stmt.query_map(params![office_id, month], |r| {
            Ok(CashLimitViolation {
                id: r.get(0)?,
                office_id: r.get(1)?,
                business_date: r.get(2)?,
                limit_type: r.get(3)?,
                limit: r.get(4)?,
                closing_balance: r.get(5)?,
                breach: r.get(6)?,
                detected_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    // ------------------------------------------------------------------ SMR entries & stock
    fn row_smr(r: &Row) -> rusqlite::Result<SmrEntry> {
        Ok(SmrEntry {
            office_id: r.get(0)?,
            report_month: r.get(1)?,
            business_date: r.get(2)?,
            stamps_received: r.get(3)?,
            stamps_remitted: r.get(4)?,
            postage_stamps: r.get(5)?,
            revenue_stamps: r.get(6)?,
            other_stamps: r.get(7)?,
            cash_received_override: r.get(8)?,
            cash_remitted_override: r.get(9)?,
            liabilities_note: r.get(10)?,
            opening_balance_of_month: r.get(11)?,
            sectioned_stamp_balance: r.get(12)?,
            signed_off_by: r.get(13)?,
            signed_off_at: r.get(14)?,
        })
    }

    const SMR_COLS: &'static str = "office_id,report_month,business_date,stamps_received_paise,stamps_remitted_paise,postage_stamps_paise,revenue_stamps_paise,other_stamps_paise,cash_received_override_paise,cash_remitted_override_paise,liabilities_note,opening_balance_of_month_paise,sectioned_stamp_balance_paise,signed_off_by,signed_off_at";

    pub fn list_smr_entries(&self, office_id: &str, month: &str) -> CoreResult<Vec<SmrEntry>> {
        validate_month(month)?;
        let sql = format!("SELECT {} FROM smr_entries WHERE office_id=? AND report_month=? ORDER BY business_date", Self::SMR_COLS);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![office_id, month], Self::row_smr)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn save_smr_entry(&self, actor: &Actor, entry: SmrEntry) -> CoreResult<SmrEntry> {
        validate_month(&entry.report_month)?;
        if entry.business_date != entry.report_month {
            parse_date(&entry.business_date)?;
            if !entry.business_date.starts_with(&entry.report_month) {
                return Err(CoreError::Validation(
                    "day row is outside the report month".into(),
                ));
            }
        }
        let signed: Option<String> = self
            .conn
            .query_row("SELECT signed_off_at FROM smr_entries WHERE office_id=? AND report_month=? AND business_date=?", params![entry.office_id, entry.report_month, entry.report_month], |r| r.get(0))
            .optional()?
            .flatten();
        if signed.is_some() && !actor.is_supervisor() {
            return Err(CoreError::Forbidden(
                "month is signed off; only the SPM can change it".into(),
            ));
        }
        let before = self
            .conn
            .query_row(&format!("SELECT {} FROM smr_entries WHERE office_id=? AND report_month=? AND business_date=?", Self::SMR_COLS), params![entry.office_id, entry.report_month, entry.business_date], Self::row_smr)
            .optional()?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO smr_entries(id,office_id,report_month,business_date,stamps_received_paise,stamps_remitted_paise,postage_stamps_paise,revenue_stamps_paise,other_stamps_paise,cash_received_override_paise,cash_remitted_override_paise,liabilities_note,opening_balance_of_month_paise,sectioned_stamp_balance_paise,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(office_id,report_month,business_date) DO UPDATE SET stamps_received_paise=excluded.stamps_received_paise,stamps_remitted_paise=excluded.stamps_remitted_paise,postage_stamps_paise=excluded.postage_stamps_paise,revenue_stamps_paise=excluded.revenue_stamps_paise,other_stamps_paise=excluded.other_stamps_paise,cash_received_override_paise=excluded.cash_received_override_paise,cash_remitted_override_paise=excluded.cash_remitted_override_paise,liabilities_note=excluded.liabilities_note,opening_balance_of_month_paise=excluded.opening_balance_of_month_paise,sectioned_stamp_balance_paise=excluded.sectioned_stamp_balance_paise,updated_at=excluded.updated_at",
            params![
                new_id(), entry.office_id, entry.report_month, entry.business_date, entry.stamps_received, entry.stamps_remitted, entry.postage_stamps, entry.revenue_stamps,
                entry.other_stamps, entry.cash_received_override, entry.cash_remitted_override, entry.liabilities_note.trim(), entry.opening_balance_of_month, entry.sectioned_stamp_balance, now_ts()
            ],
        )?;
        let after = tx.query_row(&format!("SELECT {} FROM smr_entries WHERE office_id=? AND report_month=? AND business_date=?", Self::SMR_COLS), params![entry.office_id, entry.report_month, entry.business_date], Self::row_smr)?;
        Self::audit_tx(
            &tx,
            actor,
            Some(&entry.office_id),
            "smr.save",
            "smr_entry",
            &format!("{}:{}", entry.report_month, entry.business_date),
            before.as_ref(),
            Some(&after),
            "",
        )?;
        tx.commit()?;
        Ok(after)
    }

    pub fn sign_off_smr(&self, actor: &Actor, office_id: &str, month: &str) -> CoreResult<()> {
        require_supervisor(actor, "sign off the SMR")?;
        validate_month(month)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO smr_entries(id,office_id,report_month,business_date,signed_off_by,signed_off_at) VALUES (?,?,?,?,?,?)
             ON CONFLICT(office_id,report_month,business_date) DO UPDATE SET signed_off_by=excluded.signed_off_by, signed_off_at=excluded.signed_off_at",
            params![new_id(), office_id, month, month, actor.user_id, now_ts()],
        )?;
        Self::audit_tx::<(), ()>(
            &tx,
            actor,
            Some(office_id),
            "smr.signoff",
            "smr_entry",
            month,
            None,
            None,
            "",
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_stamp_stock(&self, office_id: &str, month: &str) -> CoreResult<Vec<StampStock>> {
        validate_month(month)?;
        let mut stmt = self.conn.prepare("SELECT office_id,report_month,category,opening_paise,receipts_paise,sales_paise,closing_paise FROM stamp_stock WHERE office_id=? AND report_month=? ORDER BY category")?;
        let rows = stmt.query_map(params![office_id, month], |r| {
            Ok(StampStock {
                office_id: r.get(0)?,
                report_month: r.get(1)?,
                category: r.get(2)?,
                opening: r.get(3)?,
                receipts: r.get(4)?,
                sales: r.get(5)?,
                closing: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn save_stamp_stock(
        &self,
        actor: &Actor,
        office_id: &str,
        month: &str,
        category: &str,
        opening: Money,
        receipts: Money,
        sales: Money,
    ) -> CoreResult<StampStock> {
        validate_month(month)?;
        if !["postage", "revenue", "commemorative", "stationery"].contains(&category) {
            return Err(CoreError::Validation(format!(
                "unknown stock category `{category}`"
            )));
        }
        let closing = opening.checked_add(receipts)?.checked_sub(sales)?;
        if closing.is_negative() {
            return Err(CoreError::Validation(
                "sales exceed opening + receipts".into(),
            ));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO stamp_stock(id,office_id,report_month,category,opening_paise,receipts_paise,sales_paise,closing_paise,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT(office_id,report_month,category) DO UPDATE SET opening_paise=excluded.opening_paise,receipts_paise=excluded.receipts_paise,sales_paise=excluded.sales_paise,closing_paise=excluded.closing_paise,updated_at=excluded.updated_at",
            params![new_id(), office_id, month, category, opening, receipts, sales, closing, now_ts()],
        )?;
        let stock = StampStock {
            office_id: office_id.into(),
            report_month: month.into(),
            category: category.into(),
            opening,
            receipts,
            sales,
            closing,
        };
        Self::audit_tx::<(), StampStock>(
            &tx,
            actor,
            Some(office_id),
            "stock.save",
            "stamp_stock",
            &format!("{month}:{category}"),
            None,
            Some(&stock),
            "",
        )?;
        tx.commit()?;
        Ok(stock)
    }

    // ------------------------------------------------------------------ compiled SMR reports
    pub fn save_smr_report(
        &self,
        actor: &Actor,
        office_id: &str,
        month: &str,
        status: &str,
        flags: &[String],
        payload_json: &str,
    ) -> CoreResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO smr_reports(id,office_id,report_month,status,flags_json,payload_json,generated_by,generated_at) VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(office_id,report_month) DO UPDATE SET status=excluded.status,flags_json=excluded.flags_json,payload_json=excluded.payload_json,generated_by=excluded.generated_by,generated_at=excluded.generated_at",
            params![new_id(), office_id, month, status, serde_json::to_string(flags)?, payload_json, actor.user_id, now_ts()],
        )?;
        Self::audit_tx::<(), &[String]>(
            &tx,
            actor,
            Some(office_id),
            "smr.compile",
            "smr_report",
            month,
            None,
            Some(&flags),
            status,
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_smr_report_payload(
        &self,
        office_id: &str,
        month: &str,
    ) -> CoreResult<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT payload_json FROM smr_reports WHERE office_id=? AND report_month=?",
                params![office_id, month],
                |r| r.get(0),
            )
            .optional()?)
    }

    // ------------------------------------------------------------------ dashboard helpers
    pub fn voucher_status_counts(
        &self,
        office_id: &str,
        business_date: &str,
    ) -> CoreResult<(i64, i64, i64, i64)> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN v.verification_status='pending' THEN v.voucher_count ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN v.verification_status='accepted' THEN v.voucher_count ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN v.verification_status='rejected' THEN v.voucher_count ELSE 0 END),0),
                    COUNT(*)
             FROM voucher_items v JOIN handovers h ON h.id=v.handover_id WHERE h.office_id=? AND h.business_date=?",
            params![office_id, business_date],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?)
    }

    pub fn saved_dates(&self, office_id: &str) -> CoreResult<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT business_date FROM daily_closings WHERE office_id=? ORDER BY business_date",
        )?;
        let rows = stmt.query_map([office_id], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

pub fn require_supervisor(actor: &Actor, what: &str) -> CoreResult<()> {
    if actor.is_supervisor() {
        Ok(())
    } else {
        Err(CoreError::Forbidden(format!(
            "only a supervisor (SPM) can {what}"
        )))
    }
}
