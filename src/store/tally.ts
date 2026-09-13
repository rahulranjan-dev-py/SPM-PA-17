import { create } from "zustand";
import { api } from "@/lib/ipc";
import { DENOMINATION_SLOTS } from "@/lib/constants";
import type { DenominationLine, PhysicalCash } from "@/lib/types";
import { compareTally, Money, type Paise, type TallyView } from "@/lib/money";

export type SlotValues = Record<string, number>; // slot key -> quantity (notes/coins) or paise (mixed/citem)

export interface TallyComputed {
  lines: DenominationLine[];
  total: Paise;
  cashInHand: Paise;
  citem: Paise;
  noteCount: number;
  coinCount: number;
}

/** Pure denomination math, mirrored from htoh_core::tally::physical_total. */
export function computeLines(values: SlotValues): TallyComputed {
  const lines: DenominationLine[] = [];
  let total = 0, citem = 0, noteCount = 0, coinCount = 0;
  for (const slot of DENOMINATION_SLOTS) {
    const raw = values[slot.key] ?? 0;
    if (slot.kind === "note" || slot.kind === "coin") {
      const qty = Math.max(0, Math.floor(raw));
      const amount = Money.mul(slot.faceValue, qty);
      lines.push({ kind: slot.kind, face_value_paise: slot.faceValue, quantity: qty, amount });
      total += amount;
      if (slot.kind === "note") noteCount += qty; else coinCount += qty;
    } else {
      const amount = Math.max(0, Math.floor(raw));
      lines.push({ kind: slot.kind, face_value_paise: 0, quantity: 0, amount });
      total += amount;
      if (slot.kind === "citem") citem += amount;
    }
  }
  return { lines, total, cashInHand: total - citem, citem, noteCount, coinCount };
}

export function linesToValues(lines: DenominationLine[]): SlotValues {
  const values: SlotValues = {};
  for (const slot of DENOMINATION_SLOTS) {
    const l = lines.find((x) => x.kind === slot.kind && (slot.kind === "mixed_coins" || slot.kind === "citem" || x.face_value_paise === slot.faceValue));
    if (!l) continue;
    values[slot.key] = slot.kind === "note" || slot.kind === "coin" ? l.quantity : l.amount;
  }
  return values;
}

interface TallyState {
  scope: "chest" | "handover" | "customer";
  values: SlotValues;
  savedValues: SlotValues;
  systemBookBalance: Paise;
  bookClosing: Paise;
  loaded: boolean;
  dirty: boolean;
  load(officeId: string, businessDate: string, scope?: "chest" | "handover" | "customer", handoverId?: string | null): Promise<void>;
  setValue(key: string, value: number): void;
  setAll(values: SlotValues): void;
  setSystemBookBalance(p: Paise): void;
  setBookClosing(p: Paise): void;
  save(officeId: string, businessDate: string, handoverId?: string | null): Promise<PhysicalCash>;
  clear(): void;
  computed(): TallyComputed;
  tally(): TallyView;
}

export const useTallyStore = create<TallyState>((set, get) => ({
  scope: "chest",
  values: {},
  savedValues: {},
  systemBookBalance: 0,
  bookClosing: 0,
  loaded: false,
  dirty: false,
  load: async (officeId, businessDate, scope = "chest", handoverId = null) => {
    const lines = await api().getDenominations(officeId, businessDate, scope, handoverId);
    const values = linesToValues(lines);
    set({ scope, values, savedValues: values, loaded: true, dirty: false });
  },
  setValue: (key, value) => set((s) => ({ values: { ...s.values, [key]: value }, dirty: true })),
  setAll: (values) => set({ values, dirty: true }),
  setSystemBookBalance: (systemBookBalance) => set({ systemBookBalance }),
  setBookClosing: (bookClosing) => set({ bookClosing }),
  save: async (officeId, businessDate, handoverId = null) => {
    const { lines } = computeLines(get().values);
    const result = await api().saveDenominations(officeId, businessDate, get().scope, handoverId, lines);
    set((s) => ({ savedValues: s.values, dirty: false }));
    return result;
  },
  clear: () => set({ values: {}, dirty: true }),
  computed: () => computeLines(get().values),
  tally: () => compareTally(get().systemBookBalance, computeLines(get().values).total),
}));
