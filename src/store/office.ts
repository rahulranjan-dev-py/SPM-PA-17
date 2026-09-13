import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { Office } from "@/lib/types";
import { todayIso } from "@/lib/utils";

interface OfficeState {
  offices: Office[];
  currentOfficeId: string | null;
  businessDate: string;
  loadOffices(): Promise<void>;
  setCurrentOffice(id: string): void;
  setBusinessDate(date: string): void;
  currentOffice(): Office | undefined;
  saveOffice(office: Office): Promise<Office>;
}

export const emptyOffice = (): Office => ({
  id: "",
  name: "",
  pincode: "",
  facility_id: "",
  office_type: "SO",
  division: "",
  sub_division: "",
  head_office: "",
  postmaster_name: "",
  postmaster_designation: "SPM",
  postmaster_phone: "",
  min_cash_limit: 0,
  max_cash_limit: 0,
  register_start_date: todayIso(),
  initial_opening: 0,
  active: true,
});

export const useOfficeStore = create<OfficeState>((set, get) => ({
  offices: [],
  currentOfficeId: null,
  businessDate: todayIso(),
  loadOffices: async () => {
    const offices = await api().listOffices(true);
    let currentOfficeId = get().currentOfficeId;
    try {
      currentOfficeId ??= localStorage.getItem("htoh.office");
    } catch {
      /* ignore */
    }
    if (!offices.some((o) => o.id === currentOfficeId && o.active)) currentOfficeId = offices.find((o) => o.active)?.id ?? null;
    set({ offices, currentOfficeId });
  },
  setCurrentOffice: (id) => {
    try {
      localStorage.setItem("htoh.office", id);
    } catch {
      /* ignore */
    }
    set({ currentOfficeId: id });
  },
  setBusinessDate: (businessDate) => set({ businessDate }),
  currentOffice: () => get().offices.find((o) => o.id === get().currentOfficeId),
  saveOffice: async (office) => {
    const saved = await api().saveOffice(office);
    await get().loadOffices();
    if (!get().currentOfficeId) get().setCurrentOffice(saved.id);
    return saved;
  },
}));
