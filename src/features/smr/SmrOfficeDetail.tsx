import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileDown, FileSpreadsheet, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { TopBar, StatusBar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, MoneyInput } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useSmrStore } from "@/store/smr";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { api } from "@/lib/ipc";
import type { SmrEntry, StampStock } from "@/lib/types";
import { STOCK_CATEGORIES } from "@/lib/constants";
import { Money } from "@/lib/money";
import { cn, errorMessage, formatTs } from "@/lib/utils";
import { buildPa17Pdf } from "@/lib/export/pdf";
import { buildSmrWorkbook } from "@/lib/export/xlsx";
import { saveBytes } from "@/lib/export/save";
import { SMR_STATUS } from "./SmrHub";

type DayEdit = Pick<SmrEntry, "stamps_received" | "stamps_remitted" | "postage_stamps" | "revenue_stamps" | "other_stamps" | "liabilities_note"> & { cash_received_override: number | null; cash_remitted_override: number | null };

const emptyEdit = (): DayEdit => ({ stamps_received: 0, stamps_remitted: 0, postage_stamps: 0, revenue_stamps: 0, other_stamps: 0, liabilities_note: "", cash_received_override: null, cash_remitted_override: null });

export function SmrOfficeDetail({ officeId, onBack }: { officeId: string; onBack: () => void }) {
  const { month, reports, compileOffice } = useSmrStore();
  const isSupervisor = useSessionStore((s) => s.session?.actor.role === "supervisor");
  const toast = useUiStore((s) => s.toast);
  const report = reports[officeId];
  const [entries, setEntries] = useState<Record<string, DayEdit>>({});
  const [header, setHeader] = useState<{ opening: number | null; sectioned: number | null }>({ opening: null, sectioned: null });
  const [stock, setStock] = useState<Record<string, { opening: number; receipts: number; sales: number }>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [list, st] = await Promise.all([api().listSmrEntries(officeId, month), api().listStampStock(officeId, month)]);
    const map: Record<string, DayEdit> = {};
    for (const e of list) {
      if (e.business_date === month) setHeader({ opening: e.opening_balance_of_month, sectioned: e.sectioned_stamp_balance });
      else map[e.business_date] = { stamps_received: e.stamps_received, stamps_remitted: e.stamps_remitted, postage_stamps: e.postage_stamps, revenue_stamps: e.revenue_stamps, other_stamps: e.other_stamps, liabilities_note: e.liabilities_note, cash_received_override: e.cash_received_override, cash_remitted_override: e.cash_remitted_override };
    }
    setEntries(map);
    const s: Record<string, { opening: number; receipts: number; sales: number }> = {};
    for (const x of st) s[x.category] = { opening: x.opening, receipts: x.receipts, sales: x.sales };
    setStock(s);
    setDirty(new Set());
  };
  useEffect(() => {
    void load();
    if (!report) void compileOffice(officeId).catch((e) => toast("error", "Compile failed", errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId, month]);

  const edit = (date: string, patch: Partial<DayEdit>) => {
    setEntries((m) => ({ ...m, [date]: { ...(m[date] ?? emptyEdit()), ...patch } }));
    setDirty((d) => new Set(d).add(date));
  };
  const editStock = (cat: string, patch: Partial<{ opening: number; receipts: number; sales: number }>) => {
    setStock((s) => ({ ...s, [cat]: { ...(s[cat] ?? { opening: 0, receipts: 0, sales: 0 }), ...patch } }));
    setDirty((d) => new Set(d).add(`stock:${cat}`));
  };

  const saveAll = async () => {
    if (!report) return;
    setBusy(true);
    try {
      for (const key of dirty) {
        if (key.startsWith("stock:")) {
          const cat = key.slice(6);
          const s = stock[cat]!;
          await api().saveStampStock(officeId, month, cat, s.opening, s.receipts, s.sales);
        } else if (key === "header") {
          await api().saveSmrEntry({ office_id: officeId, report_month: month, business_date: month, stamps_received: 0, stamps_remitted: 0, postage_stamps: 0, revenue_stamps: 0, other_stamps: 0, cash_received_override: null, cash_remitted_override: null, liabilities_note: "", opening_balance_of_month: header.opening, sectioned_stamp_balance: header.sectioned, signed_off_by: null, signed_off_at: null });
        } else {
          const e = entries[key] ?? emptyEdit();
          await api().saveSmrEntry({ office_id: officeId, report_month: month, business_date: key, ...e, opening_balance_of_month: null, sectioned_stamp_balance: null, signed_off_by: null, signed_off_at: null });
        }
      }
      await compileOffice(officeId);
      await load();
      toast("success", "Monthly data saved and PA-17 recompiled");
    } catch (e) {
      toast("error", "Save failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const signOff = async () => {
    if (!confirm(`Sign off the ${report?.month_label} report for ${report?.office.name}? Operators will no longer be able to edit it.`)) return;
    try {
      await api().signOffSmr(officeId, month);
      await compileOffice(officeId);
      await load();
      toast("success", "SMR signed off");
    } catch (e) {
      toast("error", "Sign-off failed", errorMessage(e));
    }
  };
  const pdf = async () => {
    if (!report) return;
    const p = await saveBytes(`PA17_${report.office.pincode}_${month}.pdf`, buildPa17Pdf(report), { name: "PDF", extensions: ["pdf"] });
    if (p) toast("success", "PA-17 PDF saved", p);
  };
  const xlsx = async () => {
    if (!report) return;
    const p = await saveBytes(`SMR_${report.office.pincode}_${month}.xlsx`, await buildSmrWorkbook([report]), { name: "Excel workbook", extensions: ["xlsx"] });
    if (p) toast("success", "Excel exported", p);
  };

  const stockRows = useMemo(() => STOCK_CATEGORIES.map((c) => ({ ...c, v: stock[c.key] ?? { opening: 0, receipts: 0, sales: 0 } })), [stock]);

  if (!report) return <><TopBar title="SMR" /><div className="flex-1 grid place-items-center text-muted-foreground text-sm">Compiling…</div></>;
  const s = SMR_STATUS[report.status];
  const locked = !!report.signed_off_at && !isSupervisor;

  return (
    <>
      <TopBar title={`${report.office.name} — PA-17 ${report.month_label}`}>
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> Hub</Button>
        <Badge variant={s.variant}>{s.label}</Badge>
        {report.signed_off_at && <Badge variant="success"><ShieldCheck className="h-3 w-3" /> Signed off {formatTs(report.signed_off_at)}</Badge>}
      </TopBar>
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2"><Label>Opening balance of month</Label><MoneyInput valuePaise={header.opening ?? report.opening_balance_of_month} onChangePaise={(p) => { setHeader((h) => ({ ...h, opening: p })); setDirty((d) => new Set(d).add("header")); }} className="w-36" disabled={locked} /></div>
        <div className="flex items-center gap-2"><Label>Sectioned stamp balance</Label><MoneyInput valuePaise={header.sectioned ?? report.sectioned_stamp_balance} onChangePaise={(p) => { setHeader((h) => ({ ...h, sectioned: p })); setDirty((d) => new Set(d).add("header")); }} className="w-36" disabled={locked} /></div>
        <span className="text-xs text-muted-foreground">Max ₹{Money.format(report.office.max_cash_limit)} · Min ₹{Money.format(report.office.min_cash_limit)}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void compileOffice(officeId).then(load)}><RefreshCw className="h-3.5 w-3.5" /> Recompile</Button>
          <Button variant="secondary" size="sm" onClick={() => void pdf()}><FileDown className="h-3.5 w-3.5" /> PA-17 PDF</Button>
          <Button variant="secondary" size="sm" onClick={() => void xlsx()}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</Button>
          {isSupervisor && !report.signed_off_at && <Button variant="success" size="sm" onClick={() => void signOff()}><ShieldCheck className="h-3.5 w-3.5" /> Sign off</Button>}
          <Button size="sm" onClick={() => void saveAll()} disabled={busy || dirty.size === 0 || locked}><Save className="h-3.5 w-3.5" /> Save monthly data{dirty.size ? ` (${dirty.size})` : ""}</Button>
        </div>
      </div>
      {report.flags.length > 0 && (
        <div className="border-b border-border bg-warning/10 px-4 py-1.5 text-[12px] flex flex-wrap gap-x-4 gap-y-0.5">{report.flags.map((f) => <span key={f}>• {f}</span>)}</div>
      )}
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Date</TH><TH className="text-right">Opening</TH><TH className="text-right">Receipts</TH><TH className="text-right">Payments</TH><TH className="text-right">Closing</TH>
              <TH className="text-right">Cash received</TH><TH className="text-right">Cash remitted</TH><TH className="text-right">Stamps recd.</TH><TH className="text-right">Stamps remitted</TH>
              <TH className="text-right">Postage</TH><TH className="text-right">Revenue</TH><TH className="text-right">Other</TH><TH className="text-right">Cash in hand</TH><TH>Liabilities &amp; explanation</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {report.rows.map((r) => {
              const e = entries[r.date] ?? emptyEdit();
              const breach = r.max_breach !== null || r.min_breach !== null;
              return (
                <TR key={r.date} className={cn(r.is_holiday && "bg-muted/40 text-muted-foreground", breach && "bg-danger/8")}>
                  <TD className="whitespace-nowrap num">{String(r.day).padStart(2, "0")} <span className="text-muted-foreground">{r.weekday}</span>{r.is_holiday && <Badge variant="muted" className="ml-1">H</Badge>}</TD>
                  <TD className="text-right num">{r.has_record ? Money.format(r.opening_balance, { register: true }) : "—"}</TD>
                  <TD className="text-right num">{r.has_record ? Money.format(r.total_receipts, { register: true }) : "—"}</TD>
                  <TD className="text-right num">{r.has_record ? Money.format(r.total_payments, { register: true }) : "—"}</TD>
                  <TD className={cn("text-right num font-semibold", breach && "text-danger")}>{r.has_record ? Money.format(r.closing_balance, { register: true }) : "—"}</TD>
                  <TD><MoneyInput valuePaise={e.cash_received_override ?? r.cash_received} onChangePaise={(p) => edit(r.date, { cash_received_override: p })} className={cn("h-7 w-24", e.cash_received_override === null && "text-muted-foreground")} disabled={locked} /></TD>
                  <TD><MoneyInput valuePaise={e.cash_remitted_override ?? r.cash_remitted} onChangePaise={(p) => edit(r.date, { cash_remitted_override: p })} className={cn("h-7 w-24", e.cash_remitted_override === null && "text-muted-foreground")} disabled={locked} /></TD>
                  <TD><MoneyInput valuePaise={e.stamps_received} onChangePaise={(p) => edit(r.date, { stamps_received: p })} className="h-7 w-24" disabled={locked} /></TD>
                  <TD><MoneyInput valuePaise={e.stamps_remitted} onChangePaise={(p) => edit(r.date, { stamps_remitted: p })} className="h-7 w-24" disabled={locked} /></TD>
                  <TD><MoneyInput valuePaise={e.postage_stamps} onChangePaise={(p) => edit(r.date, { postage_stamps: p })} className="h-7 w-22" disabled={locked} /></TD>
                  <TD><MoneyInput valuePaise={e.revenue_stamps} onChangePaise={(p) => edit(r.date, { revenue_stamps: p })} className="h-7 w-22" disabled={locked} /></TD>
                  <TD><MoneyInput valuePaise={e.other_stamps} onChangePaise={(p) => edit(r.date, { other_stamps: p })} className="h-7 w-22" disabled={locked} /></TD>
                  <TD className="text-right num">{r.has_record ? Money.format(r.cash_in_hand, { register: true }) : "—"}</TD>
                  <TD><Input value={e.liabilities_note} onChange={(ev) => edit(r.date, { liabilities_note: ev.target.value })} className="h-7 min-w-48" placeholder={breach ? "Explain the excess cash" : ""} disabled={locked} /></TD>
                  <TD className="whitespace-nowrap text-[11px]">
                    {r.max_breach !== null && <Badge variant="danger">+₹{Money.format(r.max_breach, { register: true })} over max</Badge>}
                    {r.min_breach !== null && <Badge variant="danger">₹{Money.format(r.min_breach, { register: true })} below min</Badge>}
                    {r.pending_vouchers > 0 && <Badge variant="warning">{r.pending_vouchers} pending</Badge>}
                    {r.has_record && !r.is_holiday && !r.day_closed && <Badge variant="muted">not closed</Badge>}
                  </TD>
                </TR>
              );
            })}
            <TR className="font-semibold bg-muted/60 hover:bg-muted/60">
              <TD>TOTAL</TD><TD></TD><TD className="text-right num">{Money.format(report.totals.total_receipts, { register: true })}</TD><TD className="text-right num">{Money.format(report.totals.total_payments, { register: true })}</TD><TD className="text-right num">{Money.format(report.closing_balance_of_month, { register: true })}</TD>
              <TD className="text-right num">{Money.format(report.totals.cash_received, { register: true })}</TD><TD className="text-right num">{Money.format(report.totals.cash_remitted, { register: true })}</TD><TD className="text-right num">{Money.format(report.totals.stamps_received, { register: true })}</TD><TD className="text-right num">{Money.format(report.totals.stamps_remitted, { register: true })}</TD>
              <TD colSpan={6}></TD>
            </TR>
          </TBody>
        </Table>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="px-3 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Stamp &amp; stationery stock (month)</div>
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-[11px] uppercase text-muted-foreground"><th className="text-left px-3 py-1">Category</th><th className="text-right px-2">Opening</th><th className="text-right px-2">Receipts</th><th className="text-right px-2">Sales</th><th className="text-right px-3">Closing</th></tr></thead>
              <tbody>
                {stockRows.map((c) => (
                  <tr key={c.key} className="border-t border-border">
                    <td className="px-3 py-1">{c.label}</td>
                    <td className="px-2 py-1"><MoneyInput valuePaise={c.v.opening} onChangePaise={(p) => editStock(c.key, { opening: p })} className="h-7" disabled={locked} /></td>
                    <td className="px-2 py-1"><MoneyInput valuePaise={c.v.receipts} onChangePaise={(p) => editStock(c.key, { receipts: p })} className="h-7" disabled={locked} /></td>
                    <td className="px-2 py-1"><MoneyInput valuePaise={c.v.sales} onChangePaise={(p) => editStock(c.key, { sales: p })} className="h-7" disabled={locked} /></td>
                    <td className={cn("px-3 py-1 text-right num font-semibold", c.v.opening + c.v.receipts - c.v.sales < 0 && "text-danger")}>{Money.format(c.v.opening + c.v.receipts - c.v.sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-border bg-card">
            <div className="px-3 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cash limit violation log</div>
            {report.violations.length === 0 ? <p className="p-3 text-muted-foreground text-[12.5px]">No breaches of the authorised limits this month.</p> : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-[11px] uppercase text-muted-foreground"><th className="text-left px-3 py-1">Date</th><th className="text-left">Limit</th><th className="text-right px-2">Authorised</th><th className="text-right px-2">Closing</th><th className="text-right px-3">Breach</th></tr></thead>
                <tbody>{report.violations.map((v) => (
                  <tr key={v.id} className="border-t border-border"><td className="px-3 py-1 num">{v.business_date}</td><td><Badge variant="danger">{v.limit_type === "max" ? "Over maximum" : "Below minimum"}</Badge></td><td className="text-right px-2 num">{Money.format(v.limit)}</td><td className="text-right px-2 num">{Money.format(v.closing_balance)}</td><td className="text-right px-3 num font-semibold text-danger">{Money.format(v.breach)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      <StatusBar left={<span>Working days {report.totals.working_days} · recorded {report.totals.days_recorded} · closed {report.totals.days_closed} · highest ₹{Money.format(report.totals.highest_closing)} · lowest ₹{Money.format(report.totals.lowest_closing)}</span>} right={dirty.size ? <span className="text-warning-foreground dark:text-warning">{dirty.size} unsaved change(s)</span> : null} />
    </>
  );
}

export type { StampStock };
