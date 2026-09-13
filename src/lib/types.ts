import type { Paise } from "./money";

export type Role = "operator" | "supervisor";
export type VoucherCategory = "savings_bank" | "mails_parcels" | "remittances" | "insurance";
export type Flow = "receipt" | "payment";
export type VerificationStatus = "pending" | "accepted" | "rejected";
export type HandoverStatus = "open" | "submitted" | "verified" | "rejected";
export type DenominationKind = "note" | "coin" | "mixed_coins" | "citem";
export type SmrStatus = "ready" | "pending_vouchers" | "cash_limit_breached" | "no_data";
export type StockCategory = "postage" | "revenue" | "commemorative" | "stationery";

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  office_id: string | null;
  active: boolean;
  last_login_at: string | null;
}

export interface Actor {
  user_id: string | null;
  username: string;
  role: Role;
}

export interface Session {
  user: User;
  actor: Actor;
  must_change_pin: boolean;
  signed_in_at: string;
}

export interface Office {
  id: string;
  name: string;
  pincode: string;
  facility_id: string;
  office_type: string;
  division: string;
  sub_division: string;
  head_office: string;
  postmaster_name: string;
  postmaster_designation: string;
  postmaster_phone: string;
  min_cash_limit: Paise;
  max_cash_limit: Paise;
  register_start_date: string | null;
  initial_opening: Paise;
  active: boolean;
}

export interface Handover {
  id: string;
  office_id: string;
  business_date: string;
  counter_label: string;
  sequence_no: number;
  direction: string;
  from_user_id: string | null;
  to_user_id: string | null;
  status: HandoverStatus;
  system_book_balance: Paise | null;
  physical_cash: Paise | null;
  notes: string;
  submitted_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoucherItem {
  id: string;
  handover_id: string;
  category: VoucherCategory;
  voucher_type: string;
  flow: Flow;
  account_or_barcode_id: string;
  voucher_count: number;
  amount: Paise;
  reference_id: string;
  submitted_at: string;
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  remarks: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoucherInput {
  category: VoucherCategory;
  voucher_type: string;
  flow: Flow;
  account_or_barcode_id: string;
  voucher_count: number;
  amount: Paise;
  reference_id: string;
  remarks: string;
}

export interface DenominationLine {
  kind: DenominationKind;
  face_value_paise: number;
  quantity: number;
  amount: Paise;
}

export interface PhysicalCash {
  total: Paise;
  cash_in_hand: Paise;
  citem: Paise;
  note_count: number;
  coin_count: number;
}

export interface TallyResult {
  system_book_balance: Paise;
  physical_cash: Paise;
  variance: Paise;
  status: "balanced" | "surplus" | "deficit";
  badge: string;
}

export interface DailyClosing {
  office_id: string;
  business_date: string;
  opening_balance: Paise;
  total_receipts: Paise;
  total_payments: Paise;
  closing_balance: Paise;
  system_book_balance: Paise | null;
  physical_cash: Paise;
  variance: Paise;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: string | null;
  remarks: string;
  is_holiday: boolean;
}

export interface CashLimitViolation {
  id: string;
  office_id: string;
  business_date: string;
  limit_type: "max" | "min";
  limit: Paise;
  closing_balance: Paise;
  breach: Paise;
  detected_at: string;
}

export interface SmrEntry {
  office_id: string;
  report_month: string;
  business_date: string;
  stamps_received: Paise;
  stamps_remitted: Paise;
  postage_stamps: Paise;
  revenue_stamps: Paise;
  other_stamps: Paise;
  cash_received_override: Paise | null;
  cash_remitted_override: Paise | null;
  liabilities_note: string;
  opening_balance_of_month: Paise | null;
  sectioned_stamp_balance: Paise | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
}

export interface StampStock {
  office_id: string;
  report_month: string;
  category: StockCategory;
  opening: Paise;
  receipts: Paise;
  sales: Paise;
  closing: Paise;
}

export interface SmrDayRow {
  date: string;
  day: number;
  weekday: string;
  is_holiday: boolean;
  has_record: boolean;
  opening_balance: Paise;
  total_receipts: Paise;
  total_payments: Paise;
  closing_balance: Paise;
  cash_received: Paise;
  cash_remitted: Paise;
  stamps_received: Paise;
  stamps_remitted: Paise;
  postage_stamps: Paise;
  revenue_stamps: Paise;
  other_stamps: Paise;
  cash_in_hand: Paise;
  balance_due_to_po: Paise;
  liabilities_note: string;
  variance: Paise;
  pending_vouchers: number;
  day_closed: boolean;
  max_breach: Paise | null;
  min_breach: Paise | null;
}

export interface SmrTotals {
  total_receipts: Paise;
  total_payments: Paise;
  cash_received: Paise;
  cash_remitted: Paise;
  stamps_received: Paise;
  stamps_remitted: Paise;
  working_days: number;
  days_recorded: number;
  days_closed: number;
  pending_vouchers: number;
  max_breaches: number;
  min_breaches: number;
  highest_closing: Paise;
  lowest_closing: Paise;
}

export interface SmrReport {
  office: Office;
  month: string;
  month_label: string;
  opening_balance_of_month: Paise;
  closing_balance_of_month: Paise;
  sectioned_stamp_balance: Paise;
  rows: SmrDayRow[];
  totals: SmrTotals;
  violations: CashLimitViolation[];
  stock: StampStock[];
  status: SmrStatus;
  flags: string[];
  signed_off_by: string | null;
  signed_off_at: string | null;
  generated_at: string;
}

export interface SmrBatchSummary {
  office_id: string;
  office_name: string;
  month: string;
  status: SmrStatus;
  flags: string[];
  working_days: number;
  days_recorded: number;
  pending_vouchers: number;
  violations: number;
  closing_balance_of_month: Paise;
  signed_off: boolean;
}

export interface SmrBatchResult {
  month: string;
  summaries: SmrBatchSummary[];
  reports: SmrReport[];
}

export interface AuditLog {
  id: number;
  occurred_at: string;
  office_id: string | null;
  user_id: string | null;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
  note: string;
}

export interface Holiday {
  office_id: string;
  holiday_date: string;
  note: string;
}

export interface BackupInfo {
  path: string;
  file_name: string;
  size_bytes: number;
  created_at: string;
  verified: boolean;
}

export interface AppInfo {
  version: string;
  data_dir: string;
  db_path: string;
  backup_dir: string;
  journal_mode: string;
  platform: string;
  last_auto_backup: string | null;
}

export interface DashboardSummary {
  office: Office;
  business_date: string;
  is_working_day: boolean;
  closing: DailyClosing | null;
  chest: PhysicalCash;
  tally: TallyResult | null;
  pending_vouchers: number;
  accepted_vouchers: number;
  rejected_vouchers: number;
  voucher_lines: number;
  handovers: Handover[];
  violations_this_month: number;
}

export type PrintTarget =
  | { kind: "network"; host: string; port: number }
  | { kind: "device"; path: string }
  | { kind: "windows_spooler"; printer_name: string }
  | { kind: "file"; path: string };

export interface BarcodeInfo {
  raw: string;
  normalized: string;
  kind: "s10" | "s10_bad_check_digit" | "domestic13" | "generic";
  suggested_voucher_type: string | null;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
