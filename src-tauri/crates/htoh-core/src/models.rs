//! Serializable domain records shared between the Rust core and the UI.

use crate::money::Money;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Operator,
    Supervisor,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Operator => "operator",
            Role::Supervisor => "supervisor",
        }
    }
    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "operator" => Some(Role::Operator),
            "supervisor" => Some(Role::Supervisor),
            _ => None,
        }
    }
}

/// Who is performing an action (attached to every audit row).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    pub user_id: Option<String>,
    pub username: String,
    pub role: Role,
}

impl Actor {
    pub fn system() -> Actor {
        Actor {
            user_id: None,
            username: "system".into(),
            role: Role::Supervisor,
        }
    }
    pub fn is_supervisor(&self) -> bool {
        self.role == Role::Supervisor
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub office_id: Option<String>,
    pub active: bool,
    pub last_login_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Office {
    pub id: String,
    pub name: String,
    pub pincode: String,
    pub facility_id: String,
    pub office_type: String,
    pub division: String,
    pub sub_division: String,
    pub head_office: String,
    pub postmaster_name: String,
    pub postmaster_designation: String,
    pub postmaster_phone: String,
    pub min_cash_limit: Money,
    pub max_cash_limit: Money,
    pub register_start_date: Option<String>,
    pub initial_opening: Money,
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Handover {
    pub id: String,
    pub office_id: String,
    pub business_date: String,
    pub counter_label: String,
    pub sequence_no: i64,
    pub direction: String,
    pub from_user_id: Option<String>,
    pub to_user_id: Option<String>,
    pub status: String,
    pub system_book_balance: Option<Money>,
    pub physical_cash: Option<Money>,
    pub notes: String,
    pub submitted_at: Option<String>,
    pub verified_by: Option<String>,
    pub verified_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoucherCategory {
    SavingsBank,
    MailsParcels,
    Remittances,
    Insurance,
}

impl VoucherCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            VoucherCategory::SavingsBank => "savings_bank",
            VoucherCategory::MailsParcels => "mails_parcels",
            VoucherCategory::Remittances => "remittances",
            VoucherCategory::Insurance => "insurance",
        }
    }
    pub fn parse(s: &str) -> Option<VoucherCategory> {
        match s {
            "savings_bank" => Some(VoucherCategory::SavingsBank),
            "mails_parcels" => Some(VoucherCategory::MailsParcels),
            "remittances" => Some(VoucherCategory::Remittances),
            "insurance" => Some(VoucherCategory::Insurance),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Flow {
    /// Cash comes into office cash (deposit, booking, treasury received)
    Receipt,
    /// Cash leaves office cash (withdrawal, MO paid, remittance to HO)
    Payment,
}

impl Flow {
    pub fn as_str(self) -> &'static str {
        match self {
            Flow::Receipt => "receipt",
            Flow::Payment => "payment",
        }
    }
    pub fn parse(s: &str) -> Option<Flow> {
        match s {
            "receipt" => Some(Flow::Receipt),
            "payment" => Some(Flow::Payment),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Pending,
    Accepted,
    Rejected,
}

impl VerificationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            VerificationStatus::Pending => "pending",
            VerificationStatus::Accepted => "accepted",
            VerificationStatus::Rejected => "rejected",
        }
    }
    pub fn parse(s: &str) -> Option<VerificationStatus> {
        match s {
            "pending" => Some(VerificationStatus::Pending),
            "accepted" => Some(VerificationStatus::Accepted),
            "rejected" => Some(VerificationStatus::Rejected),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoucherItem {
    pub id: String,
    pub handover_id: String,
    pub category: VoucherCategory,
    pub voucher_type: String,
    pub flow: Flow,
    pub account_or_barcode_id: String,
    pub voucher_count: i64,
    pub amount: Money,
    pub reference_id: String,
    pub submitted_at: String,
    pub verification_status: VerificationStatus,
    pub verified_by: Option<String>,
    pub verified_at: Option<String>,
    pub remarks: String,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Input from the UI when creating / editing a voucher line.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoucherInput {
    pub category: VoucherCategory,
    pub voucher_type: String,
    pub flow: Flow,
    #[serde(default)]
    pub account_or_barcode_id: String,
    #[serde(default = "one")]
    pub voucher_count: i64,
    pub amount: Money,
    #[serde(default)]
    pub reference_id: String,
    #[serde(default)]
    pub remarks: String,
}

fn one() -> i64 {
    1
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailyClosing {
    pub office_id: String,
    pub business_date: String,
    pub opening_balance: Money,
    pub total_receipts: Money,
    pub total_payments: Money,
    pub closing_balance: Money,
    pub system_book_balance: Option<Money>,
    pub physical_cash: Money,
    pub variance: Money,
    pub status: String,
    pub closed_by: Option<String>,
    pub closed_at: Option<String>,
    pub remarks: String,
    pub is_holiday: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashLimitViolation {
    pub id: String,
    pub office_id: String,
    pub business_date: String,
    pub limit_type: String,
    pub limit: Money,
    pub closing_balance: Money,
    pub breach: Money,
    pub detected_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SmrEntry {
    pub office_id: String,
    pub report_month: String,
    /// 'YYYY-MM-DD' for a day row, or 'YYYY-MM' for the month header row
    pub business_date: String,
    pub stamps_received: Money,
    pub stamps_remitted: Money,
    pub postage_stamps: Money,
    pub revenue_stamps: Money,
    pub other_stamps: Money,
    pub cash_received_override: Option<Money>,
    pub cash_remitted_override: Option<Money>,
    pub liabilities_note: String,
    pub opening_balance_of_month: Option<Money>,
    pub sectioned_stamp_balance: Option<Money>,
    pub signed_off_by: Option<String>,
    pub signed_off_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StampStock {
    pub office_id: String,
    pub report_month: String,
    pub category: String,
    pub opening: Money,
    pub receipts: Money,
    pub sales: Money,
    pub closing: Money,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditLog {
    pub id: i64,
    pub occurred_at: String,
    pub office_id: Option<String>,
    pub user_id: Option<String>,
    pub username: String,
    pub role: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Holiday {
    pub office_id: String,
    pub holiday_date: String,
    pub note: String,
}
