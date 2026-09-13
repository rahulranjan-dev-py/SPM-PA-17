import { useEffect, useState } from "react";
import { Building2, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, KeyRound, LogOut, Moon, ScrollText, Settings, ShieldCheck, Sun, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import { useOfficeStore } from "@/store/office";
import { useSessionStore } from "@/store/session";
import { useUiStore, type Page } from "@/store/ui";
import { HOTKEYS } from "@/lib/constants";
import { cn, formatDateLong, shiftDate, todayIso } from "@/lib/utils";
import { ChangePinDialog } from "@/features/auth/ChangePinDialog";

const NAV: { page: Page; label: string; icon: React.ElementType; supervisorOnly?: boolean }[] = [
  { page: "ledger", label: "Hand-to-Hand Ledger", icon: ClipboardList },
  { page: "smr", label: "SMR Hub (PA-17)", icon: FileSpreadsheet },
  { page: "audit", label: "Audit Trail", icon: ScrollText },
  { page: "settings", label: "Offices & Settings", icon: Settings },
];

export function Sidebar() {
  const { offices, currentOfficeId, setCurrentOffice, businessDate, setBusinessDate } = useOfficeStore();
  const { page, setPage } = useUiStore();
  const session = useSessionStore((s) => s.session);
  const active = offices.filter((o) => o.active);
  return (
    <aside className="no-print flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="px-3 pt-3 pb-2 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Sub Office</div>
        <Select value={currentOfficeId ?? ""} onValueChange={setCurrentOffice} options={active.map((o) => ({ value: o.id, label: o.name, hint: o.pincode }))} placeholder="Select office" />
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-1"><CalendarDays className="h-3.5 w-3.5" /> Business date</div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setBusinessDate(shiftDate(businessDate, -1))} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
          <input type="date" value={businessDate} max={todayIso()} onChange={(e) => e.target.value && setBusinessDate(e.target.value)} className="h-8 w-full rounded-md border border-input bg-card px-2 text-[12.5px] num" />
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setBusinessDate(shiftDate(businessDate, 1))} disabled={businessDate >= todayIso()} aria-label="Next day"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="text-[11px] text-muted-foreground px-0.5">{formatDateLong(businessDate)}{businessDate !== todayIso() && <button className="ml-1 text-primary hover:underline" onClick={() => setBusinessDate(todayIso())}>today</button>}</div>
      </div>
      <nav className="px-2 py-1 space-y-0.5">
        {NAV.filter((n) => !n.supervisorOnly || session?.actor.role === "supervisor").map((n) => (
          <button
            key={n.page}
            onClick={() => setPage(n.page)}
            className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", page === n.page ? "bg-primary/12 text-primary font-medium" : "text-foreground/85 hover:bg-accent")}
          >
            <n.icon className="h-4 w-4" /> {n.label}
          </button>
        ))}
      </nav>
      <div className="mt-auto px-3 pb-3 space-y-2">
        <div className="rounded-md border border-border bg-card/60 p-2 text-[11px] text-muted-foreground space-y-1">
          <div className="font-semibold uppercase tracking-wider text-[10.5px]">Keyboard</div>
          {HOTKEYS.map((h) => (
            <div key={h.key} className="flex items-center justify-between gap-2"><span>{h.label}</span><Kbd>{h.key}</Kbd></div>
          ))}
          <div className="flex items-center justify-between gap-2"><span>Move between fields</span><span className="flex gap-0.5"><Kbd>Tab</Kbd><Kbd>↵</Kbd></span></div>
        </div>
      </div>
    </aside>
  );
}

export function TopBar({ title, children }: { title: string; children?: React.ReactNode }) {
  const session = useSessionStore((s) => s.session);
  const logout = useSessionStore((s) => s.logout);
  const { theme, toggleTheme } = useUiStore();
  const [pinOpen, setPinOpen] = useState(false);
  const forced = !!session?.must_change_pin;
  useEffect(() => {
    if (forced) setPinOpen(true);
  }, [forced]);
  return (
    <header className="no-print flex h-12 shrink-0 items-center justify-between border-b border-border bg-topbar px-4">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-[15px] font-semibold truncate">{title}</h1>
        {children}
      </div>
      <div className="flex items-center gap-2">
        {session && (
          <Badge variant={session.actor.role === "supervisor" ? "info" : "muted"} className="gap-1.5">
            {session.actor.role === "supervisor" ? <ShieldCheck className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
            {session.user.display_name} · {session.actor.role === "supervisor" ? "Supervisor / SPM" : "Operator"}
          </Badge>
        )}
        <Tip label="Change PIN"><Button variant="ghost" size="icon" onClick={() => setPinOpen(true)} aria-label="Change PIN"><KeyRound className="h-4 w-4" /></Button></Tip>
        <Tip label={theme === "dark" ? "Switch to crisp light mode" : "Switch to low-eye-strain dark mode"}><Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button></Tip>
        <Tip label="Sign out"><Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button></Tip>
      </div>
      {session && <ChangePinDialog open={pinOpen} onOpenChange={setPinOpen} userId={session.user.id} forced={forced} />}
    </header>
  );
}

export function StatusBar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  const info = useSessionStore((s) => s.info);
  return (
    <footer className="no-print flex h-6 shrink-0 items-center justify-between border-t border-border bg-sidebar px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3 min-w-0">{left}</div>
      <div className="flex items-center gap-3">{right}{info && <span title={info.db_path}>SQLite {info.journal_mode.toUpperCase()} · offline</span>}</div>
    </footer>
  );
}
