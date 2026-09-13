import type { SmrReport, VoucherItem } from "../types";
import { Money } from "../money";
import { CATEGORY_LABELS, voucherTypeLabel } from "../constants";

export function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;
}

export function vouchersCsv(vouchers: VoucherItem[]): string {
  return toCsv([
    ["category", "type", "flow", "account_or_barcode", "vouchers", "amount", "reference", "status", "submitted_at", "verified_at", "remarks"],
    ...vouchers.map((v) => [CATEGORY_LABELS[v.category], voucherTypeLabel(v.voucher_type), v.flow, v.account_or_barcode_id, v.voucher_count, Money.plain(v.amount), v.reference_id, v.verification_status, v.submitted_at, v.verified_at ?? "", v.remarks]),
  ]);
}

export function smrCsv(reports: SmrReport[]): string {
  const rows: (string | number)[][] = [["office", "pincode", "month", "date", "holiday", "opening", "receipts", "payments", "closing", "cash_received", "cash_remitted", "stamps_received", "stamps_remitted", "postage_stamps", "revenue_stamps", "other_stamps", "cash_in_hand", "balance_due_to_po", "variance", "pending_vouchers", "closed", "max_breach", "min_breach", "liabilities"]];
  for (const r of reports) {
    for (const d of r.rows) {
      rows.push([r.office.name, r.office.pincode, r.month, d.date, d.is_holiday ? 1 : 0, Money.plain(d.opening_balance), Money.plain(d.total_receipts), Money.plain(d.total_payments), Money.plain(d.closing_balance), Money.plain(d.cash_received), Money.plain(d.cash_remitted), Money.plain(d.stamps_received), Money.plain(d.stamps_remitted), Money.plain(d.postage_stamps), Money.plain(d.revenue_stamps), Money.plain(d.other_stamps), Money.plain(d.cash_in_hand), Money.plain(d.balance_due_to_po), Money.plain(d.variance), d.pending_vouchers, d.day_closed ? 1 : 0, d.max_breach !== null ? Money.plain(d.max_breach) : "", d.min_breach !== null ? Money.plain(d.min_breach) : "", d.liabilities_note]);
    }
  }
  return toCsv(rows);
}
