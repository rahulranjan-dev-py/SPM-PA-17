import type { BarcodeInfo } from "./types";

const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7];

/** UPU S10 check digit for the 8 serial digits. */
export function s10CheckDigit(serial: string): number | null {
  if (!/^\d{8}$/.test(serial)) return null;
  const sum = serial.split("").reduce((acc, ch, i) => acc + Number(ch) * S10_WEIGHTS[i]!, 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  else if (check === 11) check = 5;
  return check;
}

/** Mirrors htoh_core::barcode::classify so the UI can react before the IPC round-trip. */
export function classifyBarcode(raw: string): BarcodeInfo {
  const normalized = raw.replace(/\s+/g, "").toUpperCase();
  const looksS10 = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(normalized);
  let kind: BarcodeInfo["kind"] = "generic";
  if (looksS10) {
    kind = s10CheckDigit(normalized.slice(2, 10)) === Number(normalized[10]) ? "s10" : "s10_bad_check_digit";
  } else if (/^\d{13}$/.test(normalized)) {
    kind = "domestic13";
  }
  let suggested: string | null = null;
  if (looksS10) {
    const first = normalized[0]!;
    if (first === "E") suggested = "SPEED_POST";
    else if ("RLV".includes(first)) suggested = "REGISTERED";
    else if (first === "C") suggested = "PARCEL";
  } else if (kind === "domestic13") {
    suggested = "REGISTERED";
  }
  return { raw, normalized, kind, suggested_voucher_type: suggested };
}
