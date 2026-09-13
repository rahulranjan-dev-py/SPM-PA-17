//! Database snapshots. A backup is a fully checkpointed, self-contained copy
//! produced with `VACUUM INTO`, verified with `PRAGMA integrity_check`.

use crate::db::Database;
use crate::error::{CoreError, CoreResult};
use chrono::Local;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub verified: bool,
}

pub const BACKUP_PREFIX: &str = "HandToHand_Backup_";

pub fn snapshot(db: &Database, dir: &Path, label: &str) -> CoreResult<BackupInfo> {
    std::fs::create_dir_all(dir)?;
    let stamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let suffix = if label.is_empty() {
        String::new()
    } else {
        format!("_{}", sanitize(label))
    };
    let file_name = format!("{BACKUP_PREFIX}{stamp}{suffix}.db");
    let target = dir.join(&file_name);
    if target.exists() {
        std::fs::remove_file(&target)?;
    }
    db.checkpoint()?;
    let target_str = target.to_string_lossy().replace('\'', "''");
    db.connection()
        .execute(&format!("VACUUM INTO '{target_str}'"), [])?;
    let verified = verify(&target)?;
    if !verified {
        std::fs::remove_file(&target)?;
        return Err(CoreError::Other("backup failed integrity check".into()));
    }
    let meta = std::fs::metadata(&target)?;
    Ok(BackupInfo {
        path: target.to_string_lossy().to_string(),
        file_name,
        size_bytes: meta.len(),
        created_at: crate::db::now_ts(),
        verified,
    })
}

pub fn verify(path: &Path) -> CoreResult<bool> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let s: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let has_offices: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='offices'",
        [],
        |r| r.get(0),
    )?;
    Ok(s == "ok" && has_offices == 1)
}

pub fn list(dir: &Path) -> CoreResult<Vec<BackupInfo>> {
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(BACKUP_PREFIX) || !name.ends_with(".db") {
            continue;
        }
        let meta = entry.metadata()?;
        let created: chrono::DateTime<chrono::Utc> = meta
            .modified()
            .map(Into::into)
            .unwrap_or_else(|_| chrono::Utc::now());
        out.push(BackupInfo {
            path: entry.path().to_string_lossy().to_string(),
            file_name: name,
            size_bytes: meta.len(),
            created_at: created.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            verified: true,
        });
    }
    out.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    Ok(out)
}

/// Keep only the newest `keep` snapshots in the folder.
pub fn prune(dir: &Path, keep: usize) -> CoreResult<usize> {
    let all = list(dir)?;
    let mut removed = 0;
    for b in all.iter().skip(keep) {
        std::fs::remove_file(&b.path)?;
        removed += 1;
    }
    Ok(removed)
}

/// Restore `source` over `live_db_path`. A safety snapshot of the live database
/// is written to `safety_dir` first. The caller must close the live connection
/// before calling this and reopen afterwards.
pub fn restore(source: &Path, live_db_path: &Path, safety_dir: &Path) -> CoreResult<PathBuf> {
    if !verify(source)? {
        return Err(CoreError::Validation(
            "selected file failed SQLite integrity checking".into(),
        ));
    }
    std::fs::create_dir_all(safety_dir)?;
    let stamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let safety = safety_dir.join(format!("{BACKUP_PREFIX}{stamp}_pre_restore.db"));
    if live_db_path.exists() {
        let live = Connection::open(live_db_path)?;
        live.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        let s = safety.to_string_lossy().replace('\'', "''");
        live.execute(&format!("VACUUM INTO '{s}'"), [])?;
        drop(live);
    }
    for ext in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{}", live_db_path.to_string_lossy(), ext));
        if side.exists() {
            std::fs::remove_file(side)?;
        }
    }
    std::fs::copy(source, live_db_path)?;
    Ok(safety)
}

fn sanitize(label: &str) -> String {
    label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .take(24)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Actor;

    #[test]
    fn snapshot_list_prune_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("data").join("handtohand.db");
        let db = Database::open(&db_path).unwrap();
        assert_eq!(db.journal_mode().unwrap(), "wal");
        let actor = Actor::system();
        db.set_setting("x", "y").unwrap();
        let backup_dir = tmp.path().join("Automatic Backup");
        let b1 = snapshot(&db, &backup_dir, "close").unwrap();
        assert!(b1.verified);
        assert!(Path::new(&b1.path).exists());
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let _b2 = snapshot(&db, &backup_dir, "manual").unwrap();
        assert_eq!(list(&backup_dir).unwrap().len(), 2);
        assert_eq!(prune(&backup_dir, 1).unwrap(), 1);
        assert_eq!(list(&backup_dir).unwrap().len(), 1);
        drop(db);
        let _ = actor;
        let safety = restore(
            Path::new(&list(&backup_dir).unwrap()[0].path),
            &db_path,
            &backup_dir,
        )
        .unwrap();
        assert!(safety.exists());
        let db2 = Database::open(&db_path).unwrap();
        assert_eq!(db2.get_setting("x").unwrap().as_deref(), Some("y"));
    }
}
