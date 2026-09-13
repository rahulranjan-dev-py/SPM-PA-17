import { api } from "@/lib/ipc";
import type { PrintTarget } from "@/lib/types";

export const PRINTER_SETTING_KEY = "slip_printer";

export function parsePrintTarget(raw: string | null): PrintTarget | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as PrintTarget;
    return t && typeof t === "object" && "kind" in t ? t : null;
  } catch {
    return null;
  }
}

/** Spool raw bytes to the configured slip / dot-matrix printer. */
export async function printSlip(bytes: Uint8Array): Promise<number> {
  const target = parsePrintTarget(await api().getSetting(PRINTER_SETTING_KEY));
  if (!target) throw new Error("No slip printer configured — set one under Offices & Settings → Printing");
  return api().printRaw(target, bytes);
}
