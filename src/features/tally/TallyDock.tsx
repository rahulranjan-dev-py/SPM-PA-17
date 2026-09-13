import { useEffect, useState } from "react";
import { Calculator, Lock, RefreshCw, Save, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Label, MoneyInput } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { useLedgerStore } from "@/store/ledger";
import { useOfficeStore } from "@/store/office";
import { useSessionStore } from "@/store/session";
import { useTallyStore } from "@/store/tally";
import { useUiStore } from "@/store/ui";
import { DENOMINATION_SLOTS } from "@/lib/constants";
import { compareTally, Money } from "@/lib/money";
import { cn, errorMessage } from "@/lib/utils";

export function TallyBadge({ variance, size = "md" }: { variance: number; size?: "md" | "lg" }) {
  const t = compareTally(0, variance);
  return (
    <Badge variant={t.status === "balanced" ? "success" : t.status === "surplus" ? "warning" : "danger"} className={cn(size === "lg" && "text-[13px] px-3 py-1")}>
      {t.badge}
    </Badge>
  );
}

/** Right-hand dock: live denomination count + dual-tally comparator. */
export function TallyDock() {
  const office = useOfficeStore((s) => s.currentOffice());
  const businessDate = useOfficeStore((s) => s.businessDate);
  const ledger = useLedgerStore();
  const tally = useTallyStore();
  const isSupervisor = useSessionStore((s) => s.session?.actor.role === "supervisor");
  const { toast, setDenominationOpen } = useUiStore();
  const [sbb, setSbb] = useState<number>(0);
  const closing = ledger.summary?.closing ?? null;
  const dayClosed = closing?.status === "closed";

  useEffect(() => {
    if (office) void tally.load(office.id, businessDate, "chest").catch((e) => toast("error", "Could not load cash count", errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office?.id, businessDate]);
  useEffect(() => {
    setSbb(closing?.system_book_balance ?? 0);
  }, [closing?.system_book_balance]);

  const computed = tally.computed();
  const book = closing?.closing_balance ?? 0;
  const systemA = closing?.system_book_balance ?? book;
  const vsBook = compareTally(book, computed.total);
  const vsSystem = compareTally(systemA, computed.total);

  const save = async () => {
    if (!office) return;
    try {
      const p = await tally.save(office.id, businessDate);
      await ledger.refresh();
      toast("success", "Chest count saved", `Physical cash ₹${Money.format(p.total)}`);
    } catch (e) {
      toast("error", "Could not save count", errorMessage(e));
    }
  };
  const saveSbb = async () => {
    try {
      await ledger.setSystemBookBalance(sbb || null, "entered from Finacle / SAP CSI extract");
      toast("success", "System book balance recorded");
    } catch (e) {
      toast("error", "Could not save", errorMessage(e));
    }
  };

  if (!office) return null;
  return (
    <aside className="no-print flex w-[320px] shrink-0 flex-col bg-sidebar">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Calculator className="h-3.5 w-3.5" /> Live cash tally</div>
        <Tip label="Open the full-size calculator (F2)"><Button size="sm" variant="ghost" onClick={() => setDenominationOpen(true)}>Expand <Kbd>F2</Kbd></Button></Tip>
      </div>
      <div className="overflow-y-auto scrollbar-thin px-3 py-2 space-y-3">
        {/* comparator */}
        <div className="rounded-lg border border-border bg-card p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md bg-muted p-2">
              <div className="text-muted-foreground">A · System book balance</div>
              <div className="num text-[15px] font-semibold">₹{Money.format(systemA)}</div>
              <div className="text-[10px] text-muted-foreground">{closing?.system_book_balance != null ? "Finacle / SAP extract" : "book closing (no extract yet)"}</div>
            </div>
            <div className="rounded-md bg-muted p-2">
              <div className="text-muted-foreground">B · Physical cash in hand</div>
              <div className="num text-[15px] font-semibold">₹{Money.format(computed.total)}</div>
              <div className="text-[10px] text-muted-foreground">{computed.noteCount} notes · {computed.coinCount} coins{tally.dirty && " · unsaved"}</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Discrepancy (B − A)</span>
            <TallyBadge variance={vsSystem.variance} />
          </div>
          {closing?.system_book_balance != null && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">vs. book closing ₹{Money.format(book)}</span>
              <TallyBadge variance={vsBook.variance} />
            </div>
          )}
          <div className="space-y-1">
            <Label>Finacle / SAP closing figure</Label>
            <div className="flex gap-1">
              <MoneyInput valuePaise={sbb} onChangePaise={setSbb} placeholder="0.00" disabled={dayClosed} />
              <Tip label="Record as the system book balance (audited)"><Button size="icon" variant="secondary" onClick={() => void saveSbb()} disabled={dayClosed}><Save className="h-3.5 w-3.5" /></Button></Tip>
            </div>
          </div>
        </div>

        {/* denominations */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-2.5 py-1.5 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Office currency counter</div>
          <div className="p-2 space-y-1">
            {DENOMINATION_SLOTS.map((slot) => {
              const raw = tally.values[slot.key] ?? 0;
              const isAmount = slot.kind === "mixed_coins" || slot.kind === "citem";
              const line = computed.lines.find((l) => l.kind === slot.kind && (isAmount || l.face_value_paise === slot.faceValue));
              return (
                <div key={slot.key} className="grid grid-cols-[64px_1fr_86px] items-center gap-1.5">
                  <span className={cn("text-[12px] font-medium", slot.kind === "citem" && "text-muted-foreground")}>{slot.label}</span>
                  {isAmount ? (
                    <MoneyInput valuePaise={raw} onChangePaise={(p) => tally.setValue(slot.key, p)} className="h-7" placeholder="0.00" disabled={dayClosed} />
                  ) : (
                    <input type="number" min={0} value={raw || ""} placeholder="0" disabled={dayClosed} onFocus={(e) => e.target.select()} onChange={(e) => tally.setValue(slot.key, Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="h-7 w-full rounded-md border border-input bg-card px-2 text-right num text-[13px] disabled:opacity-60" />
                  )}
                  <span className="num text-right text-[12px] text-muted-foreground">{Money.format(line?.amount ?? 0)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-border px-2.5 py-2">
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Total physical cash</div>
              <div className="num text-[16px] font-bold">₹{Money.format(computed.total)}</div>
              {computed.citem > 0 && <div className="text-[10.5px] text-muted-foreground">PA-17 cash in hand ₹{Money.format(computed.cashInHand)} (excl. CITEM)</div>}
            </div>
            <div className="flex gap-1">
              <Tip label="Reload saved count"><Button size="icon" variant="ghost" onClick={() => void tally.load(office.id, businessDate, "chest")}><RefreshCw className="h-3.5 w-3.5" /></Button></Tip>
              <Button size="sm" onClick={() => void save()} disabled={dayClosed || !tally.dirty}><Save className="h-3.5 w-3.5" /> Save count</Button>
            </div>
          </div>
        </div>

        {/* day status */}
        <div className="rounded-lg border border-border bg-card p-2.5 text-[12px] space-y-1.5">
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Opening balance</span><span className="num">₹{Money.format(closing?.opening_balance ?? 0)}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Receipts</span><span className="num">₹{Money.format(closing?.total_receipts ?? 0)}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Payments</span><span className="num">₹{Money.format(closing?.total_payments ?? 0)}</span></div>
          <div className="flex items-center justify-between font-semibold border-t border-border pt-1.5"><span>Book closing</span><span className="num">₹{Money.format(book)}</span></div>
          <div className="flex items-center justify-between"><span className="text-muted-foreground">Vouchers pending</span><Badge variant={ledger.summary?.pending_vouchers ? "warning" : "success"}>{ledger.summary?.pending_vouchers ?? 0}</Badge></div>
          {office.max_cash_limit > 0 && (
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Authorised max</span><span className={cn("num", book > office.max_cash_limit && "text-danger font-semibold")}>₹{Money.format(office.max_cash_limit)}</span></div>
          )}
          {isSupervisor && (
            <div className="pt-1">
              {dayClosed ? (
                <Button size="sm" variant="outline" className="w-full" onClick={() => { const r = prompt("Reason for reopening the day (audited):"); if (r !== null) void ledger.reopenDay(r || "reopened").then(() => toast("success", "Day reopened")).catch((e) => toast("error", "Could not reopen", errorMessage(e))); }}><Unlock className="h-3.5 w-3.5" /> Reopen day</Button>
              ) : (
                <Button size="sm" variant="success" className="w-full" onClick={() => void ledger.closeDay(vsSystem.badge).then(() => toast("success", "Day closed", vsSystem.badge)).catch((e) => toast("error", "Cannot close day", errorMessage(e)))}><Lock className="h-3.5 w-3.5" /> Close day (SPM)</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
