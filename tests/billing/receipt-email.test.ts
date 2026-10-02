/**
 * send-503 / S18 — the purchase confirmation email carries the short receipt number AND the full payment reference.
 *
 * The email used to quote the internal reference as "Receipt number". Now: "Receipt number: CP-678586C1" for a person to quote,
 * and "Payment reference: credit_pack_…" below it for support. Changed deliberately: the earlier assertions pinned the long id.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Built {
  subject: string;
  text: string;
  html: string;
}
interface Mod {
  buildPurchaseReceiptEmail?: (a: {
    greeting: string;
    productName: string;
    productType: string;
    amountNgn: number;
    reference: string;
  }) => Built;
}
const UUID = "678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f";
const REF = `credit_pack_${UUID}`;
const build = async () => {
  const m = await loadModule<Mod>("@/lib/billing/receipt-email");
  expect(m.buildPurchaseReceiptEmail, "buildPurchaseReceiptEmail must be exported from src/lib/billing/receipt-email.ts").toBeTypeOf("function");
  return m.buildPurchaseReceiptEmail!({ greeting: "Ada", productName: "Starter", productType: "credit_pack", amountNgn: 2500, reference: REF });
};

describe("the purchase confirmation email", () => {
  it("text: a short receipt number, then the full payment reference", async () => {
    const { text } = await build();
    expect(text).toContain("Receipt number: CP-678586C1");
    expect(text).toContain(`Payment reference: ${REF}`);
  });

  it("html: both rows are present, and the receipt number row no longer holds the internal id", async () => {
    const { html } = await build();
    expect(html).toContain("CP-678586C1");
    expect(html).toContain(REF);
    const receiptRow = html.match(/Receipt number<\/td>\s*<td[^>]*>([^<]*)</);
    expect(receiptRow?.[1]).toBe("CP-678586C1");
  });

  it("the amount reads as one string with its currency sign", async () => {
    const { text } = await build();
    expect(text).toContain("Amount: ₦2,500");
  });

  it("tells the reader which number to quote, and keeps the greeting", async () => {
    const { text } = await build();
    expect(text).toMatch(/Quote the receipt number/);
    expect(text).toContain("Hi Ada");
  });
});
