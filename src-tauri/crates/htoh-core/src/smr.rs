//! SMR (Sub Postmaster's Monthly Report) — the PA-17 aggregation engine.
//!
//! For each office and month we build one row per calendar day from the
//! saved daily closings, the chest count, the manual PA-17 columns
//! (`smr_entries`) and the cash-limit violation log, then compile the whole
//! batch for every registered Sub Office in one call.

use crate::db::{validate_month, Database};
use crate::error::CoreResult;
use crate::models::{Actor, CashLimitViolation, Office, SmrEntry, StampStock};
use crate::money::Money;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmrStatus {
    /// Every working day closed, no pending vouchers, no limit breach
    Ready,
    /// Some vouchers are still pending verification / days not closed
    PendingVouchers,
    /// At least one working day breached the max / min cash limit
    CashLimitBreached,
    /// Nothing recorded for the month
    NoData,
}

impl SmrStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SmrStatus::Ready => "ready",
            SmrStatus::PendingVouchers => "pending_vouchers",
            SmrStatus::CashLimitBreached => "cash_limit_breached",
            SmrStatus::NoData => "no_data",
        }
    }
}

/// One PA-17 line (a calendar day).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SmrDayRow {
    pub date: String,
    pub day: u32,
    pub weekday: String,
    pub is_holiday: bool,
    pub has_record: bool,
    pub opening_balance: Money,
    pub total_receipts: Money,
    pub total_payments: Money,
    pub closing_balance: Money,
    /// Cash received from HO / treasury (TREASURY_RECEIVED vouchers, or manual override)
    pub cash_received: Money,
    /// Cash remitted to HO / treasury (TREASURY_REMITTED vouchers, or manual override)
    pub cash_remitted: Money,
    pub stamps_received: Money,
    pub stamps_remitted: Money,
    pub postage_stamps: Money,
    pub revenue_stamps: Money,
    pub other_stamps: Money,
    /// Physical chest cash minus cash items (legacy: Cash on Hand − CITEM)
    pub cash_in_hand: Money,
    /// Legacy rule: balance due to PO = cash on hand
    pub balance_due_to_po: Money,
    pub liabilities_note: String,
    pub variance: Money,
    pub pending_vouchers: i64,
    pub day_closed: bool,
    pub max_breach: Option<Money>,
    pub min_breach: Option<Money>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SmrTotals {
    pub total_receipts: Money,
    pub total_payments: Money,
    pub cash_received: Money,
    pub cash_remitted: Money,
    pub stamps_received: Money,
    pub stamps_remitted: Money,
    pub working_days: i64,
    pub days_recorded: i64,
    pub days_closed: i64,
    pub pending_vouchers: i64,
    pub max_breaches: i64,
    pub min_breaches: i64,
    pub highest_closing: Money,
    pub lowest_closing: Money,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SmrReport {
    pub office: Office,
    pub month: String,
    pub month_label: String,
    pub opening_balance_of_month: Money,
    pub closing_balance_of_month: Money,
    pub sectioned_stamp_balance: Money,
    pub rows: Vec<SmrDayRow>,
    pub totals: SmrTotals,
    pub violations: Vec<CashLimitViolation>,
    pub stock: Vec<StampStock>,
    pub status: SmrStatus,
    pub flags: Vec<String>,
    pub signed_off_by: Option<String>,
    pub signed_off_at: Option<String>,
    pub generated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SmrBatchSummary {
    pub office_id: String,
    pub office_name: String,
    pub month: String,
    pub status: SmrStatus,
    pub flags: Vec<String>,
    pub working_days: i64,
    pub days_recorded: i64,
    pub pending_vouchers: i64,
    pub violations: i64,
    pub closing_balance_of_month: Money,
    pub signed_off: bool,
}

pub fn month_days(month: &str) -> CoreResult<Vec<NaiveDate>> {
    validate_month(month)?;
    let first = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d").expect("validated");
    let mut days = Vec::new();
    let mut d = first;
    while d.month() == first.month() {
        days.push(d);
        d = d.succ_opt().expect("date range");
    }
    Ok(days)
}

pub fn month_label(month: &str) -> String {
    match NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d") {
        Ok(d) => d.format("%B %Y").to_string(),
        Err(_) => month.to_string(),
    }
}

/// Compile the PA-17 for a single office / month.
pub fn compile_office(db: &Database, office_id: &str, month: &str) -> CoreResult<SmrReport> {
    let office = db.get_office(office_id)?;
    let days = month_days(month)?;
    let closings: HashMap<String, _> = db
        .list_daily_closings(office_id, month)?
        .into_iter()
        .map(|c| (c.business_date.clone(), c))
        .collect();
    let entries: HashMap<String, SmrEntry> = db
        .list_smr_entries(office_id, month)?
        .into_iter()
        .map(|e| (e.business_date.clone(), e))
        .collect();
    let violations = db.list_violations(office_id, month)?;
    let stock = db.list_stamp_stock(office_id, month)?;
    let header = entries.get(month).cloned().unwrap_or_default();

    // treasury movements per day from vouchers (non-rejected)
    let mut treasury: HashMap<String, (Money, Money)> = HashMap::new();
    {
        let mut stmt = db.connection().prepare(
            "SELECT h.business_date,
                    COALESCE(SUM(CASE WHEN v.voucher_type='TREASURY_RECEIVED' AND v.flow='receipt' THEN v.amount_paise ELSE 0 END),0),
                    COALESCE(SUM(CASE WHEN v.voucher_type='TREASURY_REMITTED' AND v.flow='payment' THEN v.amount_paise ELSE 0 END),0)
             FROM voucher_items v JOIN handovers h ON h.id=v.handover_id
             WHERE h.office_id=?1 AND substr(h.business_date,1,7)=?2 AND v.verification_status<>'rejected' AND h.status<>'rejected'
             GROUP BY h.business_date",
        )?;
        let rows = stmt.query_map(rusqlite::params![office_id, month], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Money>(1)?,
                r.get::<_, Money>(2)?,
            ))
        })?;
        for row in rows {
            let (d, rec, rem) = row?;
            treasury.insert(d, (rec, rem));
        }
    }
    let mut pending_by_day: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = db.connection().prepare(
            "SELECT h.business_date, COALESCE(SUM(v.voucher_count),0) FROM voucher_items v JOIN handovers h ON h.id=v.handover_id
             WHERE h.office_id=?1 AND substr(h.business_date,1,7)=?2 AND v.verification_status='pending' GROUP BY h.business_date",
        )?;
        let rows = stmt.query_map(rusqlite::params![office_id, month], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (d, n) = row?;
            pending_by_day.insert(d, n);
        }
    }

    let first_day = days
        .first()
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default();
    let opening_balance_of_month = match header.opening_balance_of_month {
        Some(ob) => ob,
        None => db.opening_balance_for(office_id, &first_day)?,
    };

    let mut rows = Vec::with_capacity(days.len());
    let mut totals = SmrTotals {
        lowest_closing: Money::from_paise(i64::MAX),
        ..Default::default()
    };
    let mut running_closing = opening_balance_of_month;
    for d in &days {
        let date = d.format("%Y-%m-%d").to_string();
        let working = db.is_working_day(office_id, &date)?;
        let closing = closings.get(&date);
        let entry = entries.get(&date).cloned().unwrap_or_default();
        let (t_rec, t_rem) = treasury
            .get(&date)
            .copied()
            .unwrap_or((Money::ZERO, Money::ZERO));
        let chest = db.physical_cash(office_id, &date, "chest", None)?;
        let (max_breach, min_breach) = violations.iter().filter(|v| v.business_date == date).fold(
            (None, None),
            |(mx, mn), v| {
                if v.limit_type == "max" {
                    (Some(v.breach), mn)
                } else {
                    (mx, Some(v.breach))
                }
            },
        );
        let pending = pending_by_day.get(&date).copied().unwrap_or(0);
        let row = SmrDayRow {
            date: date.clone(),
            day: d.day(),
            weekday: d.format("%a").to_string(),
            is_holiday: !working,
            has_record: closing.is_some(),
            opening_balance: closing
                .map(|c| c.opening_balance)
                .unwrap_or(running_closing),
            total_receipts: closing.map(|c| c.total_receipts).unwrap_or(Money::ZERO),
            total_payments: closing.map(|c| c.total_payments).unwrap_or(Money::ZERO),
            closing_balance: closing
                .map(|c| c.closing_balance)
                .unwrap_or(running_closing),
            cash_received: entry.cash_received_override.unwrap_or(t_rec),
            cash_remitted: entry.cash_remitted_override.unwrap_or(t_rem),
            stamps_received: entry.stamps_received,
            stamps_remitted: entry.stamps_remitted,
            postage_stamps: entry.postage_stamps,
            revenue_stamps: entry.revenue_stamps,
            other_stamps: entry.other_stamps,
            cash_in_hand: chest.cash_in_hand,
            balance_due_to_po: chest.cash_in_hand,
            liabilities_note: entry.liabilities_note.clone(),
            variance: closing.map(|c| c.variance).unwrap_or(Money::ZERO),
            pending_vouchers: pending,
            day_closed: closing.map(|c| c.status == "closed").unwrap_or(false),
            max_breach,
            min_breach,
        };
        running_closing = row.closing_balance;
        if working {
            totals.working_days += 1;
        }
        if row.has_record {
            totals.days_recorded += 1;
            if row.closing_balance > totals.highest_closing {
                totals.highest_closing = row.closing_balance;
            }
            if row.closing_balance < totals.lowest_closing {
                totals.lowest_closing = row.closing_balance;
            }
        }
        if row.day_closed {
            totals.days_closed += 1;
        }
        totals.total_receipts += row.total_receipts;
        totals.total_payments += row.total_payments;
        totals.cash_received += row.cash_received;
        totals.cash_remitted += row.cash_remitted;
        totals.stamps_received += row.stamps_received;
        totals.stamps_remitted += row.stamps_remitted;
        totals.pending_vouchers += row.pending_vouchers;
        if row.max_breach.is_some() {
            totals.max_breaches += 1;
        }
        if row.min_breach.is_some() {
            totals.min_breaches += 1;
        }
        rows.push(row);
    }
    if totals.days_recorded == 0 {
        totals.lowest_closing = Money::ZERO;
    }

    let mut flags = Vec::new();
    if totals.days_recorded == 0 {
        flags.push("No daily records saved for this month".to_string());
    }
    if totals.pending_vouchers > 0 {
        flags.push(format!(
            "{} voucher(s) pending verification",
            totals.pending_vouchers
        ));
    }
    let unclosed = rows
        .iter()
        .filter(|r| !r.is_holiday && r.has_record && !r.day_closed)
        .count();
    if unclosed > 0 {
        flags.push(format!("{unclosed} working day(s) not closed by SPM"));
    }
    let missing = rows
        .iter()
        .filter(|r| !r.is_holiday && !r.has_record)
        .count();
    if missing > 0 && totals.days_recorded > 0 {
        flags.push(format!("{missing} working day(s) without a saved record"));
    }
    if totals.max_breaches > 0 {
        flags.push(format!(
            "Maximum cash limit exceeded on {} day(s)",
            totals.max_breaches
        ));
    }
    if totals.min_breaches > 0 {
        flags.push(format!(
            "Closing cash below minimum reserve on {} day(s)",
            totals.min_breaches
        ));
    }
    if office.max_cash_limit.is_zero() {
        flags.push("Maximum cash limit not configured for this office".to_string());
    }
    let status = if totals.days_recorded == 0 {
        SmrStatus::NoData
    } else if totals.max_breaches > 0 || totals.min_breaches > 0 {
        SmrStatus::CashLimitBreached
    } else if totals.pending_vouchers > 0 || unclosed > 0 {
        SmrStatus::PendingVouchers
    } else {
        SmrStatus::Ready
    };

    Ok(SmrReport {
        office,
        month: month.to_string(),
        month_label: month_label(month),
        opening_balance_of_month,
        closing_balance_of_month: running_closing,
        sectioned_stamp_balance: header
            .sectioned_stamp_balance
            .unwrap_or_else(|| stock.iter().map(|s| s.closing).sum()),
        rows,
        totals,
        violations,
        stock,
        status,
        flags,
        signed_off_by: header.signed_off_by,
        signed_off_at: header.signed_off_at,
        generated_at: crate::db::now_ts(),
    })
}

/// One-click batch: compile every active office for the month, persist the
/// snapshots, and return the hub summaries plus the full reports.
pub fn compile_batch(
    db: &Database,
    actor: &Actor,
    month: &str,
) -> CoreResult<(Vec<SmrBatchSummary>, Vec<SmrReport>)> {
    validate_month(month)?;
    let mut summaries = Vec::new();
    let mut reports = Vec::new();
    for office in db.list_offices(false)? {
        let report = compile_office(db, &office.id, month)?;
        db.save_smr_report(
            actor,
            &office.id,
            month,
            report.status.as_str(),
            &report.flags,
            &serde_json::to_string(&report)?,
        )?;
        summaries.push(summary_of(&report));
        reports.push(report);
    }
    Ok((summaries, reports))
}

pub fn summary_of(report: &SmrReport) -> SmrBatchSummary {
    SmrBatchSummary {
        office_id: report.office.id.clone(),
        office_name: report.office.name.clone(),
        month: report.month.clone(),
        status: report.status,
        flags: report.flags.clone(),
        working_days: report.totals.working_days,
        days_recorded: report.totals.days_recorded,
        pending_vouchers: report.totals.pending_vouchers,
        violations: report.totals.max_breaches + report.totals.min_breaches,
        closing_balance_of_month: report.closing_balance_of_month,
        signed_off: report.signed_off_at.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_days_and_labels() {
        assert_eq!(month_days("2026-02").unwrap().len(), 28);
        assert_eq!(month_days("2024-02").unwrap().len(), 29);
        assert_eq!(month_days("2026-08").unwrap().len(), 31);
        assert!(month_days("2026-13").is_err());
        assert_eq!(month_label("2026-08"), "August 2026");
    }
}
