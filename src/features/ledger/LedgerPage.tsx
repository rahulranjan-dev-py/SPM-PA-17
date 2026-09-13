import { useEffect } from "react";
import { TopBar, StatusBar } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { useOfficeStore } from "@/store/office";
import { useLedgerStore } from "@/store/ledger";
import { useUiStore } from "@/store/ui";
import { LedgerCenter } from "./LedgerCenter";
import { TallyDock } from "@/features/tally/TallyDock";
import { DenominationDialog } from "@/features/tally/DenominationDialog";
import { ClosingDialog } from "@/features/closing/ClosingDialog";
import { Money } from "@/lib/money";
import { formatDateLong } from "@/lib/utils";

export function LedgerPage() {
  const office = useOfficeStore((s) => s.currentOffice());
  const businessDate = useOfficeStore((s) => s.businessDate);
  const summary = useLedgerStore((s) => s.summary);
  const { denominationOpen, setDenominationOpen, closingOpen, setClosingOpen } = useUiStore();

  useEffect(() => {
    document.title = office ? `HandToHand X — ${office.name}` : "HandToHand X";
  }, [office]);

  if (!office) {
    return (
      <>
        <TopBar title="Hand-to-Hand Ledger" />
        <div className="flex-1 grid place-items-center text-center text-muted-foreground text-sm p-8">
          <div>
            <p className="font-medium text-foreground">No Sub Office configured yet.</p>
            <p className="mt-1">Sign in as the SPM and add the first office under <b>Offices &amp; Settings</b>.</p>
          </div>
        </div>
      </>
    );
  }

  const closing = summary?.closing ?? null;
  return (
    <>
      <TopBar title={`${office.name}`}>
        <span className="text-xs text-muted-foreground">{formatDateLong(businessDate)}</span>
        {summary && !summary.is_working_day && <Badge variant="muted">Holiday / Sunday</Badge>}
        {closing?.status === "closed" && <Badge variant="success">Day closed</Badge>}
        {summary && summary.violations_this_month > 0 && <Badge variant="danger">{summary.violations_this_month} cash-limit breach(es) this month</Badge>}
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <LedgerCenter />
        <TallyDock />
      </div>
      <StatusBar
        left={
          <>
            <span>OB ₹{Money.format(closing?.opening_balance ?? 0)}</span>
            <span>Receipts ₹{Money.format(closing?.total_receipts ?? 0)}</span>
            <span>Payments ₹{Money.format(closing?.total_payments ?? 0)}</span>
            <span className="font-semibold text-foreground">Closing ₹{Money.format(closing?.closing_balance ?? 0)}</span>
          </>
        }
        right={summary ? <span>{summary.voucher_lines} voucher line(s) · {summary.pending_vouchers} pending</span> : null}
      />
      <DenominationDialog open={denominationOpen} onOpenChange={setDenominationOpen} />
      <ClosingDialog open={closingOpen} onOpenChange={setClosingOpen} />
    </>
  );
}
