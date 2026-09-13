import { describe, expect, it } from "vitest";
import { compareTally, groupIndian, Money } from "@/lib/money";
import { computeLines, linesToValues } from "@/store/tally";

describe("Money (paise fixed point)", () => {
  it("parses exactly, rejecting >2 decimals", () => {
    expect(Money.parse("1234")).toBe(123400);
    expect(Money.parse("1234.5")).toBe(123450);
    expect(Money.parse("₹1,23,456.75")).toBe(12345675);
    expect(Money.parse("-12.50")).toBe(-1250);
    expect(Money.parse(".5")).toBe(50);
    expect(() => Money.parse("1.234")).toThrow();
    expect(() => Money.parse("abc")).toThrow();
    expect(Money.tryParse("")).toBe(0);
    expect(Money.tryParse("x")).toBeNull();
  });
  it("adds without floating point drift", () => {
    expect(Money.add(Money.parse("0.10"), Money.parse("0.20"))).toBe(Money.parse("0.30"));
    expect(Money.mul(50000, 37)).toBe(1850000);
  });
  it("formats with Indian grouping", () => {
    expect(groupIndian("1234567")).toBe("12,34,567");
    expect(Money.format(12345675)).toBe("1,23,456.75");
    expect(Money.format(100000, { register: true })).toBe("1,000");
    expect(Money.format(-1250)).toBe("-12.50");
    expect(Money.signed(1250)).toBe("+₹12.50");
    expect(Money.signed(-30000)).toBe("-₹300.00");
    expect(Money.plain(123450)).toBe("1234.50");
    expect(Money.toRupeeNumber(123450)).toBe(1234.5);
  });
});

describe("tally comparator", () => {
  it("produces the three badges", () => {
    expect(compareTally(681800, 681800)).toEqual({ variance: 0, status: "balanced", badge: "Balanced (₹0.00)" });
    expect(compareTally(680000, 681850)).toEqual({ variance: 1850, status: "surplus", badge: "Surplus (+₹18.50)" });
    expect(compareTally(700000, 681800)).toEqual({ variance: -18200, status: "deficit", badge: "Deficit (-₹182.00)" });
  });
  it("computes denomination totals like the Rust core", () => {
    const c = computeLines({ n500: 10, n200: 3, n100: 7, n20: 5, n10: 12, c5: 4, c2: 3, c1: 9, mixed: 1350, citem: 25000 });
    expect(c.total).toBe(681850);
    expect(c.citem).toBe(25000);
    expect(c.cashInHand).toBe(656850);
    expect(c.noteCount).toBe(37);
    expect(c.coinCount).toBe(16);
    expect(linesToValues(c.lines)).toMatchObject({ n500: 10, mixed: 1350, citem: 25000 });
  });
});
