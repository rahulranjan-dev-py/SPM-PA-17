/** Excel workbooks for divisional audits (ExcelJS, browser build). */
import ExcelJS from "exceljs";
import type { AuditLog, SmrReport, VoucherItem } from "../types";
import { Money } from "../money";
import { CATEGORY_LABELS, voucherTypeLabel } from "../constants";

const money = "#,##0.00";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF5" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

export async function buildSmrWorkbook(reports: SmrReport[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HandToHand X";
  const hub = wb.addWorksheet("SMR Hub");
  hub.columns = [
    { header: "Office", key: "office", width: 28 },
    { header: "Pincode", key: "pincode", width: 10 },
    { header: "Facility ID", key: "facility", width: 16 },
    { header: "Month", key: "month", width: 10 },
    { header: "Status", key: "status", width: 20 },
    { header: "Working days", key: "wd", width: 12 },
    { header: "Days recorded", key: "dr", width: 12 },
    { header: "Pending vouchers", key: "pv", width: 14 },
    { header: "Max breaches", key: "mx", width: 12 },
    { header: "Min breaches", key: "mn", width: 12 },
    { header: "Opening balance", key: "ob", width: 16, style: { numFmt: money } },
    { header: "Closing balance", key: "cb", width: 16, style: { numFmt: money } },
    { header: "Cash received", key: "cr", width: 16, style: { numFmt: money } },
    { header: "Cash remitted", key: "cm", width: 16, style: { numFmt: money } },
    { header: "Flags", key: "flags", width: 60 },
  ];
  styleHeader(hub.getRow(1));
  for (const r of reports) {
    hub.addRow({
      office: r.office.name, pincode: r.office.pincode, facility: r.office.facility_id, month: r.month, status: r.status.replace(/_/g, " "),
      wd: r.totals.working_days, dr: r.totals.days_recorded, pv: r.totals.pending_vouchers, mx: r.totals.max_breaches, mn: r.totals.min_breaches,
      ob: Money.toRupeeNumber(r.opening_balance_of_month), cb: Money.toRupeeNumber(r.closing_balance_of_month), cr: Money.toRupeeNumber(r.totals.cash_received), cm: Money.toRupeeNumber(r.totals.cash_remitted),
      flags: r.flags.join("; "),
    });
  }
  for (const r of reports) {
    const ws = wb.addWorksheet(r.office.name.slice(0, 28).replace(/[\\/?*[\]:]/g, " "));
    ws.addRow([`SPM Monthly Report (PA-17) — ${r.office.name} — ${r.month_label}`]).font = { bold: true, size: 13 };
    ws.addRow([`Opening balance of month: ${Money.format(r.opening_balance_of_month)}`, "", `Max limit: ${Money.format(r.office.max_cash_limit)}`, "", `Min limit: ${Money.format(r.office.min_cash_limit)}`]);
    ws.addRow([]);
    const headerRow = ws.addRow(["Date", "Holiday", "Opening", "Receipts", "Payments", "Closing", "Cash received", "Cash remitted", "Stamps received", "Stamps remitted", "Postage stamps", "Revenue stamps", "Other stamps", "Cash in hand", "Balance due to PO", "Variance", "Pending vouchers", "Closed", "Max breach", "Min breach", "Liabilities / explanation"]);
    styleHeader(headerRow);
    for (const d of r.rows) {
      const row = ws.addRow([
        d.date, d.is_holiday ? "H" : "", Money.toRupeeNumber(d.opening_balance), Money.toRupeeNumber(d.total_receipts), Money.toRupeeNumber(d.total_payments), Money.toRupeeNumber(d.closing_balance),
        Money.toRupeeNumber(d.cash_received), Money.toRupeeNumber(d.cash_remitted), Money.toRupeeNumber(d.stamps_received), Money.toRupeeNumber(d.stamps_remitted), Money.toRupeeNumber(d.postage_stamps),
        Money.toRupeeNumber(d.revenue_stamps), Money.toRupeeNumber(d.other_stamps), Money.toRupeeNumber(d.cash_in_hand), Money.toRupeeNumber(d.balance_due_to_po), Money.toRupeeNumber(d.variance),
        d.pending_vouchers, d.day_closed ? "Y" : "", d.max_breach !== null ? Money.toRupeeNumber(d.max_breach) : "", d.min_breach !== null ? Money.toRupeeNumber(d.min_breach) : "", d.liabilities_note,
      ]);
      for (let c = 3; c <= 16; c++) row.getCell(c).numFmt = money;
      if (d.max_breach !== null || d.min_breach !== null) row.font = { color: { argb: "FFB42318" } };
    }
    const t = ws.addRow(["TOTAL", "", "", Money.toRupeeNumber(r.totals.total_receipts), Money.toRupeeNumber(r.totals.total_payments), Money.toRupeeNumber(r.closing_balance_of_month), Money.toRupeeNumber(r.totals.cash_received), Money.toRupeeNumber(r.totals.cash_remitted), Money.toRupeeNumber(r.totals.stamps_received), Money.toRupeeNumber(r.totals.stamps_remitted)]);
    t.font = { bold: true };
    for (let c = 3; c <= 10; c++) t.getCell(c).numFmt = money;
    ws.columns.forEach((col, i) => (col.width = i === 0 ? 12 : i === 20 ? 50 : 14));
    if (r.stock.length) {
      ws.addRow([]);
      styleHeader(ws.addRow(["Stock", "Opening", "Receipts", "Sales", "Closing"]));
      for (const s of r.stock) ws.addRow([s.category, Money.toRupeeNumber(s.opening), Money.toRupeeNumber(s.receipts), Money.toRupeeNumber(s.sales), Money.toRupeeNumber(s.closing)]);
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function buildLedgerWorkbook(officeName: string, businessDate: string, vouchers: VoucherItem[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vouchers");
  ws.addRow([`Hand-to-Hand vouchers — ${officeName} — ${businessDate}`]).font = { bold: true, size: 13 };
  styleHeader(ws.addRow(["Category", "Type", "Flow", "Account / Barcode", "Vouchers", "Amount", "Reference", "Status", "Submitted", "Verified at", "Remarks"]));
  for (const v of vouchers) {
    const r = ws.addRow([CATEGORY_LABELS[v.category], voucherTypeLabel(v.voucher_type), v.flow, v.account_or_barcode_id, v.voucher_count, Money.toRupeeNumber(v.amount), v.reference_id, v.verification_status, v.submitted_at, v.verified_at ?? "", v.remarks]);
    r.getCell(6).numFmt = money;
  }
  ws.columns.forEach((c, i) => (c.width = i === 3 ? 22 : 16));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function buildAuditWorkbook(logs: AuditLog[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Audit trail");
  styleHeader(ws.addRow(["#", "Occurred at", "User", "Role", "Action", "Entity", "Entity id", "Note", "Before", "After"]));
  for (const l of logs) ws.addRow([l.id, l.occurred_at, l.username, l.role, l.action, l.entity_type, l.entity_id, l.note, l.before_json ?? "", l.after_json ?? ""]);
  ws.columns.forEach((c, i) => (c.width = i >= 8 ? 60 : 18));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
