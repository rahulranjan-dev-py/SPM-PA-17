/**
 * ESC/POS + plain-text slip builders. Bytes are spooled RAW by the Rust core
 * (network 9100, device path, or Windows spooler).
 */
import type { DailyClosing, DenominationLine, Handover, Office, VoucherItem } from "../types";
import { Money, type Paise } from "../money";
import { voucherTypeLabel } from "../constants";
import { formatDateShort } from "../utils";

const ESC = 0x1b, GS = 0x1d;

export class EscPos {
  private parts: number[] = [ESC, 0x40];
  private enc = new TextEncoder();
  text(s: string) { this.parts.push(...this.enc.encode(s)); return this; }
  line(s = "") { return this.text(`${s}\n`); }
  align(a: 0 | 1 | 2) { this.parts.push(ESC, 0x61, a); return this; }
  bold(on: boolean) { this.parts.push(ESC, 0x45, on ? 1 : 0); return this; }
  double(on: boolean) { this.parts.push(GS, 0x21, on ? 0x11 : 0x00); return this; }
  feed(n = 1) { this.parts.push(ESC, 0x64, n); return this; }
  cut() { this.parts.push(GS, 0x56, 0x42, 0x00); return this; }
  bytes(): Uint8Array { return new Uint8Array(this.parts); }
}

export function padColumns(left: string, right: string, width: number): string {
  const l = [...left].slice(0, Math.max(0, width - [...right].length - 1)).join("");
  const fill = Math.max(0, width - [...l].length - [...right].length);
  return `${l}${" ".repeat(fill)}${right}`;
}

const rs = (p: Paise) => Money.format(p);

/** 42-column thermal receipt for a counter hand-over. */
export function handoverSlipText(office: Office, handover: Handover, vouchers: VoucherItem[], physical: Paise, width = 42): string[] {
  const receipts = vouchers.filter((v) => v.flow === "receipt").reduce((a, v) => a + v.amount, 0);
  const payments = vouchers.filter((v) => v.flow === "payment").reduce((a, v) => a + v.amount, 0);
  const lines = [
    "HAND-TO-HAND RECEIPT",
    `${office.name} ${office.pincode}`,
    `${formatDateShort(handover.business_date)}  ${handover.counter_label} #${handover.sequence_no}`,
    "-".repeat(width),
  ];
  for (const v of vouchers) {
    lines.push(padColumns(`${voucherTypeLabel(v.voucher_type)} x${v.voucher_count} ${v.flow === "receipt" ? "R" : "P"}`, rs(v.amount), width));
    if (v.account_or_barcode_id) lines.push(`  ${v.account_or_barcode_id}`);
  }
  lines.push("-".repeat(width));
  lines.push(padColumns("RECEIPTS", rs(receipts), width));
  lines.push(padColumns("PAYMENTS", rs(payments), width));
  lines.push(padColumns("CASH HANDED", rs(physical), width));
  lines.push("-".repeat(width));
  lines.push(`Status: ${handover.status.toUpperCase()}`);
  lines.push("PA sign: ______________");
  lines.push("SPM sign: _____________");
  return lines;
}

export function handoverSlipEscPos(office: Office, handover: Handover, vouchers: VoucherItem[], physical: Paise): Uint8Array {
  const p = new EscPos().align(1).bold(true).double(true).line("HAND-TO-HAND").double(false).bold(false).align(0);
  for (const l of handoverSlipText(office, handover, vouchers, physical).slice(1)) p.line(l);
  return p.feed(3).cut().bytes();
}

/** 80-column dot-matrix layout for the daily closing. */
export function closingSheetText(office: Office, closing: DailyClosing, denominations: DenominationLine[], width = 80): string {
  const lines = [
    "DEPARTMENT OF POSTS - DAILY HAND-TO-HAND CLOSING SHEET".padStart((width + 54) / 2),
    `${office.name} (${office.pincode})  Division: ${office.division}  Date: ${formatDateShort(closing.business_date)}`,
    "=".repeat(width),
    padColumns("Opening balance", rs(closing.opening_balance), width),
    padColumns("Total receipts / deposits", rs(closing.total_receipts), width),
    padColumns("Total payments / withdrawals", rs(closing.total_payments), width),
    padColumns("CLOSING BALANCE (book)", rs(closing.closing_balance), width),
    padColumns("System book balance (Finacle/SAP)", closing.system_book_balance != null ? rs(closing.system_book_balance) : "n/a", width),
    padColumns("Physical cash (denomination count)", rs(closing.physical_cash), width),
    padColumns("VARIANCE (physical - book)", Money.signed(closing.variance), width),
    "-".repeat(width),
    "DENOMINATION WISE",
  ];
  for (const l of denominations.filter((d) => d.amount > 0)) {
    const label = l.kind === "mixed_coins" ? "Mixed coins" : l.kind === "citem" ? "Cash items (CITEM)" : `Rs ${l.face_value_paise / 100} x ${l.quantity}`;
    lines.push(padColumns(label, rs(l.amount), width));
  }
  lines.push("=".repeat(width));
  lines.push(`Status: ${closing.status.toUpperCase()}   ${closing.remarks}`);
  lines.push("");
  lines.push(`Signature of ${office.postmaster_designation}: ____________________        Treasurer / PA: ____________________`);
  return `${lines.join("\r\n")}\r\n\f`;
}
