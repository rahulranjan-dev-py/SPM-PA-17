import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { DashboardSummary, Handover, VerificationStatus, VoucherInput, VoucherItem } from "@/lib/types";

interface LedgerState {
  officeId: string | null;
  businessDate: string | null;
  handovers: Handover[];
  vouchers: VoucherItem[];
  summary: DashboardSummary | null;
  activeHandoverId: string | null;
  counterLabel: string;
  loading: boolean;
  editingVoucherId: string | null;
  pendingScan: string | null;
  load(officeId: string, businessDate: string): Promise<void>;
  refresh(): Promise<void>;
  setCounterLabel(label: string): void;
  ensureHandover(): Promise<Handover>;
  addVoucher(input: VoucherInput): Promise<VoucherItem>;
  updateVoucher(id: string, input: VoucherInput): Promise<VoucherItem>;
  deleteVoucher(id: string, reason?: string): Promise<void>;
  verifyVoucher(id: string, status: VerificationStatus, note?: string): Promise<void>;
  submitHandover(id: string): Promise<void>;
  verifyHandover(id: string, accept: boolean, note?: string): Promise<void>;
  setEditingVoucher(id: string | null): void;
  setPendingScan(code: string | null): void;
  closeDay(remarks: string): Promise<void>;
  reopenDay(reason: string): Promise<void>;
  setSystemBookBalance(amount: number | null, note: string): Promise<void>;
}

export const useLedgerStore = create<LedgerState>((set, get) => ({
  officeId: null,
  businessDate: null,
  handovers: [],
  vouchers: [],
  summary: null,
  activeHandoverId: null,
  counterLabel: "Counter 1",
  loading: false,
  editingVoucherId: null,
  pendingScan: null,
  load: async (officeId, businessDate) => {
    set({ officeId, businessDate, loading: true });
    try {
      const [summary, vouchers] = await Promise.all([api().dashboardSummary(officeId, businessDate), api().listVouchersForDay(officeId, businessDate)]);
      const handovers = summary.handovers;
      const label = get().counterLabel;
      const active = handovers.find((h) => h.counter_label === label && (h.status === "open" || h.status === "rejected")) ?? handovers.find((h) => h.counter_label === label) ?? null;
      set({ summary, vouchers, handovers, activeHandoverId: active?.id ?? null, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },
  refresh: async () => {
    const { officeId, businessDate } = get();
    if (officeId && businessDate) await get().load(officeId, businessDate);
  },
  setCounterLabel: (counterLabel) => {
    set({ counterLabel });
    void get().refresh();
  },
  ensureHandover: async () => {
    const { officeId, businessDate, counterLabel, handovers } = get();
    if (!officeId || !businessDate) throw new Error("no office / date selected");
    const existing = handovers.find((h) => h.counter_label === counterLabel && (h.status === "open" || h.status === "rejected"));
    if (existing) return existing;
    const h = await api().openHandover(officeId, businessDate, counterLabel);
    await get().refresh();
    return h;
  },
  addVoucher: async (input) => {
    const h = await get().ensureHandover();
    const v = await api().addVoucher(h.id, input);
    await get().refresh();
    return v;
  },
  updateVoucher: async (id, input) => {
    const v = await api().updateVoucher(id, input);
    await get().refresh();
    return v;
  },
  deleteVoucher: async (id, reason = "") => {
    await api().deleteVoucher(id, reason);
    await get().refresh();
  },
  verifyVoucher: async (id, status, note = "") => {
    await api().verifyVoucher(id, status, note);
    await get().refresh();
  },
  submitHandover: async (id) => {
    await api().submitHandover(id);
    await get().refresh();
  },
  verifyHandover: async (id, accept, note = "") => {
    await api().verifyHandover(id, accept, note);
    await get().refresh();
  },
  setEditingVoucher: (editingVoucherId) => set({ editingVoucherId }),
  setPendingScan: (pendingScan) => set({ pendingScan }),
  closeDay: async (remarks) => {
    const { officeId, businessDate } = get();
    if (!officeId || !businessDate) return;
    await api().closeDay(officeId, businessDate, remarks);
    await get().refresh();
  },
  reopenDay: async (reason) => {
    const { officeId, businessDate } = get();
    if (!officeId || !businessDate) return;
    await api().reopenDay(officeId, businessDate, reason);
    await get().refresh();
  },
  setSystemBookBalance: async (amount, note) => {
    const { officeId, businessDate } = get();
    if (!officeId || !businessDate) return;
    await api().setSystemBookBalance(officeId, businessDate, amount, note);
    await get().refresh();
  },
}));
