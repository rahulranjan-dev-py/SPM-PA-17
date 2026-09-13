import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { SmrBatchSummary, SmrReport } from "@/lib/types";
import { currentMonth } from "@/lib/utils";

interface SmrState {
  month: string;
  summaries: SmrBatchSummary[];
  reports: Record<string, SmrReport>;
  compiling: boolean;
  lastCompiledAt: string | null;
  setMonth(month: string): void;
  compileAll(): Promise<void>;
  compileOffice(officeId: string): Promise<SmrReport>;
}

export const useSmrStore = create<SmrState>((set, get) => ({
  month: currentMonth(),
  summaries: [],
  reports: {},
  compiling: false,
  lastCompiledAt: null,
  setMonth: (month) => set({ month, summaries: [], reports: {} }),
  compileAll: async () => {
    set({ compiling: true });
    try {
      const result = await api().compileSmrBatch(get().month);
      const reports: Record<string, SmrReport> = {};
      for (const r of result.reports) reports[r.office.id] = r;
      set({ summaries: result.summaries, reports, compiling: false, lastCompiledAt: new Date().toISOString() });
    } catch (e) {
      set({ compiling: false });
      throw e;
    }
  },
  compileOffice: async (officeId) => {
    const report = await api().compileSmrOffice(officeId, get().month);
    set((s) => ({
      reports: { ...s.reports, [officeId]: report },
      summaries: s.summaries.map((x) =>
        x.office_id === officeId
          ? { ...x, status: report.status, flags: report.flags, pending_vouchers: report.totals.pending_vouchers, violations: report.totals.max_breaches + report.totals.min_breaches, closing_balance_of_month: report.closing_balance_of_month, days_recorded: report.totals.days_recorded, signed_off: !!report.signed_off_at }
          : x,
      ),
    }));
    return report;
  },
}));
