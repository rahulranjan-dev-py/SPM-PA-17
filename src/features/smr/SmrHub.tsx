import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Play, RefreshCw, Table2 } from "lucide-react";
import { TopBar, StatusBar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tip } from "@/components/ui/tooltip";
import { useOfficeStore } from "@/store/office";
import { useSmrStore } from "@/store/smr";
import { useUiStore } from "@/store/ui";
import type { SmrBatchSummary, SmrStatus } from "@/lib/types";
import { Money } from "@/lib/money";
import { currentMonth, errorMessage, formatMonth, formatTs, shiftMonth } from "@/lib/utils";
import { buildPa17Pdf } from "@/lib/export/pdf";
import { buildSmrWorkbook } from "@/lib/export/xlsx";
import { smrCsv } from "@/lib/export/csv";
import { saveBytes, utf8 } from "@/lib/export/save";
import { api } from "@/lib/ipc";
import { SmrOfficeDetail } from "./SmrOfficeDetail";

export const SMR_STATUS: Record<SmrStatus, { label: string; variant: "success" | "warning" | "danger" | "muted" }> = {
  ready: { label: "Ready to export", variant: "success" },
  pending_vouchers: { label: "Pending vouchers", variant: "warning" },
  cash_limit_breached: { label: "Cash limit breached", variant: "danger" },
  no_data: { label: "No data", variant: "muted" },
};

export function SmrHub() {
  const { month, setMonth, summaries, reports, compiling, lastCompiledAt, compileAll } = useSmrStore();
  const allOffices = useOfficeStore((s) => s.offices);
  const offices = useMemo(() => allOffices.filter((o) => o.active), [allOffices]);
  const toast = useUiStore((s) => s.toast);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (summaries.length === 0 && offices.length > 0) void compileAll().catch((e) => toast("error", "SMR compile failed", errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, offices.length]);

  const rows: SmrBatchSummary[] = offices.map((o) => summaries.find((s) => s.office_id === o.id) ?? { office_id: o.id, office_name: o.name, month, status: "no_data", flags: [], working_days: 0, days_recorded: 0, pending_vouchers: 0, violations: 0, closing_balance_of_month: 0, signed_off: false });
  const all = Object.values(reports);

  const pdfFor = async (officeId: string) => {
    const r = reports[officeId];
    if (!r) return toast("warning", "Compile first");
    const p = await saveBytes(`PA17_${r.office.pincode}_${month}.pdf`, buildPa17Pdf(r), { name: "PDF", extensions: ["pdf"] });
    if (p) toast("success", "PA-17 PDF saved", p);
  };
  const xlsxFor = async (officeId?: string) => {
    const list = officeId ? [reports[officeId]].filter((x): x is NonNullable<typeof x> => !!x) : all;
    if (!list.length) return toast("warning", "Compile first");
    const p = await saveBytes(`SMR_${officeId ? list[0]!.office.pincode : "all_SO"}_${month}.xlsx`, await buildSmrWorkbook(list), { name: "Excel workbook", extensions: ["xlsx"] });
    if (p) toast("success", "Excel exported", p);
  };
  const csvAll = async () => {
    if (!all.length) return toast("warning", "Compile first");
    const p = await saveBytes(`SMR_all_SO_${month}.csv`, utf8(smrCsv(all)), { name: "CSV", extensions: ["csv"] });
    if (p) toast("success", "CSV exported", p);
  };
  const pdfAll = async () => {
    if (!all.length) return toast("warning", "Compile first");
    const dir = await api().openDialog([], true);
    if (!dir) return;
    let n = 0;
    for (const r of all) {
      await api().writeFile(`${dir}/PA17_${r.office.pincode}_${month}.pdf`, buildPa17Pdf(r));
      n++;
    }
    toast("success", `${n} PA-17 PDF(s) written`, dir);
  };

  if (detail) return <SmrOfficeDetail officeId={detail} onBack={() => setDetail(null)} />;

  return (
    <>
      <TopBar title="SMR Hub — Sub Postmaster's Monthly Report (PA-17)">
        <div className="flex items-center gap-1 ml-2">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <input type="month" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-7 rounded-md border border-input bg-card px-2 text-[12.5px] num" />
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground ml-1">{formatMonth(month)}</span>
        </div>
      </TopBar>
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Button onClick={() => void compileAll().then(() => toast("success", "SMR compiled for all offices")).catch((e) => toast("error", "Compile failed", errorMessage(e)))} disabled={compiling}>
          {compiling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Compile all offices <Kbd className="ml-1 bg-primary-foreground/20 text-primary-foreground border-transparent">F10</Kbd>
        </Button>
        <span className="text-xs text-muted-foreground">{lastCompiledAt ? `Last compiled ${formatTs(lastCompiledAt)}` : "Not compiled yet"} · {offices.length} office(s)</span>
        <div className="ml-auto flex items-center gap-1">
          <Tip label="One PA-17 PDF per office into a folder"><Button variant="secondary" size="sm" onClick={() => void pdfAll()}><FileDown className="h-3.5 w-3.5" /> Batch PDF</Button></Tip>
          <Tip label="One workbook, one sheet per office"><Button variant="secondary" size="sm" onClick={() => void xlsxFor()}><FileSpreadsheet className="h-3.5 w-3.5" /> Batch Excel</Button></Tip>
          <Tip label="Flat CSV of every day row for audits"><Button variant="secondary" size="sm" onClick={() => void csvAll()}><Table2 className="h-3.5 w-3.5" /> CSV</Button></Tip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <Table>
          <THead>
            <TR className="hover:bg-transparent"><TH>Sub Office</TH><TH>Status</TH><TH className="text-right">Working days</TH><TH className="text-right">Recorded</TH><TH className="text-right">Pending</TH><TH className="text-right">Limit breaches</TH><TH className="text-right">Closing balance</TH><TH>Validation flags</TH><TH>Sign-off</TH><TH className="w-40"></TH></TR>
          </THead>
          <TBody>
            {rows.length === 0 && <TR><TD colSpan={10} className="py-10 text-center text-muted-foreground">No offices configured. Add Sub Offices under Offices &amp; Settings.</TD></TR>}
            {rows.map((r) => {
              const s = SMR_STATUS[r.status];
              return (
                <TR key={r.office_id} className="cursor-pointer" onClick={() => setDetail(r.office_id)}>
                  <TD className="font-medium">{r.office_name}</TD>
                  <TD><Badge variant={s.variant}>{s.label}</Badge></TD>
                  <TD className="text-right num">{r.working_days}</TD>
                  <TD className="text-right num">{r.days_recorded}</TD>
                  <TD className="text-right num">{r.pending_vouchers > 0 ? <span className="text-warning-foreground dark:text-warning font-semibold">{r.pending_vouchers}</span> : 0}</TD>
                  <TD className="text-right num">{r.violations > 0 ? <span className="text-danger font-semibold">{r.violations}</span> : 0}</TD>
                  <TD className="text-right num">₹{Money.format(r.closing_balance_of_month)}</TD>
                  <TD className="text-[11.5px] text-muted-foreground max-w-[360px]"><ul className="list-disc pl-4">{r.flags.map((f) => <li key={f}>{f}</li>)}</ul>{r.flags.length === 0 && r.status !== "no_data" && <span className="text-success">All checks passed</span>}</TD>
                  <TD>{r.signed_off ? <Badge variant="success">Signed off</Badge> : <Badge variant="muted">Unsigned</Badge>}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Tip label="PA-17 PDF"><Button size="sm" variant="ghost" onClick={() => void pdfFor(r.office_id)}><FileDown className="h-3.5 w-3.5" /> PDF</Button></Tip>
                      <Tip label="Excel"><Button size="sm" variant="ghost" onClick={() => void xlsxFor(r.office_id)}><FileSpreadsheet className="h-3.5 w-3.5" /> XLSX</Button></Tip>
                      <Button size="sm" variant="outline" onClick={() => setDetail(r.office_id)}>Open</Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
      <StatusBar left={<span>Batch engine compiles every active Sub Office for the selected month; exports use the last compiled snapshot.</span>} />
    </>
  );
}
