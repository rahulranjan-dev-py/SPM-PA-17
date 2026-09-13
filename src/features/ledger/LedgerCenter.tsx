import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, FileDown, Pencil, Plus, Printer, Send, ShieldCheck, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, MoneyInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Kbd } from "@/components/ui/kbd";
import { Tip } from "@/components/ui/tooltip";
import { useLedgerStore } from "@/store/ledger";
import { useOfficeStore } from "@/store/office";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { CATEGORY_LABELS, CATEGORY_ORDER, VOUCHER_TYPES, voucherTypeDef, voucherTypeLabel } from "@/lib/constants";
import { classifyBarcode } from "@/lib/barcode";
import { Money } from "@/lib/money";
import type { Flow, VoucherCategory, VoucherInput, VoucherItem } from "@/lib/types";
import { cn, errorMessage, formatTs } from "@/lib/utils";
import { api } from "@/lib/ipc";
import { buildHandoverReceiptPdf } from "@/lib/export/pdf";
import { buildLedgerWorkbook } from "@/lib/export/xlsx";
import { vouchersCsv } from "@/lib/export/csv";
import { saveBytes, utf8 } from "@/lib/export/save";
import { handoverSlipEscPos } from "@/lib/print/slip";
import { printSlip } from "@/features/settings/printer";

type TabKey = "all" | VoucherCategory;

const STATUS_VARIANT = { pending: "warning", accepted: "success", rejected: "danger" } as const;

export function LedgerCenter() {
  const ledger = useLedgerStore();
  const office = useOfficeStore((s) => s.currentOffice());
  const isSupervisor = useSessionStore((s) => s.session?.actor.role === "supervisor");
  const toast = useUiStore((s) => s.toast);
  const { quickEntryOpen, setQuickEntryOpen } = useUiStore();
  const [tab, setTab] = useState<TabKey>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const visible = useMemo(() => ledger.vouchers.filter((v) => tab === "all" || v.category === tab), [ledger.vouchers, tab]);
  const totals = useMemo(() => {
    const t = { receipts: 0, payments: 0, count: 0 };
    for (const v of visible) {
      if (v.verification_status === "rejected") continue;
      t.count += v.voucher_count;
      if (v.flow === "receipt") t.receipts += v.amount; else t.payments += v.amount;
    }
    return t;
  }, [visible]);
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of ledger.vouchers) m[v.category] = (m[v.category] ?? 0) + 1;
    return m;
  }, [ledger.vouchers]);

  const activeHandover = ledger.handovers.find((h) => h.id === ledger.activeHandoverId) ?? null;
  const dayClosed = ledger.summary?.closing?.status === "closed";

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast("success", label);
    } catch (e) {
      toast("error", `${label} failed`, errorMessage(e));
    }
  };

  const exportXlsx = async () => {
    if (!office) return;
    const bytes = await buildLedgerWorkbook(office.name, ledger.businessDate ?? "", ledger.vouchers);
    const p = await saveBytes(`HtoH_${office.pincode}_${ledger.businessDate}.xlsx`, bytes, { name: "Excel workbook", extensions: ["xlsx"] });
    if (p) toast("success", "Excel exported", p);
  };
  const exportCsv = async () => {
    if (!office) return;
    const p = await saveBytes(`HtoH_${office.pincode}_${ledger.businessDate}.csv`, utf8(vouchersCsv(ledger.vouchers)), { name: "CSV", extensions: ["csv"] });
    if (p) toast("success", "CSV exported", p);
  };
  const receiptPdf = async () => {
    if (!office || !activeHandover) return;
    const vouchers = ledger.vouchers.filter((v) => v.handover_id === activeHandover.id);
    const physical = (await api().getDenominations(office.id, activeHandover.business_date, "handover", activeHandover.id)).reduce((a, l) => a + l.amount, 0);
    const p = await saveBytes(`Handover_${office.pincode}_${activeHandover.business_date}_${activeHandover.counter_label.replace(/\s+/g, "")}.pdf`, buildHandoverReceiptPdf(office, activeHandover, vouchers, physical), { name: "PDF", extensions: ["pdf"] });
    if (p) toast("success", "Receipt PDF saved", p);
  };
  const printReceipt = async () => {
    if (!office || !activeHandover) return;
    const vouchers = ledger.vouchers.filter((v) => v.handover_id === activeHandover.id);
    const physical = (await api().getDenominations(office.id, activeHandover.business_date, "handover", activeHandover.id)).reduce((a, l) => a + l.amount, 0);
    await run("Slip sent to printer", () => printSlip(handoverSlipEscPos(office, activeHandover, vouchers, physical)));
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col border-r border-border">
      {/* handover bar */}
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="counter">Counter</Label>
          <Input id="counter" list="counters" value={ledger.counterLabel} onChange={(e) => ledger.setCounterLabel(e.target.value)} className="h-7 w-28" />
          <datalist id="counters">{["Counter 1", "Counter 2", "Counter 3", "SB Counter", "Mails Counter", "Treasury"].map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        {activeHandover ? (
          <Badge variant={activeHandover.status === "verified" ? "success" : activeHandover.status === "submitted" ? "info" : activeHandover.status === "rejected" ? "danger" : "muted"}>
            Sheet #{activeHandover.sequence_no} · {activeHandover.status.toUpperCase()}
          </Badge>
        ) : (
          <Badge variant="muted">No sheet yet — add a voucher to open one</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {activeHandover && activeHandover.status === "open" && (
            <Tip label="Hand the sheet over to the SPM / Treasury"><Button size="sm" variant="secondary" onClick={() => run("Handover submitted", () => ledger.submitHandover(activeHandover.id))}><Send className="h-3.5 w-3.5" /> Submit handover</Button></Tip>
          )}
          {activeHandover && activeHandover.status === "submitted" && isSupervisor && (
            <>
              <Button size="sm" variant="success" onClick={() => run("Handover verified", () => ledger.verifyHandover(activeHandover.id, true))}><ShieldCheck className="h-3.5 w-3.5" /> Accept sheet</Button>
              <Button size="sm" variant="danger" onClick={() => run("Handover rejected", () => ledger.verifyHandover(activeHandover.id, false, "rejected by SPM"))}><X className="h-3.5 w-3.5" /> Reject</Button>
            </>
          )}
          {activeHandover && <Tip label="Print hand-over slip (ESC/POS)"><Button size="sm" variant="ghost" onClick={() => void printReceipt()}><Printer className="h-3.5 w-3.5" /></Button></Tip>}
          {activeHandover && <Tip label="Hand-over receipt PDF"><Button size="sm" variant="ghost" onClick={() => void receiptPdf()}><FileDown className="h-3.5 w-3.5" /> PDF</Button></Tip>}
          <Tip label="Export vouchers to Excel"><Button size="sm" variant="ghost" onClick={() => void exportXlsx()}>XLSX</Button></Tip>
          <Tip label="Export vouchers to CSV"><Button size="sm" variant="ghost" onClick={() => void exportCsv()}>CSV</Button></Tip>
        </div>
      </div>

      {/* tabs + table */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 bg-background">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="all">All <span className="text-muted-foreground">{ledger.vouchers.length}</span></TabsTrigger>
            {CATEGORY_ORDER.map((c) => (
              <TabsTrigger key={c} value={c}>{CATEGORY_LABELS[c]} {catCounts[c] ? <span className="text-muted-foreground">{catCounts[c]}</span> : null}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
          <span>{totals.count} vouchers</span>
          <span>R <b className="num text-foreground">₹{Money.format(totals.receipts)}</b></span>
          <span>P <b className="num text-foreground">₹{Money.format(totals.payments)}</b></span>
          {!quickEntryOpen && <Button size="sm" onClick={() => setQuickEntryOpen(true)} disabled={dayClosed}><Plus className="h-3.5 w-3.5" /> New voucher <Kbd className="ml-1 bg-primary-foreground/20 text-primary-foreground border-transparent">F3</Kbd></Button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-8">#</TH><TH>Type</TH><TH>Account / Barcode</TH><TH className="text-right">Nos</TH><TH className="text-right">Amount</TH><TH>Flow</TH><TH>Reference</TH><TH>Submitted</TH><TH>Status</TH><TH className="w-28"></TH>
            </TR>
          </THead>
          <TBody>
            {visible.length === 0 && (
              <TR><TD colSpan={10} className="py-10 text-center text-muted-foreground">No vouchers {tab !== "all" ? `under ${CATEGORY_LABELS[tab]} ` : ""}for this date. Press <Kbd>F3</Kbd> or scan an article barcode to start.</TD></TR>
            )}
            {visible.map((v, i) => (
              <VoucherRow key={v.id} v={v} index={i + 1} selected={selected === v.id} onSelect={() => setSelected(v.id)} isSupervisor={!!isSupervisor} dayClosed={!!dayClosed} run={run} />
            ))}
          </TBody>
        </Table>
      </div>

      {(quickEntryOpen || ledger.editingVoucherId) && <QuickEntry onDone={() => { setQuickEntryOpen(false); ledger.setEditingVoucher(null); }} />}
    </section>
  );
}

function VoucherRow({ v, index, selected, onSelect, isSupervisor, dayClosed, run }: { v: VoucherItem; index: number; selected: boolean; onSelect: () => void; isSupervisor: boolean; dayClosed: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const ledger = useLedgerStore();
  const canEdit = !dayClosed && (v.verification_status === "pending" || isSupervisor);
  return (
    <TR data-selected={selected} onClick={onSelect} className={cn(v.verification_status === "rejected" && "opacity-60 line-through decoration-danger/60")}>
      <TD className="text-muted-foreground num">{index}</TD>
      <TD><div className="font-medium">{voucherTypeLabel(v.voucher_type)}</div><div className="text-[10.5px] text-muted-foreground">{CATEGORY_LABELS[v.category]}</div></TD>
      <TD className="num">{v.account_or_barcode_id || <span className="text-muted-foreground">—</span>}</TD>
      <TD className="text-right num">{v.voucher_count}</TD>
      <TD className="text-right num font-semibold">₹{Money.format(v.amount)}</TD>
      <TD><Badge variant={v.flow === "receipt" ? "info" : "outline"}>{v.flow === "receipt" ? "Receipt" : "Payment"}</Badge></TD>
      <TD className="num text-muted-foreground">{v.reference_id || "—"}</TD>
      <TD className="text-muted-foreground">{formatTs(v.submitted_at)}</TD>
      <TD><Badge variant={STATUS_VARIANT[v.verification_status]}>{v.verification_status}</Badge></TD>
      <TD>
        <div className="flex items-center justify-end gap-0.5">
          {isSupervisor && v.verification_status === "pending" && (
            <>
              <Tip label="Accept"><Button size="icon" variant="ghost" className="h-6 w-6 text-success" onClick={(e) => { e.stopPropagation(); void run("Voucher accepted", () => ledger.verifyVoucher(v.id, "accepted")); }}><Check className="h-3.5 w-3.5" /></Button></Tip>
              <Tip label="Reject"><Button size="icon" variant="ghost" className="h-6 w-6 text-danger" onClick={(e) => { e.stopPropagation(); void run("Voucher rejected", () => ledger.verifyVoucher(v.id, "rejected")); }}><X className="h-3.5 w-3.5" /></Button></Tip>
            </>
          )}
          {isSupervisor && v.verification_status !== "pending" && !dayClosed && (
            <Tip label="Reset to pending"><Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); void run("Voucher reset to pending", () => ledger.verifyVoucher(v.id, "pending")); }}><Undo2 className="h-3.5 w-3.5" /></Button></Tip>
          )}
          {canEdit && <Tip label="Edit"><Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); ledger.setEditingVoucher(v.id); }}><Pencil className="h-3.5 w-3.5" /></Button></Tip>}
          {canEdit && <Tip label="Delete"><Button size="icon" variant="ghost" className="h-6 w-6 text-danger" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${voucherTypeLabel(v.voucher_type)} ₹${Money.format(v.amount)}? This is recorded in the audit trail.`)) void run("Voucher deleted", () => ledger.deleteVoucher(v.id, "deleted from ledger")); }}><Trash2 className="h-3.5 w-3.5" /></Button></Tip>}
        </div>
      </TD>
    </TR>
  );
}

function QuickEntry({ onDone }: { onDone: () => void }) {
  const ledger = useLedgerStore();
  const toast = useUiStore((s) => s.toast);
  const editing = ledger.vouchers.find((v) => v.id === ledger.editingVoucherId) ?? null;
  const [category, setCategory] = useState<VoucherCategory>(editing?.category ?? "savings_bank");
  const [type, setType] = useState(editing?.voucher_type ?? "SB");
  const [flow, setFlow] = useState<Flow>(editing?.flow ?? "receipt");
  const [accountId, setAccountId] = useState(editing?.account_or_barcode_id ?? "");
  const [count, setCount] = useState(editing?.voucher_count ?? 1);
  const [amount, setAmount] = useState(editing?.amount ?? 0);
  const [reference, setReference] = useState(editing?.reference_id ?? "");
  const [remarks, setRemarks] = useState(editing?.remarks ?? "");
  const [busy, setBusy] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const typeDef = voucherTypeDef(type);

  // scanner result routes here
  useEffect(() => {
    if (!ledger.pendingScan) return;
    const info = classifyBarcode(ledger.pendingScan);
    setAccountId(info.normalized);
    if (info.suggested_voucher_type) {
      const def = voucherTypeDef(info.suggested_voucher_type);
      if (def) {
        setCategory(def.category);
        setType(def.code);
        setFlow(def.defaultFlow);
      }
    }
    ledger.setPendingScan(null);
    setTimeout(() => amountRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger.pendingScan]);

  useEffect(() => {
    if (!editing) idRef.current?.focus();
  }, [editing]);

  const typeOptions = VOUCHER_TYPES.filter((t) => t.category === category).map((t) => ({ value: t.code, label: t.label }));
  const onCategory = (c: VoucherCategory) => {
    setCategory(c);
    const first = VOUCHER_TYPES.find((t) => t.category === c)!;
    setType(first.code);
    setFlow(first.defaultFlow);
  };
  const onType = (code: string) => {
    setType(code);
    const def = voucherTypeDef(code);
    if (def) setFlow(def.defaultFlow);
  };

  const submit = async (e: React.FormEvent, keepOpen: boolean) => {
    e.preventDefault();
    if (count < 1) return toast("error", "Number of vouchers must be at least 1");
    const input: VoucherInput = { category, voucher_type: type, flow, account_or_barcode_id: accountId.trim(), voucher_count: count, amount, reference_id: reference.trim(), remarks: remarks.trim() };
    setBusy(true);
    try {
      if (editing) {
        await ledger.updateVoucher(editing.id, input);
        toast("success", "Voucher updated");
        onDone();
      } else {
        await ledger.addVoucher(input);
        toast("success", `${voucherTypeLabel(type)} ₹${Money.format(amount)} added`);
        setAccountId("");
        setAmount(0);
        setReference("");
        setRemarks("");
        setCount(1);
        if (keepOpen) idRef.current?.focus(); else onDone();
      }
    } catch (err) {
      toast("error", "Could not save voucher", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onDone(); }
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target as HTMLElement).closest("button")) {
      e.preventDefault();
      // Enter walks to the next field; Enter on the amount field saves & continues
      if (e.target === amountRef.current) void submit(e as unknown as React.FormEvent, true);
      else {
        const form = (e.currentTarget as HTMLFormElement);
        const fields = [...form.querySelectorAll<HTMLElement>("input,select,button[role=combobox],textarea")].filter((f) => !f.hasAttribute("disabled"));
        const idx = fields.indexOf(e.target as HTMLElement);
        fields[idx + 1]?.focus();
      }
    }
  };

  return (
    <Card className="no-print m-2 mt-0 shrink-0 border-primary/40 shadow-md">
      <CardHeader>
        <CardTitle className="text-primary">{editing ? "Edit voucher" : "New voucher / article"} <span className="normal-case tracking-normal font-normal text-muted-foreground">· Enter moves on, Enter on amount saves, Esc closes</span></CardTitle>
        <div className="flex items-center gap-1"><Kbd>F3</Kbd><Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDone} aria-label="Close"><X className="h-3.5 w-3.5" /></Button></div>
      </CardHeader>
      <CardBody>
        <form onSubmit={(e) => submit(e, false)} onKeyDown={onKeyDown} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3 space-y-1"><Label>Category</Label><Select value={category} onValueChange={(v) => onCategory(v as VoucherCategory)} options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} /></div>
          <div className="col-span-3 space-y-1"><Label>Voucher type</Label><Select key={category} value={type} onValueChange={onType} options={typeOptions} /></div>
          <div className="col-span-2 space-y-1">
            <Label>Flow</Label>
            <div className="flex h-8 rounded-md border border-input overflow-hidden text-[12px]">
              {(["receipt", "payment"] as Flow[]).map((f) => (
                <button key={f} type="button" disabled={!typeDef?.flowSwitchable} onClick={() => setFlow(f)} className={cn("flex-1 capitalize", flow === f ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent", !typeDef?.flowSwitchable && "opacity-70 cursor-default")}>{f}</button>
              ))}
            </div>
          </div>
          <div className="col-span-4 space-y-1"><Label>{typeDef?.idLabel ?? "Account / Barcode ID"}</Label><Input ref={idRef} data-accepts-scan value={accountId} onChange={(e) => setAccountId(e.target.value.toUpperCase())} placeholder="Scan or type" className="num" /></div>
          <div className="col-span-1 space-y-1"><Label>Nos</Label><Input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} className="num text-right" onFocus={(e) => e.target.select()} /></div>
          <div className="col-span-3 space-y-1"><Label>Amount (₹)</Label><MoneyInput ref={amountRef} valuePaise={amount} onChangePaise={setAmount} placeholder="0.00" className="h-9 text-[15px] font-semibold" /></div>
          <div className="col-span-3 space-y-1"><Label>SAP document / batch ID</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} className="num" /></div>
          <div className="col-span-3 space-y-1"><Label>Remarks</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
          <div className="col-span-2 flex gap-1 justify-end">
            <Button type="submit" disabled={busy}>{editing ? <><CheckCheck className="h-3.5 w-3.5" /> Save</> : <><Plus className="h-3.5 w-3.5" /> Add</>}</Button>
          </div>
        </form>
        {accountId && classifyBarcode(accountId).kind === "s10_bad_check_digit" && <p className="mt-1.5 text-[11px] text-warning-foreground dark:text-warning">S10 check digit does not match — double-check the article number.</p>}
      </CardBody>
    </Card>
  );
}
