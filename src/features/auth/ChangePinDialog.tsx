import { useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/ipc";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { errorMessage } from "@/lib/utils";

export function ChangePinDialog({ open, onOpenChange, userId, forced }: { open: boolean; onOpenChange: (o: boolean) => void; userId: string; forced?: boolean }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const toast = useUiStore((s) => s.toast);
  const clear = useSessionStore((s) => s.clearMustChangePin);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return toast("error", "PIN must be at least 4 digits");
    if (pin !== confirm) return toast("error", "PINs do not match");
    try {
      await api().setPin(userId, pin);
      clear();
      toast("success", "PIN updated");
      onOpenChange(false);
      setPin("");
      setConfirm("");
    } catch (err) {
      toast("error", "Could not change PIN", errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !forced && onOpenChange(o)}>
      <DialogContent title="Change PIN" description={forced ? "The default supervisor PIN must be changed before use." : "Choose a new numeric PIN (minimum 4 digits)."} onEscapeKeyDown={(e) => forced && e.preventDefault()} onPointerDownOutside={(e) => forced && e.preventDefault()}>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1"><Label>New PIN</Label><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus /></div>
          <div className="space-y-1"><Label>Confirm PIN</Label><Input type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} /></div>
          <DialogFooter>{!forced && <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>}<Button type="submit">Save PIN</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
