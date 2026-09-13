/**
 * Fixed-point money for the UI. Values are integer **paise** exactly as the Rust
 * core serialises them (1 rupee = 100 paise). No floating point is ever used
 * for arithmetic; `decimal.js` is used only to parse user input exactly.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type Paise = number; // always an integer

export class MoneyParseError extends Error {}

export const Money = {
  ZERO: 0 as Paise,

  fromRupees(rupees: number | string): Paise {
    return Money.parse(String(rupees));
  },

  /** Parse "1,23,456.75", "₹500", "-12.5"; rejects >2 decimals. */
  parse(input: string): Paise {
    const cleaned = input.replace(/[\s,₹_]/g, "").replace(/^Rs\.?/i, "");
    if (!cleaned) throw new MoneyParseError("amount is required");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) throw new MoneyParseError(`invalid amount "${input}"`);
    const dec = new Decimal(cleaned);
    if (dec.decimalPlaces() > 2) throw new MoneyParseError("amount cannot have more than two decimal places");
    const paise = dec.times(100);
    if (!paise.isInteger() || paise.abs().greaterThan(Number.MAX_SAFE_INTEGER)) throw new MoneyParseError("amount out of range");
    return paise.toNumber();
  },

  /** Lenient parse for live typing: empty/partial -> 0, invalid -> null */
  tryParse(input: string): Paise | null {
    const t = input.trim();
    if (t === "" || t === "-" || t === ".") return 0;
    try {
      return Money.parse(t);
    } catch {
      return null;
    }
  },

  add(...parts: Paise[]): Paise {
    return parts.reduce((a, b) => a + b, 0);
  },

  sub(a: Paise, b: Paise): Paise {
    return a - b;
  },

  mul(a: Paise, qty: number): Paise {
    if (!Number.isInteger(qty)) throw new MoneyParseError("quantity must be an integer");
    return a * qty;
  },

  /** "1,23,456.75" (Indian grouping) */
  format(paise: Paise, opts: { register?: boolean; symbol?: boolean } = {}): string {
    const sign = paise < 0 ? "-" : "";
    const abs = Math.abs(paise);
    const whole = Math.floor(abs / 100);
    const frac = abs % 100;
    const grouped = groupIndian(String(whole));
    const symbol = opts.symbol ? "₹" : "";
    if (opts.register && frac === 0) return `${sign}${symbol}${grouped}`;
    return `${sign}${symbol}${grouped}.${String(frac).padStart(2, "0")}`;
  },

  /** Plain "1234.50" (for inputs, CSV, XLSX numeric cells as strings) */
  plain(paise: Paise): string {
    const sign = paise < 0 ? "-" : "";
    const abs = Math.abs(paise);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  },

  /** Signed with symbol: "+₹12.50" / "-₹300.00" / "₹0.00" */
  signed(paise: Paise): string {
    if (paise === 0) return "₹0.00";
    return `${paise > 0 ? "+" : "-"}₹${Money.format(Math.abs(paise))}`;
  },

  /** Exact rupee number for spreadsheet cells (2 decimals, safe because the value is derived from an integer) */
  toRupeeNumber(paise: Paise): number {
    return Number(Money.plain(paise));
  },
};

export function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const groups: string[] = [];
  for (let i = head.length; i > 0; i -= 2) groups.unshift(head.slice(Math.max(0, i - 2), i));
  return `${groups.join(",")},${tail}`;
}

export type TallyStatus = "balanced" | "surplus" | "deficit";

export interface TallyView {
  variance: Paise;
  status: TallyStatus;
  badge: string;
}

/** Mirrors htoh_core::tally::compare */
export function compareTally(systemBook: Paise, physical: Paise): TallyView {
  const variance = physical - systemBook;
  if (variance === 0) return { variance, status: "balanced", badge: "Balanced (₹0.00)" };
  if (variance > 0) return { variance, status: "surplus", badge: `Surplus (+₹${Money.format(variance)})` };
  return { variance, status: "deficit", badge: `Deficit (-₹${Money.format(-variance)})` };
}
