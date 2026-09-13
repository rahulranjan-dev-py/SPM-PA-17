import { useEffect, useState } from "react";
import { Building2, CalendarOff, DatabaseBackup, FolderOpen, HardDriveDownload, Plus, Printer, RotateCcw, ShieldAlert, UserPlus, Users } from "lucide-react";
import { TopBar, StatusBar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useOfficeStore } from "@/store/office";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { api, isTauri } from "@/lib/ipc";
import type { BackupInfo, Holiday, Office, PrintTarget, Role, User } from "@/lib/types";
import { Money } from "@/lib/money";
import { errorMessage, formatTs, todayIso } from "@/lib/utils";
import { OfficeConfigDialog } from "@/features/smr/OfficeConfigDialog";
import { parsePrintTarget, PRINTER_SETTING_KEY } from "./printer";
import { EscPos } from "@/lib/print/slip";

export function SettingsPage() {
  const isSupervisor = useSessionStore((s) => s.session?.actor.role === "supervisor");
  return (
    <>
      <TopBar title="Offices & Settings">{!isSupervisor && <Badge variant="warning"><ShieldAlert className="h-3 w-3" /> Read-only for operators</Badge>}</TopBar>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-4">
        <Tabs defaultValue="offices">
          <TabsList className="mb-3">
            <TabsTrigger value="offices"><Building2 className="h-3.5 w-3.5" /> Sub Offices</TabsTrigger>
            <TabsTrigger value="users"><Users className="h-3.5 w-3.5" /> Users & access</TabsTrigger>
            <TabsTrigger value="holidays"><CalendarOff className="h-3.5 w-3.5" /> Holidays</TabsTrigger>
            <TabsTrigger value="backup"><DatabaseBackup className="h-3.5 w-3.5" /> Backup & restore</TabsTrigger>
            <TabsTrigger value="printing"><Printer className="h-3.5 w-3.5" /> Printing</TabsTrigger>
          </TabsList>
          <TabsContent value="offices"><OfficesTab canEdit={!!isSupervisor} /></TabsContent>
          <TabsContent value="users"><UsersTab canEdit={!!isSupervisor} /></TabsContent>
          <TabsContent value="holidays"><HolidaysTab /></TabsContent>
          <TabsContent value="backup"><BackupTab canEdit={!!isSupervisor} /></TabsContent>
          <TabsContent value="printing"><PrintingTab canEdit={!!isSupervisor} /></TabsContent>
        </Tabs>
      </div>
      <StatusBar />
    </>
  );
}

function OfficesTab({ canEdit }: { canEdit: boolean }) {
  const { offices, loadOffices } = useOfficeStore();
  const [editing, setEditing] = useState<Office | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void loadOffices();
  }, [loadOffices]);
  return (
    <Card>
      <CardHeader><CardTitle>Sub Offices under this Sub-Division / HO</CardTitle>{canEdit && <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add office</Button>}</CardHeader>
      <Table>
        <THead><TR className="hover:bg-transparent"><TH>Office</TH><TH>Pincode</TH><TH>Facility ID</TH><TH>Division / Sub-Div</TH><TH>Postmaster</TH><TH className="text-right">Min limit</TH><TH className="text-right">Max limit</TH><TH>Register start</TH><TH>Status</TH><TH></TH></TR></THead>
        <TBody>
          {offices.length === 0 && <TR><TD colSpan={10} className="py-8 text-center text-muted-foreground">No offices yet.</TD></TR>}
          {offices.map((o) => (
            <TR key={o.id}>
              <TD className="font-medium">{o.name} <span className="text-muted-foreground text-[11px]">{o.office_type}</span></TD><TD className="num">{o.pincode}</TD><TD className="num">{o.facility_id || "—"}</TD><TD>{o.division}{o.sub_division ? ` / ${o.sub_division}` : ""}</TD><TD>{o.postmaster_name || "—"}</TD>
              <TD className="text-right num">₹{Money.format(o.min_cash_limit)}</TD><TD className="text-right num">{o.max_cash_limit ? `₹${Money.format(o.max_cash_limit)}` : <span className="text-warning-foreground dark:text-warning">not set</span>}</TD>
              <TD className="num">{o.register_start_date ?? "—"} <span className="text-muted-foreground">OB ₹{Money.format(o.initial_opening)}</span></TD>
              <TD><Badge variant={o.active ? "success" : "muted"}>{o.active ? "active" : "inactive"}</Badge></TD>
              <TD className="text-right">{canEdit && <Button size="sm" variant="outline" onClick={() => { setEditing(o); setOpen(true); }}>Edit</Button>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <OfficeConfigDialog open={open} onOpenChange={setOpen} office={editing} />
    </Card>
  );
}

function UsersTab({ canEdit }: { canEdit: boolean }) {
  const toast = useUiStore((s) => s.toast);
  const offices = useOfficeStore((s) => s.offices);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: "", displayName: "", role: "operator" as Role, officeId: "", pin: "" });
  const load = () => api().listUsers().then(setUsers).catch((e) => toast("error", "Could not load users", errorMessage(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api().createUser({ username: form.username.trim(), displayName: form.displayName.trim() || form.username.trim(), role: form.role, officeId: form.officeId || null, pin: form.pin });
      toast("success", `User ${form.username} created`);
      setForm({ username: "", displayName: "", role: "operator", officeId: "", pin: "" });
      await load();
    } catch (err) {
      toast("error", "Could not create user", errorMessage(err));
    }
  };
  return (
    <div className="grid grid-cols-[1fr_340px] gap-4">
      <Card>
        <CardHeader><CardTitle>Users</CardTitle></CardHeader>
        <Table>
          <THead><TR className="hover:bg-transparent"><TH>Username</TH><TH>Name</TH><TH>Tier</TH><TH>Office</TH><TH>Last login</TH><TH>Status</TH><TH></TH></TR></THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="num font-medium">{u.username}</TD><TD>{u.display_name}</TD>
                <TD><Badge variant={u.role === "supervisor" ? "info" : "muted"}>{u.role === "supervisor" ? "Supervisor / SPM" : "Operator"}</Badge></TD>
                <TD>{offices.find((o) => o.id === u.office_id)?.name ?? "All offices"}</TD><TD className="text-muted-foreground">{formatTs(u.last_login_at)}</TD>
                <TD><Badge variant={u.active ? "success" : "muted"}>{u.active ? "active" : "disabled"}</Badge></TD>
                <TD className="text-right">{canEdit && <Button size="sm" variant="outline" onClick={() => api().setUserActive(u.id, !u.active).then(load).catch((e) => toast("error", "Failed", errorMessage(e)))}>{u.active ? "Disable" : "Enable"}</Button>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader><CardTitle>Add user</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={create} className="space-y-2.5">
              <div className="space-y-1"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={2} /></div>
              <div className="space-y-1"><Label>Display name</Label><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
              <div className="space-y-1"><Label>Access tier</Label><Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })} options={[{ value: "operator", label: "Operator — voucher entry, cash tally" }, { value: "supervisor", label: "Supervisor / SPM — approval, config, sign-off" }]} /></div>
              <div className="space-y-1"><Label>Office</Label><Select value={form.officeId || "*"} onValueChange={(v) => setForm({ ...form, officeId: v === "*" ? "" : v })} options={[{ value: "*", label: "All offices" }, ...offices.map((o) => ({ value: o.id, label: o.name }))]} /></div>
              <div className="space-y-1"><Label>Initial PIN (digits)</Label><Input type="password" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} required minLength={4} /></div>
              <Button type="submit" className="w-full"><UserPlus className="h-3.5 w-3.5" /> Create user</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function HolidaysTab() {
  const office = useOfficeStore((s) => s.currentOffice());
  const toast = useUiStore((s) => s.toast);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const load = () => office && api().listHolidays(office.id).then(setHolidays);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office?.id]);
  if (!office) return <p className="text-muted-foreground text-sm">Select an office first.</p>;
  return (
    <Card className="max-w-3xl">
      <CardHeader><CardTitle>Holidays for {office.name}</CardTitle><span className="text-[11px] text-muted-foreground">Sundays are always holidays. Holidays are excluded from working-day counts and limit checks.</span></CardHeader>
      <CardBody>
        <form className="flex items-end gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); void api().setHoliday(office.id, date, true, note).then(() => { toast("success", "Holiday marked"); setNote(""); return load(); }).catch((err) => toast("error", "Failed", errorMessage(err))); }}>
          <div className="space-y-1"><Label>Date</Label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2 text-[13px] num" /></div>
          <div className="space-y-1 flex-1"><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gazetted holiday" /></div>
          <Button type="submit">Mark holiday</Button>
        </form>
        <Table>
          <THead><TR className="hover:bg-transparent"><TH>Date</TH><TH>Scope</TH><TH>Note</TH><TH></TH></TR></THead>
          <TBody>
            {holidays.length === 0 && <TR><TD colSpan={4} className="py-6 text-center text-muted-foreground">No holidays marked.</TD></TR>}
            {holidays.map((h) => (
              <TR key={`${h.office_id}-${h.holiday_date}`}><TD className="num">{h.holiday_date}</TD><TD>{h.office_id === "*" ? "All offices" : "This office"}</TD><TD>{h.note}</TD><TD className="text-right"><Button size="sm" variant="ghost" onClick={() => api().setHoliday(h.office_id === "*" ? "*" : office.id, h.holiday_date, false).then(load)}>Unmark</Button></TD></TR>
            ))}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function BackupTab({ canEdit }: { canEdit: boolean }) {
  const toast = useUiStore((s) => s.toast);
  const { info, boot, logout } = useSessionStore();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [dir, setDir] = useState("");
  const [keep, setKeep] = useState("30");
  const load = async () => {
    setBackups(await api().listBackups());
    setDir((await api().getSetting("backup_dir")) ?? "");
    setKeep((await api().getSetting("backup_keep")) ?? "30");
  };
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  const backupNow = async () => {
    try {
      const b = await api().backupNow("manual");
      toast("success", "Backup created", b.path);
      await load();
      await boot();
    } catch (e) {
      toast("error", "Backup failed", errorMessage(e));
    }
  };
  const chooseDir = async () => {
    const d = await api().openDialog([], true);
    if (!d) return;
    await api().setSetting("backup_dir", d);
    setDir(d);
    toast("success", "Backup folder updated", d);
    await load();
    await boot();
  };
  const restore = async (path: string) => {
    if (!confirm(`Restore ${path}?\n\nThe current database will be replaced. A safety snapshot of the current data is written first. You will be signed out.`)) return;
    try {
      const safety = await api().restoreBackup(path);
      toast("success", "Database restored", `Safety copy: ${safety}`);
      await logout();
    } catch (e) {
      toast("error", "Restore failed", errorMessage(e));
    }
  };
  const restoreFromFile = async () => {
    const p = await api().openDialog([{ name: "SQLite database", extensions: ["db", "sqlite"] }]);
    if (p) await restore(p);
  };
  return (
    <div className="grid grid-cols-[360px_1fr] gap-4">
      <Card>
        <CardHeader><CardTitle>Snapshot policy</CardTitle></CardHeader>
        <CardBody className="space-y-3 text-[12.5px]">
          <p className="text-muted-foreground">A verified SQLite snapshot (<span className="font-mono">VACUUM INTO</span> + integrity check) is written every time the application closes and whenever you click <b>Back up now</b>. Point the folder at an external USB drive or a synced share to keep copies off the machine.</p>
          <div className="space-y-1"><Label>Backup folder</Label><div className="flex gap-1"><Input value={dir || info?.backup_dir || ""} readOnly className="num text-[12px]" /><Button variant="outline" size="icon" onClick={() => void chooseDir()} disabled={!canEdit || !isTauri()} aria-label="Choose folder"><FolderOpen className="h-4 w-4" /></Button></div></div>
          <div className="space-y-1"><Label>Snapshots to keep</Label><Input type="number" min={1} value={keep} onChange={(e) => setKeep(e.target.value)} onBlur={() => canEdit && api().setSetting("backup_keep", String(Math.max(1, Number(keep) || 30)))} className="num w-24" disabled={!canEdit} /></div>
          <div className="text-[11.5px] text-muted-foreground space-y-0.5">
            <div>Database: <span className="font-mono">{info?.db_path}</span></div>
            <div>Journal: <span className="font-mono">{info?.journal_mode.toUpperCase()}</span> · Last automatic backup: <span className="font-mono">{info?.last_auto_backup ?? "none yet"}</span></div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={() => void backupNow()}><HardDriveDownload className="h-3.5 w-3.5" /> Back up now</Button>
            {canEdit && <Button variant="outline" onClick={() => void restoreFromFile()} disabled={!isTauri()}><RotateCcw className="h-3.5 w-3.5" /> Restore from file…</Button>}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Snapshots in the backup folder</CardTitle><Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button></CardHeader>
        <Table>
          <THead><TR className="hover:bg-transparent"><TH>File</TH><TH>Created</TH><TH className="text-right">Size</TH><TH></TH></TR></THead>
          <TBody>
            {backups.length === 0 && <TR><TD colSpan={4} className="py-6 text-center text-muted-foreground">No snapshots yet.</TD></TR>}
            {backups.map((b) => (
              <TR key={b.path}><TD className="num">{b.file_name}</TD><TD className="text-muted-foreground">{formatTs(b.created_at)}</TD><TD className="text-right num">{(b.size_bytes / 1024).toFixed(0)} KB</TD><TD className="text-right">{canEdit && <Button size="sm" variant="outline" onClick={() => void restore(b.path)}>Restore</Button>}</TD></TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

function PrintingTab({ canEdit }: { canEdit: boolean }) {
  const toast = useUiStore((s) => s.toast);
  const [kind, setKind] = useState<PrintTarget["kind"]>("windows_spooler");
  const [printer, setPrinter] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("9100");
  const [path, setPath] = useState("");
  const [printers, setPrinters] = useState<string[]>([]);
  useEffect(() => {
    void api().listPrinters().then(setPrinters).catch(() => {});
    void api().getSetting(PRINTER_SETTING_KEY).then((raw) => {
      const t = parsePrintTarget(raw);
      if (!t) return;
      setKind(t.kind);
      if (t.kind === "windows_spooler") setPrinter(t.printer_name);
      if (t.kind === "network") { setHost(t.host); setPort(String(t.port)); }
      if (t.kind === "device" || t.kind === "file") setPath(t.path);
    });
  }, []);
  const target = (): PrintTarget => {
    switch (kind) {
      case "windows_spooler": return { kind, printer_name: printer };
      case "network": return { kind, host, port: Number(port) || 9100 };
      case "device": return { kind, path };
      case "file": return { kind, path };
    }
  };
  const save = async () => {
    try {
      await api().setSetting(PRINTER_SETTING_KEY, JSON.stringify(target()));
      toast("success", "Slip printer saved");
    } catch (e) {
      toast("error", "Could not save", errorMessage(e));
    }
  };
  const test = async () => {
    try {
      const bytes = new EscPos().align(1).bold(true).line("HandToHand X").bold(false).line("Printer test OK").line(new Date().toLocaleString("en-IN")).feed(3).cut().bytes();
      const n = await api().printRaw(target(), bytes);
      toast("success", `Sent ${n} bytes to the printer`);
    } catch (e) {
      toast("error", "Test print failed", errorMessage(e));
    }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Slip / dot-matrix printer (RAW spooling)</CardTitle></CardHeader>
      <CardBody className="space-y-3 text-[12.5px]">
        <p className="text-muted-foreground">Hand-over slips are sent as ESC/POS bytes and closing sheets as plain text, straight to the printer with no driver formatting. A4 reports use the native print dialog or vector PDF export instead.</p>
        <div className="space-y-1"><Label>Connection</Label><Select value={kind} onValueChange={(v) => setKind(v as PrintTarget["kind"])} options={[{ value: "windows_spooler", label: "Windows printer (spooler, RAW)" }, { value: "network", label: "Network printer (TCP 9100)" }, { value: "device", label: "Device / port path (LPT1, COM3, /dev/usb/lp0, \\\\server\\share)" }, { value: "file", label: "Spool to file (preview)" }]} disabled={!canEdit} /></div>
        {kind === "windows_spooler" && <div className="space-y-1"><Label>Printer name</Label><Input list="printers" value={printer} onChange={(e) => setPrinter(e.target.value)} placeholder="EPSON TM-T82 Receipt" disabled={!canEdit} /><datalist id="printers">{printers.map((p) => <option key={p} value={p} />)}</datalist>{printers.length > 0 && <p className="text-[11px] text-muted-foreground">{printers.length} printer(s) detected.</p>}</div>}
        {kind === "network" && <div className="grid grid-cols-[1fr_100px] gap-2"><div className="space-y-1"><Label>Host / IP</Label><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" className="num" disabled={!canEdit} /></div><div className="space-y-1"><Label>Port</Label><Input value={port} onChange={(e) => setPort(e.target.value)} className="num" disabled={!canEdit} /></div></div>}
        {(kind === "device" || kind === "file") && <div className="space-y-1"><Label>{kind === "device" ? "Device path" : "File path"}</Label><Input value={path} onChange={(e) => setPath(e.target.value)} placeholder={kind === "device" ? "LPT1" : "C:\\HandToHand\\PDFs\\slip.bin"} className="num" disabled={!canEdit} /></div>}
        <div className="flex gap-2"><Button onClick={() => void save()} disabled={!canEdit}>Save printer</Button><Button variant="outline" onClick={() => void test()}><Printer className="h-3.5 w-3.5" /> Test print</Button></div>
      </CardBody>
    </Card>
  );
}
