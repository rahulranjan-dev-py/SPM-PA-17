import { useEffect, useRef, useState } from "react";
import { KeyRound, Landmark, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { errorMessage } from "@/lib/utils";
import { isTauri } from "@/lib/ipc";

export function LoginScreen() {
  const login = useSessionStore((s) => s.login);
  const info = useSessionStore((s) => s.info);
  const { theme, toggleTheme } = useUiStore();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  useEffect(() => userRef.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), pin);
    } catch (err) {
      setError(errorMessage(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full grid place-items-center bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklch,var(--primary)_12%,transparent),transparent_60%)]">
      <div className="w-[380px] rounded-xl border border-border bg-card shadow-xl">
        <div className="px-6 pt-6 pb-4 border-b border-border flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground grid place-items-center"><Landmark className="h-5 w-5" /></div>
            <div>
              <h1 className="text-[17px] font-semibold leading-tight">HandToHand X</h1>
              <p className="text-xs text-muted-foreground">Sub Office cash register · SMR (PA-17)</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="username">Username</Label>
            <Input id="username" ref={userRef} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="spm" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pin">PIN</Label>
            <Input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" required minLength={4} className="num tracking-[0.3em]" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={busy}><KeyRound className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}</Button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            First run: sign in as <span className="font-mono">spm</span> with PIN <span className="font-mono">1234</span>, then change the PIN. {!isTauri() && "Browser preview uses an in-memory mock database (pa1 / 1111 is an operator)."}
          </p>
        </form>
        {info && <div className="px-6 py-2 border-t border-border text-[10.5px] text-muted-foreground flex justify-between"><span>v{info.version} · {info.platform}</span><span className="truncate max-w-[220px]" title={info.db_path}>{info.journal_mode.toUpperCase()} · {info.db_path}</span></div>}
      </div>
    </div>
  );
}
