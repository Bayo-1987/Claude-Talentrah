/**
 * send-434 added two lower presets (₦2,500, ₦5,000) ahead of the existing
 * three. Nothing previously would have failed if a future edit silently
 * dropped or reordered one of the five — this pins the actual rendered
 * list, in order, the way tests/employer/masthead-badge.test.tsx pins the
 * badge markup: a real renderToStaticMarkup pass, string assertions
 * against the output, not an inspection of the source array.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletTopUp } from "@/components/employer/wallet-topup";
import type { EmployerActionState } from "@/lib/employer/actions";

async function noopAction(): Promise<EmployerActionState> {
  return null;
}

describe("the top-up preset buttons", () => {
  const html = renderToStaticMarkup(
    <WalletTopUp action={noopAction} balanceNgn={0} dailyCommitmentNgn={0} />,
  );

  it("renders all five presets, not just the original three", () => {
    for (const amount of ["₦2,500", "₦5,000", "₦10,000", "₦25,000", "₦50,000"]) {
      expect(html, `missing preset ${amount}`).toContain(amount);
    }
  });

  it("renders them in ascending order, low to high", () => {
    const positions = ["₦2,500", "₦5,000", "₦10,000", "₦25,000", "₦50,000"].map((amount) =>
      html.indexOf(amount),
    );
    for (const p of positions) expect(p, "a preset amount is missing entirely").toBeGreaterThanOrEqual(0);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions, "presets are not in ascending left-to-right order").toEqual(sorted);
  });
});
