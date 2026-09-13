/**
 * In-memory implementation of the Api contract, used when the UI runs outside
 * Tauri (browser dev server, vitest). It reproduces the core's arithmetic and
 * role rules closely enough to exercise every screen; the Rust core remains
 * the source of truth for production behaviour.
 */
import type { Api } from "./ipc";
import type {
  AuditLog, CashLimitViolation, DailyClosing, DenominationLine, Handover, Holiday, Office, PhysicalCash, Session, SmrDayRow, SmrEntry, SmrReport, SmrTotals, StampStock,
  User, VoucherItem,
} from "./types";
import { compareTally, type Paise } from "./money";
import { classifyBarcode } from "./barcode";
import { isSunday } from "./utils";

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
let seq = 1;
const id = () => `mock-${seq++}`;

interface State {
  users: (User & { pin: string })[];
  offices: Office[];
  holidays: Holiday[];
  handovers: Handover[];
  vouchers: VoucherItem[];
  denominations: { officeId: string; date: string; scope: string; handoverId: string | null; lines: DenominationLine[] }[];
  closings: DailyClosing[];
  violations: CashLimitViolation[];
  smrEntries: SmrEntry[];
  stock: StampStock[];
  audit: AuditLog[];
  settings: Record<string, string>;
  session: Session | null;
}

export function createMockApi(): Api {
  const office1: Office = {
    id: "office-1", name: "Bhuj Kutch SO", pincode: "370001", facility_id: "PO37000100001", office_type: "SO", division: "Kachchh", sub_division: "Bhuj",
    head_office: "Bhuj HO", postmaster_name: "R. K. Patel", postmaster_designation: "SPM", postmaster_phone: "", min_cash_limit: 500000, max_cash_limit: 5000000,
    register_start_date: "2026-01-01", initial_opening: 1200000, active: true,
  };
  const office2: Office = { ...office1, id: "office-2", name: "Mandvi SO", pincode: "370465", facility_id: "PO37046500001", sub_division: "Mandvi", postmaster_name: "S. Joshi", max_cash_limit: 8000000, initial_opening: 800000 };
  const st: State = {
    users: [
      { id: "u-spm", username: "spm", display_name: "Sub Postmaster", role: "supervisor", office_id: null, active: true, last_login_at: null, pin: "1234" },
      { id: "u-pa1", username: "pa1", display_name: "Counter PA 1", role: "operator", office_id: "office-1", active: true, last_login_at: null, pin: "1111" },
    ],
    offices: [office1, office2],
    holidays: [],
    handovers: [],
    vouchers: [],
    denominations: [],
    closings: [],
    violations: [],
    smrEntries: [],
    stock: [],
    audit: [],
    settings: { must_change_default_pin: "0" },
    session: null,
  };

  const actor = () => {
    if (!st.session) throw { code: "forbidden", message: "sign in first" };
    return st.session.actor;
  };
  const supervisor = (what: string) => {
    const a = actor();
    if (a.role !== "supervisor") throw { code: "forbidden", message: `only a supervisor (SPM) can ${what}` };
    return a;
  };
  const log = (action: string, entityType: string, entityId: string, before?: unknown, after?: unknown, note = "") => {
    const a = st.session?.actor;
    st.audit.unshift({
      id: st.audit.length + 1, occurred_at: now(), office_id: null, user_id: a?.user_id ?? null, username: a?.username ?? "system", role: a?.role ?? "system",
      action, entity_type: entityType, entity_id: entityId, before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null, note,
    });
  };
  const office = (oid: string) => {
    const o = st.offices.find((x) => x.id === oid);
    if (!o) throw { code: "not_found", message: `office ${oid}` };
    return o;
  };
  const working = (oid: string, date: string) => !isSunday(date) && !st.holidays.some((h) => h.holiday_date === date && (h.office_id === "*" || h.office_id === oid));
  const physical = (lines: DenominationLine[]): PhysicalCash => {
    let total = 0, citem = 0, notes = 0, coins = 0;
    for (const l of lines) {
      total += l.amount;
      if (l.kind === "citem") citem += l.amount;
      if (l.kind === "note") notes += l.quantity;
      if (l.kind === "coin") coins += l.quantity;
    }
    return { total, cash_in_hand: total - citem, citem, note_count: notes, coin_count: coins };
  };
  const denoms = (oid: string, date: string, scope: string, hid: string | null) => st.denominations.find((d) => d.officeId === oid && d.date === date && d.scope === scope && (d.handoverId ?? null) === (hid ?? null))?.lines ?? [];
  const openingFor = (oid: string, date: string): Paise => {
    const prev = st.closings.filter((c) => c.office_id === oid && c.business_date < date).sort((a, b) => (a.business_date < b.business_date ? 1 : -1))[0];
    if (prev) return prev.closing_balance;
    const o = office(oid);
    return o.register_start_date && o.register_start_date <= date ? o.initial_opening : 0;
  };
  const recalc = (oid: string, date: string): DailyClosing => {
    const o = office(oid);
    let current = date;
    let first: DailyClosing | null = null;
    for (;;) {
      const opening = openingFor(oid, current);
      const hids = st.handovers.filter((h) => h.office_id === oid && h.business_date === current && h.status !== "rejected").map((h) => h.id);
      const vs = st.vouchers.filter((v) => hids.includes(v.handover_id) && v.verification_status !== "rejected");
      const receipts = vs.filter((v) => v.flow === "receipt").reduce((a, v) => a + v.amount, 0);
      const payments = vs.filter((v) => v.flow === "payment").reduce((a, v) => a + v.amount, 0);
      const closing = opening + receipts - payments;
      const phys = physical(denoms(oid, current, "chest", null));
      const existing = st.closings.find((c) => c.office_id === oid && c.business_date === current);
      const row: DailyClosing = {
        office_id: oid, business_date: current, opening_balance: opening, total_receipts: receipts, total_payments: payments, closing_balance: closing,
        system_book_balance: existing?.system_book_balance ?? null, physical_cash: phys.total, variance: phys.total - closing, status: existing?.status ?? "open",
        closed_by: existing?.closed_by ?? null, closed_at: existing?.closed_at ?? null, remarks: existing?.remarks ?? "", is_holiday: !working(oid, current),
      };
      if (existing) Object.assign(existing, row); else st.closings.push(row);
      st.violations = st.violations.filter((v) => !(v.office_id === oid && v.business_date === current));
      if (working(oid, current)) {
        if (o.max_cash_limit > 0 && closing > o.max_cash_limit) st.violations.push({ id: id(), office_id: oid, business_date: current, limit_type: "max", limit: o.max_cash_limit, closing_balance: closing, breach: closing - o.max_cash_limit, detected_at: now() });
        if (o.min_cash_limit > 0 && closing < o.min_cash_limit) st.violations.push({ id: id(), office_id: oid, business_date: current, limit_type: "min", limit: o.min_cash_limit, closing_balance: closing, breach: o.min_cash_limit - closing, detected_at: now() });
      }
      first ??= row;
      const next = st.closings.filter((c) => c.office_id === oid && c.business_date > current).sort((a, b) => (a.business_date < b.business_date ? -1 : 1))[0];
      if (!next) break;
      current = next.business_date;
    }
    return first!;
  };
  const voucher = (vid: string) => {
    const v = st.vouchers.find((x) => x.id === vid);
    if (!v) throw { code: "not_found", message: `voucher ${vid}` };
    return v;
  };
  const handover = (hid: string) => {
    const h = st.handovers.find((x) => x.id === hid);
    if (!h) throw { code: "not_found", message: `handover ${hid}` };
    return h;
  };
  const monthDays = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    const out: string[] = [];
    const d = new Date(y!, m! - 1, 1);
    while (d.getMonth() === m! - 1) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  };
  const compile = (oid: string, month: string): SmrReport => {
    const o = office(oid);
    const days = monthDays(month);
    const entries = st.smrEntries.filter((e) => e.office_id === oid && e.report_month === month);
    const header = entries.find((e) => e.business_date === month);
    const stock = st.stock.filter((s) => s.office_id === oid && s.report_month === month);
    const violations = st.violations.filter((v) => v.office_id === oid && v.business_date.startsWith(month));
    const opening = header?.opening_balance_of_month ?? openingFor(oid, days[0]!);
    let running = opening;
    const totals: SmrTotals = { total_receipts: 0, total_payments: 0, cash_received: 0, cash_remitted: 0, stamps_received: 0, stamps_remitted: 0, working_days: 0, days_recorded: 0, days_closed: 0, pending_vouchers: 0, max_breaches: 0, min_breaches: 0, highest_closing: 0, lowest_closing: Number.MAX_SAFE_INTEGER };
    const rows: SmrDayRow[] = days.map((date) => {
      const c = st.closings.find((x) => x.office_id === oid && x.business_date === date);
      const e = entries.find((x) => x.business_date === date);
      const hids = st.handovers.filter((h) => h.office_id === oid && h.business_date === date && h.status !== "rejected").map((h) => h.id);
      const vs = st.vouchers.filter((v) => hids.includes(v.handover_id) && v.verification_status !== "rejected");
      const tRec = vs.filter((v) => v.voucher_type === "TREASURY_RECEIVED" && v.flow === "receipt").reduce((a, v) => a + v.amount, 0);
      const tRem = vs.filter((v) => v.voucher_type === "TREASURY_REMITTED" && v.flow === "payment").reduce((a, v) => a + v.amount, 0);
      const pending = st.vouchers.filter((v) => hids.includes(v.handover_id) && v.verification_status === "pending").reduce((a, v) => a + v.voucher_count, 0);
      const chest = physical(denoms(oid, date, "chest", null));
      const isHoliday = !working(oid, date);
      const d = new Date(`${date}T00:00:00`);
      const row: SmrDayRow = {
        date, day: d.getDate(), weekday: d.toLocaleDateString("en-US", { weekday: "short" }), is_holiday: isHoliday, has_record: !!c,
        opening_balance: c?.opening_balance ?? running, total_receipts: c?.total_receipts ?? 0, total_payments: c?.total_payments ?? 0, closing_balance: c?.closing_balance ?? running,
        cash_received: e?.cash_received_override ?? tRec, cash_remitted: e?.cash_remitted_override ?? tRem, stamps_received: e?.stamps_received ?? 0, stamps_remitted: e?.stamps_remitted ?? 0,
        postage_stamps: e?.postage_stamps ?? 0, revenue_stamps: e?.revenue_stamps ?? 0, other_stamps: e?.other_stamps ?? 0, cash_in_hand: chest.cash_in_hand, balance_due_to_po: chest.cash_in_hand,
        liabilities_note: e?.liabilities_note ?? "", variance: c?.variance ?? 0, pending_vouchers: pending, day_closed: c?.status === "closed",
        max_breach: violations.find((v) => v.business_date === date && v.limit_type === "max")?.breach ?? null, min_breach: violations.find((v) => v.business_date === date && v.limit_type === "min")?.breach ?? null,
      };
      running = row.closing_balance;
      if (!isHoliday) totals.working_days++;
      if (row.has_record) { totals.days_recorded++; totals.highest_closing = Math.max(totals.highest_closing, row.closing_balance); totals.lowest_closing = Math.min(totals.lowest_closing, row.closing_balance); }
      if (row.day_closed) totals.days_closed++;
      totals.total_receipts += row.total_receipts; totals.total_payments += row.total_payments; totals.cash_received += row.cash_received; totals.cash_remitted += row.cash_remitted;
      totals.stamps_received += row.stamps_received; totals.stamps_remitted += row.stamps_remitted; totals.pending_vouchers += row.pending_vouchers;
      if (row.max_breach !== null) totals.max_breaches++;
      if (row.min_breach !== null) totals.min_breaches++;
      return row;
    });
    if (totals.days_recorded === 0) totals.lowest_closing = 0;
    const flags: string[] = [];
    if (totals.days_recorded === 0) flags.push("No daily records saved for this month");
    if (totals.pending_vouchers > 0) flags.push(`${totals.pending_vouchers} voucher(s) pending verification`);
    const unclosed = rows.filter((r) => !r.is_holiday && r.has_record && !r.day_closed).length;
    if (unclosed > 0) flags.push(`${unclosed} working day(s) not closed by SPM`);
    if (totals.max_breaches > 0) flags.push(`Maximum cash limit exceeded on ${totals.max_breaches} day(s)`);
    if (totals.min_breaches > 0) flags.push(`Closing cash below minimum reserve on ${totals.min_breaches} day(s)`);
    if (o.max_cash_limit === 0) flags.push("Maximum cash limit not configured for this office");
    const status = totals.days_recorded === 0 ? "no_data" : totals.max_breaches + totals.min_breaches > 0 ? "cash_limit_breached" : totals.pending_vouchers > 0 || unclosed > 0 ? "pending_vouchers" : "ready";
    return {
      office: o, month, month_label: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }), opening_balance_of_month: opening, closing_balance_of_month: running,
      sectioned_stamp_balance: header?.sectioned_stamp_balance ?? stock.reduce((a, s) => a + s.closing, 0), rows, totals, violations, stock, status, flags,
      signed_off_by: header?.signed_off_by ?? null, signed_off_at: header?.signed_off_at ?? null, generated_at: now(),
    };
  };

  return {
    appInfo: async () => ({ version: "10.0.0-browser", data_dir: "(browser mock)", db_path: "(in-memory)", backup_dir: "(browser mock)", journal_mode: "memory", platform: "browser", last_auto_backup: null }),
    login: async (username, pin) => {
      const u = st.users.find((x) => x.username.toLowerCase() === username.toLowerCase() && x.active);
      if (!u || u.pin !== pin) throw { code: "forbidden", message: "unknown user or wrong PIN" };
      u.last_login_at = now();
      const { pin: _p, ...user } = u;
      st.session = { user, actor: { user_id: u.id, username: u.username, role: u.role }, must_change_pin: false, signed_in_at: now() };
      log("login", "user", u.id);
      return st.session;
    },
    logout: async () => { log("logout", "user", st.session?.user.id ?? ""); st.session = null; },
    currentSession: async () => st.session,
    listUsers: async () => st.users.map(({ pin: _p, ...u }) => u),
    createUser: async (p) => {
      supervisor("create users");
      if (st.users.some((u) => u.username.toLowerCase() === p.username.toLowerCase())) throw { code: "db", message: "username already exists" };
      const u = { id: id(), username: p.username, display_name: p.displayName, role: p.role, office_id: p.officeId, active: true, last_login_at: null, pin: p.pin };
      st.users.push(u);
      log("user.create", "user", u.id, undefined, u);
      const { pin: _p, ...user } = u;
      return user;
    },
    setPin: async (userId, newPin) => { const u = st.users.find((x) => x.id === userId); if (u) u.pin = newPin; log("user.set_pin", "user", userId); },
    setUserActive: async (userId, active) => { supervisor("deactivate users"); const u = st.users.find((x) => x.id === userId); if (u) u.active = active; log("user.set_active", "user", userId); },
    listOffices: async (includeInactive = false) => st.offices.filter((o) => includeInactive || o.active),
    saveOffice: async (o) => {
      supervisor("configure offices");
      if (!/^\d{6}$/.test(o.pincode)) throw { code: "validation", message: "pincode must be 6 digits" };
      if (o.max_cash_limit > 0 && o.max_cash_limit < o.min_cash_limit) throw { code: "validation", message: "maximum cash limit must not be below the minimum" };
      const saved = { ...o, id: o.id || id() };
      const i = st.offices.findIndex((x) => x.id === saved.id);
      if (i >= 0) st.offices[i] = saved; else st.offices.push(saved);
      log(i >= 0 ? "office.update" : "office.create", "office", saved.id, undefined, saved);
      return saved;
    },
    listHolidays: async (oid) => st.holidays.filter((h) => h.office_id === "*" || h.office_id === oid),
    setHoliday: async (oid, date, holiday, note = "") => {
      st.holidays = st.holidays.filter((h) => !(h.office_id === oid && h.holiday_date === date));
      if (holiday) st.holidays.push({ office_id: oid, holiday_date: date, note });
      log("holiday.set", "holiday", date, undefined, holiday, note);
    },
    openHandover: async (oid, date, counter, direction = "pa_to_spm") => {
      const a = actor();
      const label = counter.trim() || "Counter 1";
      const ex = st.handovers.filter((h) => h.office_id === oid && h.business_date === date && h.counter_label === label && (h.status === "open" || h.status === "rejected")).sort((x, y) => y.sequence_no - x.sequence_no)[0];
      if (ex) return ex;
      const seqNo = st.handovers.filter((h) => h.office_id === oid && h.business_date === date && h.counter_label === label).length + 1;
      const h: Handover = { id: id(), office_id: oid, business_date: date, counter_label: label, sequence_no: seqNo, direction, from_user_id: a.user_id, to_user_id: null, status: "open", system_book_balance: null, physical_cash: null, notes: "", submitted_at: null, verified_by: null, verified_at: null, created_at: now(), updated_at: now() };
      st.handovers.push(h);
      log("handover.open", "handover", h.id, undefined, h);
      return h;
    },
    listHandovers: async (oid, date) => st.handovers.filter((h) => h.office_id === oid && h.business_date === date),
    updateHandoverNotes: async (hid, notes, sbb) => { const h = handover(hid); h.notes = notes; h.system_book_balance = sbb; h.updated_at = now(); log("handover.update", "handover", hid); return h; },
    submitHandover: async (hid) => {
      const h = handover(hid);
      if (h.status === "submitted" || h.status === "verified") throw { code: "validation", message: "handover already submitted" };
      h.status = "submitted"; h.submitted_at = now(); h.physical_cash = physical(denoms(h.office_id, h.business_date, "handover", hid)).total;
      log("handover.submit", "handover", hid);
      return h;
    },
    verifyHandover: async (hid, accept, note = "") => {
      const a = supervisor("verify handovers");
      const h = handover(hid);
      h.status = accept ? "verified" : "rejected"; h.verified_by = a.user_id; h.verified_at = now();
      for (const v of st.vouchers) if (v.handover_id === hid && v.verification_status === "pending") { v.verification_status = accept ? "accepted" : "rejected"; v.verified_by = a.user_id; v.verified_at = now(); }
      log(accept ? "handover.verify" : "handover.reject", "handover", hid, undefined, undefined, note);
      recalc(h.office_id, h.business_date);
      return h;
    },
    listVouchersForDay: async (oid, date) => { const hids = st.handovers.filter((h) => h.office_id === oid && h.business_date === date).map((h) => h.id); return st.vouchers.filter((v) => hids.includes(v.handover_id)); },
    addVoucher: async (hid, input) => {
      const a = actor();
      const h = handover(hid);
      if (input.voucher_count < 1) throw { code: "validation", message: "number of vouchers must be at least 1" };
      if (input.amount < 0) throw { code: "validation", message: "amount must not be negative" };
      const v: VoucherItem = { id: id(), handover_id: hid, ...input, voucher_type: input.voucher_type.toUpperCase(), submitted_at: now(), verification_status: "pending", verified_by: null, verified_at: null, created_by: a.user_id, created_at: now(), updated_at: now() };
      st.vouchers.push(v);
      log("voucher.create", "voucher", v.id, undefined, v);
      recalc(h.office_id, h.business_date);
      return v;
    },
    updateVoucher: async (vid, input) => {
      const a = actor();
      const v = voucher(vid);
      if (v.verification_status !== "pending" && a.role !== "supervisor") throw { code: "forbidden", message: "verified vouchers can only be changed by the SPM" };
      const before = { ...v };
      Object.assign(v, input, { voucher_type: input.voucher_type.toUpperCase(), updated_at: now() });
      log("voucher.update", "voucher", vid, before, v);
      const h = handover(v.handover_id);
      recalc(h.office_id, h.business_date);
      return v;
    },
    deleteVoucher: async (vid, reason = "") => {
      const a = actor();
      const v = voucher(vid);
      if (v.verification_status !== "pending" && a.role !== "supervisor") throw { code: "forbidden", message: "verified vouchers can only be deleted by the SPM" };
      st.vouchers = st.vouchers.filter((x) => x.id !== vid);
      log("voucher.delete", "voucher", vid, v, undefined, reason);
      const h = handover(v.handover_id);
      recalc(h.office_id, h.business_date);
    },
    verifyVoucher: async (vid, status, note = "") => {
      const a = supervisor("verify vouchers");
      const v = voucher(vid);
      const before = { ...v };
      v.verification_status = status; v.verified_by = status === "pending" ? null : a.user_id; v.verified_at = status === "pending" ? null : now();
      log("voucher.verify", "voucher", vid, before, v, note);
      const h = handover(v.handover_id);
      recalc(h.office_id, h.business_date);
      return v;
    },
    getDenominations: async (oid, date, scope, hid = null) => denoms(oid, date, scope, hid),
    saveDenominations: async (oid, date, scope, hid, lines) => {
      actor();
      const kept = lines.filter((l) => l.amount !== 0 || l.quantity !== 0);
      st.denominations = st.denominations.filter((d) => !(d.officeId === oid && d.date === date && d.scope === scope && (d.handoverId ?? null) === (hid ?? null)));
      st.denominations.push({ officeId: oid, date, scope, handoverId: hid, lines: kept });
      const p = physical(kept);
      log("cash.count", "cash_denominations", `${date}:${scope}`, undefined, kept, `total ${p.total}`);
      if (scope === "chest") recalc(oid, date);
      return p;
    },
    tallyCompare: async (s, p) => ({ system_book_balance: s, physical_cash: p, ...compareTally(s, p) }),
    getDailyClosing: async (oid, date) => st.closings.find((c) => c.office_id === oid && c.business_date === date) ?? null,
    recalculateDay: async (oid, date) => { actor(); return recalc(oid, date); },
    setSystemBookBalance: async (oid, date, amount, note = "") => {
      actor();
      let c = st.closings.find((x) => x.office_id === oid && x.business_date === date) ?? recalc(oid, date);
      c.system_book_balance = amount;
      log("cash.override", "daily_closing", date, undefined, amount, note);
      c = recalc(oid, date);
      return c;
    },
    closeDay: async (oid, date, remarks = "") => {
      const a = supervisor("close the day");
      const c = recalc(oid, date);
      const hids = st.handovers.filter((h) => h.office_id === oid && h.business_date === date).map((h) => h.id);
      const pending = st.vouchers.filter((v) => hids.includes(v.handover_id) && v.verification_status === "pending").length;
      if (pending > 0) throw { code: "validation", message: `${pending} voucher(s) still pending verification` };
      c.status = "closed"; c.closed_by = a.user_id; c.closed_at = now(); c.remarks = remarks;
      log("day.close", "daily_closing", date, undefined, c, remarks);
      return c;
    },
    reopenDay: async (oid, date, reason = "") => { supervisor("reopen the day"); const c = recalc(oid, date); c.status = "open"; c.closed_by = null; c.closed_at = null; log("day.reopen", "daily_closing", date, undefined, undefined, reason); return c; },
    listDailyClosings: async (oid, month) => st.closings.filter((c) => c.office_id === oid && c.business_date.startsWith(month)).sort((a, b) => (a.business_date < b.business_date ? -1 : 1)),
    listViolations: async (oid, month) => st.violations.filter((v) => v.office_id === oid && v.business_date.startsWith(month)),
    dashboardSummary: async (oid, date) => {
      const o = office(oid);
      const closing = st.closings.find((c) => c.office_id === oid && c.business_date === date) ?? null;
      const chest = physical(denoms(oid, date, "chest", null));
      const hids = st.handovers.filter((h) => h.office_id === oid && h.business_date === date).map((h) => h.id);
      const vs = st.vouchers.filter((v) => hids.includes(v.handover_id));
      const cnt = (s: string) => vs.filter((v) => v.verification_status === s).reduce((a, v) => a + v.voucher_count, 0);
      const tally = closing ? { system_book_balance: closing.system_book_balance ?? closing.closing_balance, physical_cash: closing.physical_cash, ...compareTally(closing.system_book_balance ?? closing.closing_balance, closing.physical_cash) } : null;
      return { office: o, business_date: date, is_working_day: working(oid, date), closing, chest, tally, pending_vouchers: cnt("pending"), accepted_vouchers: cnt("accepted"), rejected_vouchers: cnt("rejected"), voucher_lines: vs.length, handovers: st.handovers.filter((h) => h.office_id === oid && h.business_date === date), violations_this_month: st.violations.filter((v) => v.office_id === oid && v.business_date.startsWith(date.slice(0, 7))).length };
    },
    compileSmrBatch: async (month) => {
      actor();
      const reports = st.offices.filter((o) => o.active).map((o) => compile(o.id, month));
      log("smr.compile", "smr_report", month);
      return { month, reports, summaries: reports.map((r) => ({ office_id: r.office.id, office_name: r.office.name, month, status: r.status, flags: r.flags, working_days: r.totals.working_days, days_recorded: r.totals.days_recorded, pending_vouchers: r.totals.pending_vouchers, violations: r.totals.max_breaches + r.totals.min_breaches, closing_balance_of_month: r.closing_balance_of_month, signed_off: !!r.signed_off_at })) };
    },
    compileSmrOffice: async (oid, month) => { actor(); return compile(oid, month); },
    listSmrEntries: async (oid, month) => st.smrEntries.filter((e) => e.office_id === oid && e.report_month === month),
    saveSmrEntry: async (entry) => {
      const a = actor();
      const header = st.smrEntries.find((e) => e.office_id === entry.office_id && e.report_month === entry.report_month && e.business_date === entry.report_month);
      if (header?.signed_off_at && a.role !== "supervisor") throw { code: "forbidden", message: "month is signed off; only the SPM can change it" };
      const i = st.smrEntries.findIndex((e) => e.office_id === entry.office_id && e.report_month === entry.report_month && e.business_date === entry.business_date);
      const saved = { ...(i >= 0 ? st.smrEntries[i] : {}), ...entry } as SmrEntry;
      if (i >= 0) st.smrEntries[i] = saved; else st.smrEntries.push(saved);
      log("smr.save", "smr_entry", `${entry.report_month}:${entry.business_date}`, undefined, saved);
      return saved;
    },
    signOffSmr: async (oid, month) => {
      const a = supervisor("sign off the SMR");
      const i = st.smrEntries.findIndex((e) => e.office_id === oid && e.report_month === month && e.business_date === month);
      const base: SmrEntry = i >= 0 ? st.smrEntries[i]! : { office_id: oid, report_month: month, business_date: month, stamps_received: 0, stamps_remitted: 0, postage_stamps: 0, revenue_stamps: 0, other_stamps: 0, cash_received_override: null, cash_remitted_override: null, liabilities_note: "", opening_balance_of_month: null, sectioned_stamp_balance: null, signed_off_by: null, signed_off_at: null };
      const saved = { ...base, signed_off_by: a.user_id, signed_off_at: now() };
      if (i >= 0) st.smrEntries[i] = saved; else st.smrEntries.push(saved);
      log("smr.signoff", "smr_entry", month);
    },
    listStampStock: async (oid, month) => st.stock.filter((s) => s.office_id === oid && s.report_month === month),
    saveStampStock: async (oid, month, category, opening, receipts, sales) => {
      actor();
      const closing = opening + receipts - sales;
      if (closing < 0) throw { code: "validation", message: "sales exceed opening + receipts" };
      const s: StampStock = { office_id: oid, report_month: month, category: category as StampStock["category"], opening, receipts, sales, closing };
      st.stock = st.stock.filter((x) => !(x.office_id === oid && x.report_month === month && x.category === category));
      st.stock.push(s);
      log("stock.save", "stamp_stock", `${month}:${category}`, undefined, s);
      return s;
    },
    listAuditLogs: async (oid = null, entityType = null, limit = 500) => st.audit.filter((l) => (!oid || l.office_id === oid || l.office_id === null) && (!entityType || l.entity_type === entityType)).slice(0, limit),
    backupNow: async (label = "manual") => ({ path: `(browser)/HandToHand_Backup_${label}.db`, file_name: `HandToHand_Backup_${label}.db`, size_bytes: 0, created_at: now(), verified: true }),
    listBackups: async () => [],
    restoreBackup: async () => { throw { code: "validation", message: "restore is only available in the desktop build" }; },
    getSetting: async (key) => st.settings[key] ?? null,
    setSetting: async (key, value) => { supervisor("change settings"); st.settings[key] = value; },
    listPrinters: async () => [],
    printRaw: async (_t, data) => { console.info("[mock print]", new TextDecoder().decode(data)); return data.length; },
    writeFile: async (path, data) => {
      const blob = new Blob([data as BlobPart]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = path.split(/[\\/]/).pop() ?? "export";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return data.length;
    },
    classifyBarcode: async (raw) => classifyBarcode(raw),
    saveDialog: async (defaultName) => defaultName,
    openDialog: async () => null,
    openPath: async () => {},
  };
}
