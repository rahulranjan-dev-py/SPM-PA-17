/**
 * Typed IPC surface. In Tauri the calls go to the Rust commands; in a plain
 * browser (vite dev, vitest) an in-memory mock with the same contract is used
 * so the UI can be exercised without the native shell.
 */
import type {
  AppInfo, AuditLog, BackupInfo, BarcodeInfo, CashLimitViolation, DailyClosing, DashboardSummary, DenominationLine, Handover, Holiday, Office,
  PhysicalCash, PrintTarget, Role, Session, SmrBatchResult, SmrEntry, SmrReport, StampStock, TallyResult, User, VerificationStatus, VoucherInput, VoucherItem,
} from "./types";
import type { Paise } from "./money";

export interface Api {
  appInfo(): Promise<AppInfo>;
  login(username: string, pin: string): Promise<Session>;
  logout(): Promise<void>;
  currentSession(): Promise<Session | null>;
  listUsers(): Promise<User[]>;
  createUser(p: { username: string; displayName: string; role: Role; officeId: string | null; pin: string }): Promise<User>;
  setPin(userId: string, newPin: string): Promise<void>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  listOffices(includeInactive?: boolean): Promise<Office[]>;
  saveOffice(office: Office): Promise<Office>;
  listHolidays(officeId: string): Promise<Holiday[]>;
  setHoliday(officeId: string, date: string, holiday: boolean, note?: string): Promise<void>;
  openHandover(officeId: string, businessDate: string, counterLabel: string, direction?: string): Promise<Handover>;
  listHandovers(officeId: string, businessDate: string): Promise<Handover[]>;
  updateHandoverNotes(handoverId: string, notes: string, systemBookBalance: Paise | null): Promise<Handover>;
  submitHandover(handoverId: string): Promise<Handover>;
  verifyHandover(handoverId: string, accept: boolean, note?: string): Promise<Handover>;
  listVouchersForDay(officeId: string, businessDate: string): Promise<VoucherItem[]>;
  addVoucher(handoverId: string, input: VoucherInput): Promise<VoucherItem>;
  updateVoucher(voucherId: string, input: VoucherInput): Promise<VoucherItem>;
  deleteVoucher(voucherId: string, reason?: string): Promise<void>;
  verifyVoucher(voucherId: string, status: VerificationStatus, note?: string): Promise<VoucherItem>;
  getDenominations(officeId: string, businessDate: string, scope: string, handoverId?: string | null): Promise<DenominationLine[]>;
  saveDenominations(officeId: string, businessDate: string, scope: string, handoverId: string | null, lines: DenominationLine[]): Promise<PhysicalCash>;
  tallyCompare(systemBookBalance: Paise, physicalCash: Paise): Promise<TallyResult>;
  getDailyClosing(officeId: string, businessDate: string): Promise<DailyClosing | null>;
  recalculateDay(officeId: string, businessDate: string): Promise<DailyClosing>;
  setSystemBookBalance(officeId: string, businessDate: string, amount: Paise | null, note?: string): Promise<DailyClosing>;
  closeDay(officeId: string, businessDate: string, remarks?: string): Promise<DailyClosing>;
  reopenDay(officeId: string, businessDate: string, reason?: string): Promise<DailyClosing>;
  listDailyClosings(officeId: string, month: string): Promise<DailyClosing[]>;
  listViolations(officeId: string, month: string): Promise<CashLimitViolation[]>;
  dashboardSummary(officeId: string, businessDate: string): Promise<DashboardSummary>;
  compileSmrBatch(month: string): Promise<SmrBatchResult>;
  compileSmrOffice(officeId: string, month: string): Promise<SmrReport>;
  listSmrEntries(officeId: string, month: string): Promise<SmrEntry[]>;
  saveSmrEntry(entry: SmrEntry): Promise<SmrEntry>;
  signOffSmr(officeId: string, month: string): Promise<void>;
  listStampStock(officeId: string, month: string): Promise<StampStock[]>;
  saveStampStock(officeId: string, month: string, category: string, opening: Paise, receipts: Paise, sales: Paise): Promise<StampStock>;
  listAuditLogs(officeId?: string | null, entityType?: string | null, limit?: number): Promise<AuditLog[]>;
  backupNow(label?: string): Promise<BackupInfo>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(path: string): Promise<string>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listPrinters(): Promise<string[]>;
  printRaw(target: PrintTarget, data: Uint8Array): Promise<number>;
  writeFile(path: string, data: Uint8Array): Promise<number>;
  classifyBarcode(raw: string): Promise<BarcodeInfo>;
  /** Native "save as" dialog; returns null when cancelled */
  saveDialog(defaultName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  openDialog(filters: { name: string; extensions: string[] }[], directory?: boolean): Promise<string | null>;
  openPath(path: string): Promise<void>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function tauriApi(): Api {
  const invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  };
  return {
    appInfo: () => invoke("app_info"),
    login: (username, pin) => invoke("login", { username, pin }),
    logout: () => invoke("logout"),
    currentSession: () => invoke("current_session"),
    listUsers: () => invoke("list_users"),
    createUser: (p) => invoke("create_user", { username: p.username, displayName: p.displayName, role: p.role, officeId: p.officeId, pin: p.pin }),
    setPin: (userId, newPin) => invoke("set_pin", { userId, newPin }),
    setUserActive: (userId, active) => invoke("set_user_active", { userId, active }),
    listOffices: (includeInactive = false) => invoke("list_offices", { includeInactive }),
    saveOffice: (office) => invoke("save_office", { office }),
    listHolidays: (officeId) => invoke("list_holidays", { officeId }),
    setHoliday: (officeId, date, holiday, note = "") => invoke("set_holiday", { officeId, date, holiday, note }),
    openHandover: (officeId, businessDate, counterLabel, direction = "pa_to_spm") => invoke("open_handover", { officeId, businessDate, counterLabel, direction }),
    listHandovers: (officeId, businessDate) => invoke("list_handovers", { officeId, businessDate }),
    updateHandoverNotes: (handoverId, notes, systemBookBalance) => invoke("update_handover_notes", { handoverId, notes, systemBookBalance }),
    submitHandover: (handoverId) => invoke("submit_handover", { handoverId }),
    verifyHandover: (handoverId, accept, note = "") => invoke("verify_handover", { handoverId, accept, note }),
    listVouchersForDay: (officeId, businessDate) => invoke("list_vouchers_for_day", { officeId, businessDate }),
    addVoucher: (handoverId, input) => invoke("add_voucher", { handoverId, input }),
    updateVoucher: (voucherId, input) => invoke("update_voucher", { voucherId, input }),
    deleteVoucher: (voucherId, reason = "") => invoke("delete_voucher", { voucherId, reason }),
    verifyVoucher: (voucherId, status, note = "") => invoke("verify_voucher", { voucherId, status, note }),
    getDenominations: (officeId, businessDate, scope, handoverId = null) => invoke("get_denominations", { officeId, businessDate, scope, handoverId }),
    saveDenominations: (officeId, businessDate, scope, handoverId, lines) => invoke("save_denominations", { officeId, businessDate, scope, handoverId, lines }),
    tallyCompare: (systemBookBalance, physicalCash) => invoke("tally_compare", { systemBookBalance, physicalCash }),
    getDailyClosing: (officeId, businessDate) => invoke("get_daily_closing", { officeId, businessDate }),
    recalculateDay: (officeId, businessDate) => invoke("recalculate_day", { officeId, businessDate }),
    setSystemBookBalance: (officeId, businessDate, amount, note = "") => invoke("set_system_book_balance", { officeId, businessDate, amount, note }),
    closeDay: (officeId, businessDate, remarks = "") => invoke("close_day", { officeId, businessDate, remarks }),
    reopenDay: (officeId, businessDate, reason = "") => invoke("reopen_day", { officeId, businessDate, reason }),
    listDailyClosings: (officeId, month) => invoke("list_daily_closings", { officeId, month }),
    listViolations: (officeId, month) => invoke("list_violations", { officeId, month }),
    dashboardSummary: (officeId, businessDate) => invoke("dashboard_summary", { officeId, businessDate }),
    compileSmrBatch: (month) => invoke("compile_smr_batch", { month }),
    compileSmrOffice: (officeId, month) => invoke("compile_smr_office", { officeId, month }),
    listSmrEntries: (officeId, month) => invoke("list_smr_entries", { officeId, month }),
    saveSmrEntry: (entry) => invoke("save_smr_entry", { entry }),
    signOffSmr: (officeId, month) => invoke("sign_off_smr", { officeId, month }),
    listStampStock: (officeId, month) => invoke("list_stamp_stock", { officeId, month }),
    saveStampStock: (officeId, month, category, opening, receipts, sales) => invoke("save_stamp_stock", { officeId, month, category, opening, receipts, sales }),
    listAuditLogs: (officeId = null, entityType = null, limit = 500) => invoke("list_audit_logs", { officeId, entityType, limit }),
    backupNow: (label = "manual") => invoke("backup_now", { label }),
    listBackups: () => invoke("list_backups"),
    restoreBackup: (path) => invoke("restore_backup", { path }),
    getSetting: (key) => invoke("get_setting", { key }),
    setSetting: (key, value) => invoke("set_setting", { key, value }),
    listPrinters: () => invoke("list_printers"),
    printRaw: (target, data) => invoke("print_raw", { target, data: Array.from(data) }),
    writeFile: (path, data) => invoke("write_file", { path, data: Array.from(data) }),
    classifyBarcode: (raw) => invoke("classify_barcode", { raw }),
    saveDialog: async (defaultName, filters) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return save({ defaultPath: defaultName, filters });
    },
    openDialog: async (filters, directory = false) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({ multiple: false, directory, filters: directory ? undefined : filters });
      return typeof r === "string" ? r : null;
    },
    openPath: async (path) => {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(path);
    },
  };
}

let cached: Api | null = null;

export function api(): Api {
  if (cached) return cached;
  cached = isTauri() ? tauriApi() : createMockApi();
  return cached;
}

/** Test hook */
export function __setApi(a: Api | null): void {
  cached = a;
}

// ---------------------------------------------------------------- mock backend
import { createMockApi } from "./mockApi";
