import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { AppInfo, Session } from "@/lib/types";

interface SessionState {
  session: Session | null;
  info: AppInfo | null;
  booting: boolean;
  boot(): Promise<void>;
  login(username: string, pin: string): Promise<void>;
  logout(): Promise<void>;
  isSupervisor(): boolean;
  clearMustChangePin(): void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  info: null,
  booting: true,
  boot: async () => {
    try {
      const [info, session] = await Promise.all([api().appInfo(), api().currentSession()]);
      set({ info, session, booting: false });
    } catch {
      set({ booting: false });
    }
  },
  login: async (username, pin) => {
    const session = await api().login(username, pin);
    set({ session });
  },
  logout: async () => {
    await api().logout();
    set({ session: null });
  },
  isSupervisor: () => get().session?.actor.role === "supervisor",
  clearMustChangePin: () => set((s) => (s.session ? { session: { ...s.session, must_change_pin: false } } : {})),
}));
