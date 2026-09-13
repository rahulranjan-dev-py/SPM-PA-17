import { create } from "zustand";

export type Theme = "light" | "dark";
export type Page = "ledger" | "smr" | "closing" | "audit" | "settings";
export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface UiState {
  theme: Theme;
  page: Page;
  toasts: Toast[];
  denominationOpen: boolean;
  quickEntryOpen: boolean;
  closingOpen: boolean;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setPage(page: Page): void;
  toast(kind: ToastKind, title: string, description?: string): void;
  dismissToast(id: number): void;
  setDenominationOpen(open: boolean): void;
  setQuickEntryOpen(open: boolean): void;
  setClosingOpen(open: boolean): void;
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("htoh.theme");
    if (t === "dark" || t === "light") return t;
  } catch {
    /* ignore */
  }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("htoh.theme", theme);
  } catch {
    /* ignore */
  }
}

let toastSeq = 1;

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  page: "ledger",
  toasts: [],
  denominationOpen: false,
  quickEntryOpen: false,
  closingOpen: false,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setPage: (page) => set({ page }),
  toast: (kind, title, description) => set((s) => ({ toasts: [...s.toasts.slice(-4), { id: toastSeq++, kind, title, description }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setDenominationOpen: (open) => set({ denominationOpen: open }),
  setQuickEntryOpen: (open) => set({ quickEntryOpen: open }),
  setClosingOpen: (open) => set({ closingOpen: open }),
}));

if (typeof document !== "undefined") applyTheme(useUiStore.getState().theme);
