//! htoh-core: the business core of HandToHand X.
//!
//! * [`money`]    — fixed-point paise arithmetic (no floats, ever)
//! * [`tally`]    — denomination counting and the dual-tally comparator
//! * [`db`]       — SQLite (WAL) persistence, roles, audit trail
//! * [`smr`]      — PA-17 / SMR monthly aggregation and batch compilation
//! * [`backup`]   — verified database snapshots and restore
//! * [`printing`] — ESC/POS + RAW spooling for slip / dot-matrix printers
//! * [`barcode`]  — UPU S10 identifiers and wedge-scanner helpers

pub mod backup;
pub mod barcode;
pub mod db;
pub mod error;
pub mod models;
pub mod money;
pub mod printing;
pub mod smr;
pub mod tally;

pub use db::Database;
pub use error::{CoreError, CoreResult, ErrorPayload};
pub use models::*;
pub use money::Money;

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::tally::DenominationLine;

    fn setup() -> (Database, Actor, Actor, Office) {
        let db = Database::open_in_memory().unwrap();
        let (_, spm) = db
            .authenticate(db::DEFAULT_SUPERVISOR, db::DEFAULT_SUPERVISOR_PIN)
            .unwrap();
        let office = db
            .save_office(
                &spm,
                Office {
                    id: String::new(),
                    name: "Bhuj Kutch SO".into(),
                    pincode: "370001".into(),
                    facility_id: "PO37000100001".into(),
                    office_type: "SO".into(),
                    division: "Kachchh".into(),
                    min_cash_limit: Money::from_rupees(5_000),
                    max_cash_limit: Money::from_rupees(50_000),
                    register_start_date: Some("2026-08-01".into()),
                    initial_opening: Money::from_rupees(10_000),
                    active: true,
                    ..Default::default()
                },
            )
            .unwrap();
        let pa_user = db
            .create_user(
                &spm,
                "pa1",
                "Counter PA",
                Role::Operator,
                Some(&office.id),
                "2468",
            )
            .unwrap();
        let pa = Actor {
            user_id: Some(pa_user.id),
            username: "pa1".into(),
            role: Role::Operator,
        };
        (db, spm, pa, office)
    }

    fn voucher(category: VoucherCategory, vtype: &str, flow: Flow, amount: i64) -> VoucherInput {
        VoucherInput {
            category,
            voucher_type: vtype.into(),
            flow,
            account_or_barcode_id: String::new(),
            voucher_count: 1,
            amount: Money::from_rupees(amount),
            reference_id: String::new(),
            remarks: String::new(),
        }
    }

    #[test]
    fn opens_in_wal_mode_with_foreign_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Database::open(tmp.path().join("h.db")).unwrap();
        assert_eq!(db.journal_mode().unwrap(), "wal");
        let fk: i64 = db
            .connection()
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        assert!(db.integrity_check().unwrap());
    }

    #[test]
    fn roles_are_enforced() {
        let (db, spm, pa, office) = setup();
        assert!(matches!(
            db.save_office(&pa, office.clone()),
            Err(CoreError::Forbidden(_))
        ));
        assert!(matches!(
            db.create_user(&pa, "x", "x", Role::Operator, None, "1234"),
            Err(CoreError::Forbidden(_))
        ));
        assert!(db.authenticate("pa1", "0000").is_err());
        assert!(db.authenticate("pa1", "2468").is_ok());
        let _ = spm;
    }

    #[test]
    fn ledger_day_flow_and_limits() {
        let (db, spm, pa, office) = setup();
        let h = db
            .open_handover(&pa, &office.id, "2026-08-03", "Counter 1", "pa_to_spm")
            .unwrap();
        // same counter/date returns the same open sheet
        assert_eq!(
            db.open_handover(&pa, &office.id, "2026-08-03", "Counter 1", "pa_to_spm")
                .unwrap()
                .id,
            h.id
        );

        db.add_voucher(
            &pa,
            &h.id,
            voucher(VoucherCategory::SavingsBank, "SB", Flow::Receipt, 25_000),
        )
        .unwrap();
        db.add_voucher(
            &pa,
            &h.id,
            voucher(VoucherCategory::SavingsBank, "RD", Flow::Payment, 2_000),
        )
        .unwrap();
        db.add_voucher(
            &pa,
            &h.id,
            voucher(
                VoucherCategory::Remittances,
                "TREASURY_RECEIVED",
                Flow::Receipt,
                30_000,
            ),
        )
        .unwrap();
        let rejected = db
            .add_voucher(
                &pa,
                &h.id,
                voucher(VoucherCategory::Insurance, "PLI", Flow::Receipt, 999),
            )
            .unwrap();
        db.verify_voucher(
            &spm,
            &rejected.id,
            VerificationStatus::Rejected,
            "duplicate",
        )
        .unwrap();

        let c = db
            .get_daily_closing(&office.id, "2026-08-03")
            .unwrap()
            .unwrap();
        assert_eq!(c.opening_balance, Money::from_rupees(10_000));
        assert_eq!(c.total_receipts, Money::from_rupees(55_000));
        assert_eq!(c.total_payments, Money::from_rupees(2_000));
        assert_eq!(c.closing_balance, Money::from_rupees(63_000));
        // max limit is 50,000 -> breach logged
        let v = db.list_violations(&office.id, "2026-08").unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].limit_type, "max");
        assert_eq!(v[0].breach, Money::from_rupees(13_000));

        // chest count -> variance
        let lines = vec![
            DenominationLine::note(50_000, 120).unwrap(),
            DenominationLine::note(10_000, 30).unwrap(),
            DenominationLine::citem(Money::from_rupees(100)),
        ];
        let physical = db
            .save_denominations(&spm, &office.id, "2026-08-03", "chest", None, &lines)
            .unwrap();
        assert_eq!(physical.total, Money::from_rupees(63_100));
        let c = db
            .get_daily_closing(&office.id, "2026-08-03")
            .unwrap()
            .unwrap();
        assert_eq!(c.variance, Money::from_rupees(100));
        let t = tally::compare(c.closing_balance, c.physical_cash);
        assert_eq!(t.status, tally::TallyStatus::Surplus);

        // closing needs everything verified
        assert!(matches!(
            db.close_day(&spm, &office.id, "2026-08-03", ""),
            Err(CoreError::Validation(_))
        ));
        db.submit_handover(&pa, &h.id).unwrap();
        db.verify_handover(&spm, &h.id, true, "ok").unwrap();
        let closed = db
            .close_day(&spm, &office.id, "2026-08-03", "tallied")
            .unwrap();
        assert_eq!(closed.status, "closed");

        // next working day opens with previous closing; 2026-08-02 is a Sunday
        assert!(!db.is_working_day(&office.id, "2026-08-02").unwrap());
        let h2 = db
            .open_handover(&pa, &office.id, "2026-08-04", "Counter 1", "pa_to_spm")
            .unwrap();
        db.add_voucher(
            &pa,
            &h2.id,
            voucher(
                VoucherCategory::Remittances,
                "TREASURY_REMITTED",
                Flow::Payment,
                60_000,
            ),
        )
        .unwrap();
        let c2 = db
            .get_daily_closing(&office.id, "2026-08-04")
            .unwrap()
            .unwrap();
        assert_eq!(c2.opening_balance, Money::from_rupees(63_000));
        assert_eq!(c2.closing_balance, Money::from_rupees(3_000));
        assert_eq!(
            db.list_violations(&office.id, "2026-08")
                .unwrap()
                .iter()
                .filter(|v| v.limit_type == "min")
                .count(),
            1
        );

        // editing an earlier day rolls forward into later saved days
        db.reopen_day(&spm, &office.id, "2026-08-03", "correction")
            .unwrap();
        let vouchers = db.list_vouchers(&h.id).unwrap();
        let sb = vouchers.iter().find(|v| v.voucher_type == "SB").unwrap();
        db.update_voucher(
            &spm,
            &sb.id,
            voucher(VoucherCategory::SavingsBank, "SB", Flow::Receipt, 20_000),
        )
        .unwrap();
        let c2 = db
            .get_daily_closing(&office.id, "2026-08-04")
            .unwrap()
            .unwrap();
        assert_eq!(c2.opening_balance, Money::from_rupees(58_000));

        // audit trail exists and is immutable
        let logs = db.list_audit_logs(Some(&office.id), None, 500).unwrap();
        assert!(logs.iter().any(|l| l.action == "voucher.verify"));
        assert!(logs.iter().any(|l| l.action == "day.close"));
        assert!(logs.iter().any(|l| l.action == "cash.count"));
        let err = db
            .connection()
            .execute("DELETE FROM audit_logs", [])
            .unwrap_err();
        assert!(err.to_string().contains("immutable"));
        let err = db
            .connection()
            .execute("UPDATE audit_logs SET note='x'", [])
            .unwrap_err();
        assert!(err.to_string().contains("immutable"));
    }

    #[test]
    fn operator_cannot_touch_verified_vouchers() {
        let (db, spm, pa, office) = setup();
        let h = db
            .open_handover(&pa, &office.id, "2026-08-05", "Counter 2", "pa_to_spm")
            .unwrap();
        let v = db
            .add_voucher(
                &pa,
                &h.id,
                voucher(
                    VoucherCategory::MailsParcels,
                    "SPEED_POST",
                    Flow::Receipt,
                    120,
                ),
            )
            .unwrap();
        db.verify_voucher(&spm, &v.id, VerificationStatus::Accepted, "")
            .unwrap();
        assert!(matches!(
            db.delete_voucher(&pa, &v.id, "oops"),
            Err(CoreError::Forbidden(_))
        ));
        assert!(matches!(
            db.update_voucher(
                &pa,
                &v.id,
                voucher(
                    VoucherCategory::MailsParcels,
                    "SPEED_POST",
                    Flow::Receipt,
                    1
                )
            ),
            Err(CoreError::Forbidden(_))
        ));
        db.delete_voucher(&spm, &v.id, "supervisor removal")
            .unwrap();
        assert!(db.list_vouchers(&h.id).unwrap().is_empty());
        let logs = db.list_audit_logs(None, Some("voucher"), 10).unwrap();
        assert_eq!(logs[0].action, "voucher.delete");
        assert!(logs[0]
            .before_json
            .as_deref()
            .unwrap()
            .contains("SPEED_POST"));
    }

    #[test]
    fn smr_batch_compiles_all_offices() {
        let (db, spm, pa, office) = setup();
        let office2 = db
            .save_office(
                &spm,
                Office {
                    name: "Mandvi SO".into(),
                    pincode: "370465".into(),
                    max_cash_limit: Money::from_rupees(80_000),
                    register_start_date: Some("2026-08-01".into()),
                    initial_opening: Money::from_rupees(1_000),
                    active: true,
                    ..Default::default()
                },
            )
            .unwrap();
        let h = db
            .open_handover(&pa, &office.id, "2026-08-03", "Counter 1", "pa_to_spm")
            .unwrap();
        db.add_voucher(
            &pa,
            &h.id,
            voucher(
                VoucherCategory::Remittances,
                "TREASURY_RECEIVED",
                Flow::Receipt,
                20_000,
            ),
        )
        .unwrap();
        db.add_voucher(
            &pa,
            &h.id,
            voucher(VoucherCategory::SavingsBank, "SB", Flow::Payment, 5_000),
        )
        .unwrap();
        db.save_denominations(
            &pa,
            &office.id,
            "2026-08-03",
            "chest",
            None,
            &[DenominationLine::note(50_000, 50).unwrap()],
        )
        .unwrap();
        db.save_smr_entry(
            &pa,
            SmrEntry {
                office_id: office.id.clone(),
                report_month: "2026-08".into(),
                business_date: "2026-08-03".into(),
                stamps_received: Money::from_rupees(500),
                postage_stamps: Money::from_rupees(1_200),
                liabilities_note: "Excess due to late remittance".into(),
                ..Default::default()
            },
        )
        .unwrap();
        db.save_stamp_stock(
            &spm,
            &office.id,
            "2026-08",
            "postage",
            Money::from_rupees(1_000),
            Money::from_rupees(500),
            Money::from_rupees(300),
        )
        .unwrap();

        let (summaries, reports) = smr::compile_batch(&db, &spm, "2026-08").unwrap();
        assert_eq!(summaries.len(), 2);
        let r = reports.iter().find(|r| r.office.id == office.id).unwrap();
        assert_eq!(r.rows.len(), 31);
        assert_eq!(r.opening_balance_of_month, Money::from_rupees(10_000));
        let day = r.rows.iter().find(|d| d.date == "2026-08-03").unwrap();
        assert_eq!(day.cash_received, Money::from_rupees(20_000));
        assert_eq!(day.closing_balance, Money::from_rupees(25_000));
        assert_eq!(day.cash_in_hand, Money::from_rupees(25_000));
        assert_eq!(day.balance_due_to_po, Money::from_rupees(25_000));
        assert_eq!(day.stamps_received, Money::from_rupees(500));
        assert_eq!(day.liabilities_note, "Excess due to late remittance");
        assert!(
            r.rows
                .iter()
                .find(|d| d.date == "2026-08-02")
                .unwrap()
                .is_holiday
        );
        assert_eq!(r.status, smr::SmrStatus::PendingVouchers);
        assert_eq!(r.closing_balance_of_month, Money::from_rupees(25_000));
        assert_eq!(r.sectioned_stamp_balance, Money::from_rupees(1_200));
        assert_eq!(r.stock[0].closing, Money::from_rupees(1_200));
        let r2 = reports.iter().find(|r| r.office.id == office2.id).unwrap();
        assert_eq!(r2.status, smr::SmrStatus::NoData);
        assert!(db
            .get_smr_report_payload(&office.id, "2026-08")
            .unwrap()
            .is_some());

        // sign-off locks operator edits
        db.sign_off_smr(&spm, &office.id, "2026-08").unwrap();
        let locked = db.save_smr_entry(
            &pa,
            SmrEntry {
                office_id: office.id.clone(),
                report_month: "2026-08".into(),
                business_date: "2026-08-04".into(),
                ..Default::default()
            },
        );
        assert!(matches!(locked, Err(CoreError::Forbidden(_))));
        let (summaries, _) = smr::compile_batch(&db, &spm, "2026-08").unwrap();
        assert!(
            summaries
                .iter()
                .find(|s| s.office_id == office.id)
                .unwrap()
                .signed_off
        );
    }
}
