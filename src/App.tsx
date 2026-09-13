import { useCallback, useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { useSessionStore } from "@/store/session";
import { useOfficeStore } from "@/store/office";
import { useUiStore } from "@/store/ui";
import { useLedgerStore } from "@/store/ledger";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { Sidebar } from "@/components/layout/AppShell";
import { LedgerPage } from "@/features/ledger/LedgerPage";
import { SmrHub } from "@/features/smr/SmrHub";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AuditPage } from "@/features/audit/AuditPage";
import { useHotkeys, type HotkeyMap } from "@/hooks/useHotkeys";
import { useBarcodeWedge } from "@/hooks/useBarcodeWedge";
import { classifyBarcode } from "@/lib/barcode";
import { errorMessage } from "@/lib/utils";

export default function App() {
  const { session, booting, boot } = useSessionStore();
  useEffect(() => {
    void boot();
  }, [boot]);
  if (booting) return <div className="h-full grid place-items-center text-muted-foreground text-sm">Opening database…</div>;
  return (
    <TooltipProvider>
      {session ? <Workspace /> : <LoginScreen />}
      <Toaster />
    </TooltipProvider>
  );
}

function Workspace() {
  const { page, setPage, setDenominationOpen, setQuickEntryOpen, setClosingOpen, toast } = useUiStore();
  const { loadOffices, currentOfficeId, businessDate } = useOfficeStore();
  const ledger = useLedgerStore();

  useEffect(() => {
    void loadOffices().catch((e) => toast("error", "Could not load offices", errorMessage(e)));
  }, [loadOffices, toast]);

  useEffect(() => {
    if (currentOfficeId) void ledger.load(currentOfficeId, businessDate).catch((e) => toast("error", "Could not load ledger", errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOfficeId, businessDate]);

  const hotkeys: HotkeyMap = {
    F2: () => {
      setPage("ledger");
      setDenominationOpen(true);
    },
    F3: () => {
      setPage("ledger");
      setQuickEntryOpen(true);
    },
    F5: () => {
      void ledger.refresh().then(() => toast("info", "Balance recalculated")).catch((e) => toast("error", "Refresh failed", errorMessage(e)));
    },
    F9: () => {
      setPage("ledger");
      setDenominationOpen(true);
      toast("info", "Tally & verification", "Compare book balance with the denomination count, then verify pending vouchers.");
    },
    F10: () => {
      if (page === "smr") toast("info", "Use “Compile all offices” then export from the SMR hub.");
      else {
        setPage("ledger");
        setClosingOpen(true);
      }
    },
  };
  useHotkeys(hotkeys);

  const onScan = useCallback(
    (code: string) => {
      const info = classifyBarcode(code);
      ledger.setPendingScan(info.normalized);
      setPage("ledger");
      setQuickEntryOpen(true);
      toast(info.kind === "s10_bad_check_digit" ? "warning" : "success", `Scanned ${info.normalized}`, info.kind === "s10_bad_check_digit" ? "S10 check digit does not match — verify the article number" : info.suggested_voucher_type ? `Suggested: ${info.suggested_voucher_type.replace("_", " ")}` : undefined);
    },
    [ledger, setPage, setQuickEntryOpen, toast],
  );
  useBarcodeWedge(onScan);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {page === "ledger" && <LedgerPage />}
        {page === "smr" && <SmrHub />}
        {page === "audit" && <AuditPage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
