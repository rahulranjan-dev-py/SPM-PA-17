import { describe, expect, it } from "vitest";
import { classifyBarcode, s10CheckDigit } from "@/lib/barcode";
import { WedgeDetector } from "@/lib/wedge";

describe("S10 barcodes", () => {
  it("validates the UPU example and suggests voucher types", () => {
    expect(s10CheckDigit("12345678")).toBe(5);
    expect(classifyBarcode("RB123456785SG").kind).toBe("s10");
    expect(classifyBarcode("EM123456789IN").kind).toBe("s10_bad_check_digit");
    expect(classifyBarcode("em 123456785 in")).toMatchObject({ normalized: "EM123456785IN", kind: "s10", suggested_voucher_type: "SPEED_POST" });
    expect(classifyBarcode("CP123456785IN").suggested_voucher_type).toBe("PARCEL");
    expect(classifyBarcode("1234567890123").kind).toBe("domestic13");
    expect(classifyBarcode("SAP-4900012345").kind).toBe("generic");
  });
});

describe("barcode wedge detector", () => {
  it("detects a fast burst terminated by Enter", () => {
    const d = new WedgeDetector();
    let t = 1000;
    let out = null;
    for (const ch of "EM123456785IN") {
      out = d.feed(ch, t);
      t += 12;
    }
    expect(out).toBeNull();
    expect(d.feed("Enter", t + 5)).toEqual({ code: "EM123456785IN", durationMs: 13 * 12 + 5 });
  });
  it("ignores human-speed typing", () => {
    const d = new WedgeDetector();
    let t = 0;
    for (const ch of "EM123456785IN") {
      d.feed(ch, t);
      t += 120;
    }
    expect(d.feed("Enter", t)).toBeNull();
  });
  it("ignores short bursts and resets on navigation keys", () => {
    const d = new WedgeDetector();
    for (const [i, ch] of [..."ABC"].entries()) d.feed(ch, i * 10);
    expect(d.feed("Enter", 40)).toBeNull();
    for (const [i, ch] of [..."ABCDEFGH"].entries()) d.feed(ch, 100 + i * 10);
    d.feed("ArrowLeft", 190);
    expect(d.pending).toBe("");
  });
});
