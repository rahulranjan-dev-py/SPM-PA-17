import type { DenominationKind, Flow, StockCategory, VoucherCategory } from "./types";

export interface VoucherTypeDef {
  code: string;
  label: string;
  category: VoucherCategory;
  defaultFlow: Flow;
  /** Whether the operator may flip receipt/payment for this type */
  flowSwitchable: boolean;
  idLabel: string;
}

export const CATEGORY_LABELS: Record<VoucherCategory, string> = {
  savings_bank: "Savings Bank",
  mails_parcels: "Mails & Parcels",
  remittances: "Remittances",
  insurance: "PLI / RPLI",
};

export const CATEGORY_ORDER: VoucherCategory[] = ["savings_bank", "mails_parcels", "remittances", "insurance"];

export const VOUCHER_TYPES: VoucherTypeDef[] = [
  ...["SB", "RD", "TD", "MIS", "SCSS", "PPF", "SSA", "NSC", "KVP"].map((code) => ({
    code,
    label: code,
    category: "savings_bank" as VoucherCategory,
    defaultFlow: "receipt" as Flow,
    flowSwitchable: true,
    idLabel: "Account no.",
  })),
  { code: "RD_LOAN", label: "RD Loan", category: "savings_bank", defaultFlow: "payment", flowSwitchable: true, idLabel: "Account no." },
  { code: "SPEED_POST", label: "Speed Post", category: "mails_parcels", defaultFlow: "receipt", flowSwitchable: false, idLabel: "Article barcode" },
  { code: "REGISTERED", label: "Registered Post", category: "mails_parcels", defaultFlow: "receipt", flowSwitchable: false, idLabel: "Article barcode" },
  { code: "PARCEL", label: "Parcel", category: "mails_parcels", defaultFlow: "receipt", flowSwitchable: false, idLabel: "Article barcode" },
  { code: "COD", label: "COD", category: "mails_parcels", defaultFlow: "receipt", flowSwitchable: true, idLabel: "Article barcode" },
  { code: "STAMP_SALE", label: "Stamp Sale", category: "mails_parcels", defaultFlow: "receipt", flowSwitchable: false, idLabel: "Reference" },
  { code: "EMO_BOOKED", label: "eMO Booked", category: "remittances", defaultFlow: "receipt", flowSwitchable: false, idLabel: "eMO / PNR no." },
  { code: "EMO_PAID", label: "eMO Paid", category: "remittances", defaultFlow: "payment", flowSwitchable: false, idLabel: "eMO / PNR no." },
  { code: "TREASURY_RECEIVED", label: "Cash received from HO / Treasury", category: "remittances", defaultFlow: "receipt", flowSwitchable: false, idLabel: "Remittance advice no." },
  { code: "TREASURY_REMITTED", label: "Cash remitted to HO / Treasury", category: "remittances", defaultFlow: "payment", flowSwitchable: false, idLabel: "Remittance advice no." },
  { code: "IPPB_DEPOSIT", label: "IPPB Sweep-in (deposit)", category: "remittances", defaultFlow: "receipt", flowSwitchable: false, idLabel: "IPPB txn id" },
  { code: "IPPB_WITHDRAWAL", label: "IPPB Sweep-out (withdrawal)", category: "remittances", defaultFlow: "payment", flowSwitchable: false, idLabel: "IPPB txn id" },
  { code: "PLI", label: "PLI premium", category: "insurance", defaultFlow: "receipt", flowSwitchable: true, idLabel: "Policy no." },
  { code: "RPLI", label: "RPLI premium", category: "insurance", defaultFlow: "receipt", flowSwitchable: true, idLabel: "Policy no." },
];

export function voucherTypeDef(code: string): VoucherTypeDef | undefined {
  return VOUCHER_TYPES.find((v) => v.code === code);
}

export function voucherTypeLabel(code: string): string {
  return voucherTypeDef(code)?.label ?? code;
}

export interface DenominationSlot {
  key: string;
  kind: DenominationKind;
  faceValue: number; // paise
  label: string;
}

export const DENOMINATION_SLOTS: DenominationSlot[] = [
  { key: "n500", kind: "note", faceValue: 50000, label: "₹500" },
  { key: "n200", kind: "note", faceValue: 20000, label: "₹200" },
  { key: "n100", kind: "note", faceValue: 10000, label: "₹100" },
  { key: "n50", kind: "note", faceValue: 5000, label: "₹50" },
  { key: "n20", kind: "note", faceValue: 2000, label: "₹20" },
  { key: "n10", kind: "note", faceValue: 1000, label: "₹10" },
  { key: "c5", kind: "coin", faceValue: 500, label: "₹5" },
  { key: "c2", kind: "coin", faceValue: 200, label: "₹2" },
  { key: "c1", kind: "coin", faceValue: 100, label: "₹1" },
  { key: "mixed", kind: "mixed_coins", faceValue: 0, label: "Mixed coins" },
  { key: "citem", kind: "citem", faceValue: 0, label: "Cash items (CITEM)" },
];

export const STOCK_CATEGORIES: { key: StockCategory; label: string }[] = [
  { key: "postage", label: "Postage stamps" },
  { key: "revenue", label: "Revenue stamps" },
  { key: "commemorative", label: "Commemorative stamps" },
  { key: "stationery", label: "Postal stationery" },
];

export const HOTKEYS = [
  { key: "F2", label: "Cash denomination calculator" },
  { key: "F3", label: "New voucher / article" },
  { key: "F5", label: "Refresh & recalculate balance" },
  { key: "F9", label: "Tally & verification" },
  { key: "F10", label: "Closing sheet / SMR export" },
];
