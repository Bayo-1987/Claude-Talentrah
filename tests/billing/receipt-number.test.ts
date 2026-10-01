/**
 * send-503 / S18 — a receipt shows a short, readable number; the full Paystack reference stays in the data.
 *
 * Receipts read "Receipt credit_pack_678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f": an internal id, 47 characters, impossible to read
 * out over the phone. The number is DISPLAY ONLY: derived from the reference, never stored, and never used to look anything up
 * (the full reference is what support searches by, and what the page keeps under "Payment reference").
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  receiptNumber?: (productType: string, reference: string) => string;
}
const mod = () => loadModule<Mod>("@/lib/billing/receipt-number");
const fn = async () => {
  const m = await mod();
  expect(m.receiptNumber, "receiptNumber must be exported from src/lib/billing/receipt-number.ts").toBeTypeOf("function");
  return m.receiptNumber!;
};

const UUID = "678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f";

describe("receiptNumber", () => {
  it("a credit pack's internal reference becomes CP- plus the first eight characters, upper-cased", async () => {
    expect((await fn())("credit_pack", `credit_pack_${UUID}`)).toBe("CP-678586C1");
  });

  it("each product has its own prefix", async () => {
    const r = await fn();
    expect(r("pass", `pass_${UUID}`)).toBe("PS-678586C1");
    expect(r("ad_wallet_topup", `ad_wallet_topup_${UUID}`)).toBe("AW-678586C1");
    expect(r("mentor_session", `mentor_session_${UUID}`)).toBe("MS-678586C1");
  });

  it("a reference that is not uuid-shaped still yields a short number (its last eight letters or digits)", async () => {
    expect((await fn())("credit_pack", "TLR-E2E-CALLBACK-REDIRECT")).toBe("CP-REDIRECT");
    expect((await fn())("pass", "T123456789012")).toBe("PS-56789012");
  });

  it("an unknown product type gets a neutral RC prefix rather than a blank or a crash", async () => {
    expect((await fn())("something_new", `something_new_${UUID}`)).toBe("RC-678586C1");
  });

  it("is short enough to read aloud and never contains the internal id", async () => {
    const n = (await fn())("credit_pack", `credit_pack_${UUID}`);
    expect(n.length).toBeLessThanOrEqual(12);
    expect(n).not.toContain("credit_pack");
    expect(n).not.toContain("-9f2e");
  });
});
