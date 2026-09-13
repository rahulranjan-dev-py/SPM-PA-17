import { useEffect, useState } from "react";
import { FileSpreadsheet, RefreshCw, ScrollText } from "lucide-react";
import { TopBar, StatusBar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOfficeStore } from "@/store/office";
import { useUiStore } from "@/store/ui";
import { api } from "@/lib/ipc";
import type { AuditLog } from "@/lib/types";
import { buildAuditWorkbook } from "@/lib/export/xlsx";
import { saveBytes } from "@/lib/export/save";
import { errorMessage } from "@/lib/utils";

const ENTITY_OPTIONS = [
  { value: "*", label: "All entities" },
  { value: "voucher", label: "Vouchers" },
  { value: "handover", label: "Hand-overs" },
  { value: "cash_denominations", label: "Cash counts" },
  { value: "daily_closing", label: "Daily closings / overrides" },
  { value: "smr_entry", label: "SMR entries" },
  { value: "smr_report", label: "SMR compilations" },
  { value: "office", label: "Offices" },
  { value: "user", label: "Users / logins" },
  { value: "database", label: "Backups / restore" },
];

export function AuditPage() {
  const office = useOfficeStore((s) => s.currentOffice());
  const toast = useUiStore((s) => s.toast);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [entity, setEntity] = useState("*");
  const [scope, setScope] = useState<"office" | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const load = () => api().listAuditLogs(scope === "office" ? office?.id ?? null : null, entity === "*" ? null : entity, 1000).then(setLogs).catch((e) => toast("error", "Could not load audit trail", errorMessage(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, scope, office?.id]);
  const filtered = logs.filter((l) => !q || `${l.action} ${l.username} ${l.entity_id} ${l.note} ${l.after_json ?? ""} ${l.before_json ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const exportXlsx = async () => {
    const p = await saveBytes(`Audit_${new Date().toISOString().slice(0, 10)}.xlsx`, await buildAuditWorkbook(filtered), { name: "Excel workbook", extensions: ["xlsx"] });
    if (p) toast("success", "Audit trail exported", p);
  };
  return (
    <>
      <TopBar title="Audit Trail"><Badge variant="muted"><ScrollText className="h-3 w-3" /> append-only · engine-enforced</Badge></TopBar>
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Select value={entity} onValueChange={setEntity} options={ENTITY_OPTIONS} className="w-56" />
        <Select value={scope} onValueChange={(v) => setScope(v as "office" | "all")} options={[{ value: "all", label: "All offices" }, { value: "office", label: office ? `Only ${office.name}` : "Current office" }]} className="w-48" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, user, id, JSON…" className="w-72" />
        <div className="ml-auto flex gap-1"><Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></Button><Button variant="secondary" size="sm" onClick={() => void exportXlsx()}><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</Button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <Table>
          <THead><TR className="hover:bg-transparent"><TH className="w-14">#</TH><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Entity</TH><TH>Note</TH><TH>Change</TH></TR></THead>
          <TBody>
            {filtered.length === 0 && <TR><TD colSpan={7} className="py-10 text-center text-muted-foreground">No audit rows match.</TD></TR>}
            {filtered.map((l) => (
              <TR key={l.id} className="cursor-pointer align-top" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <TD className="num text-muted-foreground">{l.id}</TD>
                <TD className="num whitespace-nowrap">{l.occurred_at.replace("T", " ").replace(/Z$/, "")}</TD>
                <TD>{l.username} <Badge variant={l.role === "supervisor" ? "info" : "muted"} className="ml-1">{l.role}</Badge></TD>
                <TD><Badge variant={l.action.includes("delete") || l.action.includes("reject") || l.action.includes("override") ? "danger" : l.action.includes("verify") || l.action.includes("close") || l.action.includes("signoff") ? "success" : "outline"}>{l.action}</Badge></TD>
                <TD className="num text-muted-foreground">{l.entity_type}{l.entity_id ? ` · ${l.entity_id.slice(0, 24)}` : ""}</TD>
                <TD className="max-w-[260px] truncate">{l.note}</TD>
                <TD className="max-w-[420px]">
                  {open === l.id ? (
                    <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono whitespace-pre-wrap break-all">
                      <div><div className="text-muted-foreground uppercase">before</div>{pretty(l.before_json)}</div>
                      <div><div className="text-muted-foreground uppercase">after</div>{pretty(l.after_json)}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-[11px] truncate block">{(l.after_json ?? l.before_json ?? "").slice(0, 120)}</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <StatusBar left={<span>{filtered.length} row(s). Every voucher change, deletion, cash override, verification, sign-off and login is recorded; UPDATE/DELETE on the log is rejected by SQLite triggers.</span>} />
    </>
  );
}

function pretty(json: string | null): string {
  if (!json) return "—";
  try {
    return JSON.stringify(JSON.parse(json), null, 1);
  } catch {
    return json;
  }
}
