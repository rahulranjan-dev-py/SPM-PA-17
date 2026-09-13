import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, MoneyInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { emptyOffice, useOfficeStore } from "@/store/office";
import { useUiStore } from "@/store/ui";
import type { Office } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

export function OfficeConfigDialog({ open, onOpenChange, office }: { open: boolean; onOpenChange: (o: boolean) => void; office: Office | null }) {
  const saveOffice = useOfficeStore((s) => s.saveOffice);
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState<Office>(emptyOffice());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm(office ? { ...office } : emptyOffice());
  }, [open, office]);
  const set = <K extends keyof Office>(k: K, v: Office[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await saveOffice(form);
      toast("success", `${saved.name} saved`);
      onOpenChange(false);
    } catch (err) {
      toast("error", "Could not save office", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={office ? `Edit ${office.name}` : "Add Sub Office"} description="Office profile, CSI identity, authorised cash limits and register initialisation." className="w-[min(760px,94vw)]">
        <form onSubmit={submit} className="grid grid-cols-6 gap-3">
          <F label="Office name" span={4}><Input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus /></F>
          <F label="Type" span={2}><Select value={form.office_type} onValueChange={(v) => set("office_type", v)} options={[{ value: "SO", label: "Sub Office (SO)" }, { value: "BO", label: "Branch Office (BO)" }, { value: "HO", label: "Head Office (HO)" }]} /></F>
          <F label="Pincode" span={2}><Input value={form.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} required pattern="\d{6}" className="num" /></F>
          <F label="CSI facility ID" span={4}><Input value={form.facility_id} onChange={(e) => set("facility_id", e.target.value.toUpperCase())} placeholder="PO37000112345" className="num" /></F>
          <F label="Division" span={2}><Input value={form.division} onChange={(e) => set("division", e.target.value)} /></F>
          <F label="Sub-Division" span={2}><Input value={form.sub_division} onChange={(e) => set("sub_division", e.target.value)} /></F>
          <F label="Head Office" span={2}><Input value={form.head_office} onChange={(e) => set("head_office", e.target.value)} /></F>
          <F label="Postmaster name" span={3}><Input value={form.postmaster_name} onChange={(e) => set("postmaster_name", e.target.value)} /></F>
          <F label="Designation" span={1}><Input value={form.postmaster_designation} onChange={(e) => set("postmaster_designation", e.target.value)} /></F>
          <F label="Phone" span={2}><Input value={form.postmaster_phone} onChange={(e) => set("postmaster_phone", e.target.value)} className="num" /></F>
          <F label="Minimum cash reserve (₹)" span={3}><MoneyInput valuePaise={form.min_cash_limit} onChangePaise={(p) => set("min_cash_limit", p)} /></F>
          <F label="Maximum authorised cash (₹)" span={3}><MoneyInput valuePaise={form.max_cash_limit} onChangePaise={(p) => set("max_cash_limit", p)} /></F>
          <F label="Register start date" span={3}><input type="date" value={form.register_start_date ?? ""} onChange={(e) => set("register_start_date", e.target.value || null)} className="h-8 w-full rounded-md border border-input bg-card px-2 text-[13px] num" /></F>
          <F label="Opening balance on start date (₹)" span={3}><MoneyInput valuePaise={form.initial_opening} onChangePaise={(p) => set("initial_opening", p)} /></F>
          <div className="col-span-6 flex items-center gap-2 pt-1"><Switch checked={form.active} onCheckedChange={(v) => set("active", v)} id="active" /><label htmlFor="active" className="text-[13px]">Active (included in the SMR batch)</label></div>
          <DialogFooter className="col-span-6"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}>Save office</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return <div className={`space-y-1 col-span-${span}`}><Label>{label}</Label>{children}</div>;
}
