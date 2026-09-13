import { useEffect, useRef } from "react";
import { Eraser, Save } from "lucide-react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MoneyInput } from "@/components/ui/input";
import { useOfficeStore } from "@/store/office";
import { useLedgerStore } from "@/store/ledger";
import { useTallyStore } from "@/store/tally";
import { useUiStore } from "@/store/ui";
import { DENOMINATION_SLOTS } from "@/lib/constants";
import { compareTally, Money } from "@/lib/money";
import { cn, errorMessage } from "@/lib/utils";
import { TallyBadge } from "./TallyDock";

/** F2: numpad-first full-size denomination calculator (floating modal). */
export function DenominationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const office = useOfficeStore((s) => s.currentOffice());
  const businessDate = useOfficeStore((s) => s.businessDate);
  const tally = useTallyStore();
  const ledger = useLedgerStore();
  const toast = useUiStore((s) => s.toast);
  const firstRef = useRef<HTMLInputElement>(null);
  const computed = tally.computed();
  const closing = ledger.summary?.closing ?? null;
  const systemA = closing?.system_book_balance ?? closing?.closing_balance ?? 0;
  const t = compareTally(systemA, computed.total);

  useEffect(() => {
    if (open) setTimeout(() => firstRef.current?.focus(), 30);
  }, [open]);

  const save = async () => {
    if (!office) return;
    try {
      const p = await tally.save(office.id, businessDate);
      await ledger.refresh();
      toast("success", "Chest count saved", `Physical cash ₹${Money.format(p.total)} · ${compareTally(systemA, p.total).badge}`);
      onOpenChange(false);
    } catch (e) {
      toast("error", "Could not save count", errorMessage(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = [...e.currentTarget.querySelectorAll<HTMLInputElement>("input")];
      const i = inputs.indexOf(e.target as HTMLInputElement);
      if (i >= 0 && i < inputs.length - 1) inputs[i + 1]?.focus();
      else void save();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cash denomination calculator" description="Office Currency Counter — type quantities with the numpad; Enter moves down, Enter on the last row saves." wide>
        <div className="grid grid-cols-[1fr_300px] gap-4" onKeyDown={onKeyDown}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {DENOMINATION_SLOTS.map((slot, idx) => {
              const raw = tally.values[slot.key] ?? 0;
              const isAmount = slot.kind === "mixed_coins" || slot.kind === "citem";
              const line = computed.lines.find((l) => l.kind === slot.kind && (isAmount || l.face_value_paise === slot.faceValue));
              return (
                <div key={slot.key} className="grid grid-cols-[110px_1fr_110px] items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
                  <div>
                    <div className={cn("text-[15px] font-semibold", slot.kind === "coin" && "text-muted-foreground", slot.kind === "citem" && "text-muted-foreground text-[13px]")}>{slot.label}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{slot.kind.replace("_", " ")}</div>
                  </div>
                  {isAmount ? (
                    <MoneyInput valuePaise={raw} onChangePaise={(p) => tally.setValue(slot.key, p)} className="h-10 text-[16px]" placeholder="0.00" />
                  ) : (
                    <input ref={idx === 0 ? firstRef : undefined} type="number" min={0} value={raw || ""} placeholder="0" onFocus={(e) => e.target.select()} onChange={(e) => tally.setValue(slot.key, Math.max(0, Math.floor(Number(e.target.value) || 0)))} className="h-10 w-full rounded-md border border-input bg-card px-2 text-right num text-[16px] font-semibold" />
                  )}
                  <div className="num text-right text-[14px]">₹{Money.format(line?.amount ?? 0)}</div>
                </div>
              );
            })}
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Total physical cash (B)</div>
              <div className="num text-[28px] font-bold leading-tight">₹{Money.format(computed.total)}</div>
              <div className="text-[11px] text-muted-foreground">{computed.noteCount} notes · {computed.coinCount} coins · CITEM ₹{Money.format(computed.citem)}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between text-[12px]"><span className="text-muted-foreground">A · System book balance</span><span className="num font-semibold">₹{Money.format(systemA)}</span></div>
              <div className="flex items-center justify-between text-[12px]"><span className="text-muted-foreground">Book closing</span><span className="num">₹{Money.format(closing?.closing_balance ?? 0)}</span></div>
              <div className="pt-1"><TallyBadge variance={t.variance} size="lg" /></div>
            </div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              <p><Kbd>Tab</Kbd> / <Kbd>↵</Kbd> next field · <Kbd>Esc</Kbd> close without saving.</p>
              <p className="mt-1">Cash items (cheques/vouchers held as cash) count in the chest but are excluded from the PA-17 “cash in hand”.</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => tally.clear()}><Eraser className="h-3.5 w-3.5" /> Clear</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()}><Save className="h-3.5 w-3.5" /> Save chest count</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
