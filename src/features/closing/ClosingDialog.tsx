import { useEffect, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOfficeStore } from "@/store/office";
import { useLedgerStore } from "@/store/ledger";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { api } from "@/lib/ipc";
import type { DenominationLine } from "@/lib/types";
import { Money } from "@/lib/money";
import { buildClosingSheetPdf } from "@/lib/export/pdf";
import { saveBytes, utf8 } from "@/lib/export/save";
import { closingSheetText } from "@/lib/print/slip";
import { printSlip } from "@/features/settings/printer";
import { errorMessage, formatDateLong } from "@/lib/utils";
import { TallyBadge } from "@/features/tally/TallyDock";

/** F10: daily closing sheet — preview, native A4 print, vector PDF, raw text to dot-matrix. */
export function ClosingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const office = useOfficeStore((s) => s.currentOffice());
  const businessDate = useOfficeStore((s) => s.businessDate);
  const ledger = useLedgerStore();
  const session = useSessionStore((s) => s.session);
  const toast = useUiStore((s) => s.toast);
  const [denoms, setDenoms] = useState<DenominationLine[]>([]);
  const closing = ledger.summary?.closing ?? null;

  useEffect(() => {
    if (open && office) void api().getDenominations(office.id, businessDate, "chest").then(setDenoms);
  }, [open, office, businessDate]);

  if (!office) return null;
  const pdf = async () => {
    try {
      const bytes = buildClosingSheetPdf({ office, businessDate, closing, vouchers: ledger.vouchers, handovers: ledger.handovers, denominations: denoms, preparedBy: session?.user.display_name ?? "" });
      const p = await saveBytes(`Closing_${office.pincode}_${businessDate}.pdf`, bytes, { name: "PDF", extensions: ["pdf"] });
      if (p) toast("success", "Closing sheet PDF saved", p);
    } catch (e) {
      toast("error", "PDF export failed", errorMessage(e));
    }
  };
  const dotMatrix = async () => {
    if (!closing) return toast("warning", "Nothing to print yet");
    try {
      await printSlip(utf8(closingSheetText(office, closing, denoms)));
      toast("success", "Closing sheet sent to printer");
    } catch (e) {
      toast("error", "Print failed", errorMessage(e));
    }
  };
  const receipts = ledger.vouchers.filter((v) => v.flow === "receipt" && v.verification_status !== "rejected");
  const payments = ledger.vouchers.filter((v) => v.flow === "payment" && v.verification_status !== "rejected");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Daily closing sheet" description={`${office.name} · ${formatDateLong(businessDate)}`} wide>
        <div className="grid grid-cols-3 gap-3 text-[12.5px]">
          <div className="rounded-lg border border-border p-3 space-y-1.5">
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Book balance</div>
            <Row label="Opening balance" value={closing?.opening_balance ?? 0} />
            <Row label={`Receipts (${receipts.length})`} value={closing?.total_receipts ?? 0} />
            <Row label={`Payments (${payments.length})`} value={closing?.total_payments ?? 0} />
            <Row label="Closing balance" value={closing?.closing_balance ?? 0} bold />
            <Row label="System (Finacle/SAP)" value={closing?.system_book_balance ?? null} />
            <Row label="Physical cash" value={closing?.physical_cash ?? 0} />
            <div className="flex items-center justify-between pt-1"><span className="text-muted-foreground">Tally</span>{closing ? <TallyBadge variance={closing.physical_cash - (closing.system_book_balance ?? closing.closing_balance)} /> : <Badge variant="muted">no record</Badge>}</div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><Badge variant={closing?.status === "closed" ? "success" : "warning"}>{closing?.status ?? "open"}</Badge></div>
          </div>
          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Denominations</div>
            {denoms.filter((d) => d.amount > 0).map((d) => (
              <div key={`${d.kind}-${d.face_value_paise}`} className="flex justify-between"><span>{d.kind === "mixed_coins" ? "Mixed coins" : d.kind === "citem" ? "Cash items" : `₹${d.face_value_paise / 100} × ${d.quantity}`}</span><span className="num">{Money.format(d.amount)}</span></div>
            ))}
            {denoms.length === 0 && <p className="text-muted-foreground">No chest count saved (F2).</p>}
          </div>
          <div className="rounded-lg border border-border p-3 space-y-1">
            <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Hand-over sheets</div>
            {ledger.handovers.map((h) => (
              <div key={h.id} className="flex justify-between"><span>{h.counter_label} #{h.sequence_no}</span><Badge variant={h.status === "verified" ? "success" : h.status === "rejected" ? "danger" : h.status === "submitted" ? "info" : "muted"}>{h.status}</Badge></div>
            ))}
            {ledger.handovers.length === 0 && <p className="text-muted-foreground">No sheets opened.</p>}
            <div className="pt-2 text-muted-foreground">Pending vouchers: <b className="text-foreground">{ledger.summary?.pending_vouchers ?? 0}</b></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void dotMatrix()}><Printer className="h-3.5 w-3.5" /> Raw text → dot-matrix</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> A4 print (native)</Button>
          <Button onClick={() => void pdf()}><FileDown className="h-3.5 w-3.5" /> Vector PDF</Button>
        </DialogFooter>
        <PrintOnlySheet />
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: number | null; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold border-t border-border pt-1" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span className="num">{value == null ? "—" : `₹${Money.format(value)}`}</span>
    </div>
  );
}

/** Rendered only for window.print(): a plain black-on-white A4 layout of the closing figures. */
function PrintOnlySheet() {
  const office = useOfficeStore((s) => s.currentOffice());
  const businessDate = useOfficeStore((s) => s.businessDate);
  const closing = useLedgerStore((s) => s.summary?.closing ?? null);
  if (!office || !closing) return null;
  return (
    <div className="print-only fixed inset-0 bg-white text-black p-8 text-[12px]">
      <h1 className="text-center font-bold text-base">DEPARTMENT OF POSTS — DAILY HAND-TO-HAND CLOSING SHEET</h1>
      <p className="text-center">{office.name} ({office.pincode}) · {formatDateLong(businessDate)}</p>
      <table className="mt-4 w-1/2 border-collapse [&_td]:border [&_td]:border-black [&_td]:px-2 [&_td]:py-1">
        <tbody>
          <tr><td>Opening balance</td><td className="text-right">{Money.format(closing.opening_balance)}</td></tr>
          <tr><td>Total receipts</td><td className="text-right">{Money.format(closing.total_receipts)}</td></tr>
          <tr><td>Total payments</td><td className="text-right">{Money.format(closing.total_payments)}</td></tr>
          <tr><td><b>Closing balance</b></td><td className="text-right"><b>{Money.format(closing.closing_balance)}</b></td></tr>
          <tr><td>Physical cash</td><td className="text-right">{Money.format(closing.physical_cash)}</td></tr>
          <tr><td>Variance</td><td className="text-right">{Money.signed(closing.variance)}</td></tr>
        </tbody>
      </table>
      <p className="mt-12">Signature of {office.postmaster_designation}: ______________________</p>
    </div>
  );
}
