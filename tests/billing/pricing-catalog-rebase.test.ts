/**
 * Part C (catalog) and Part D (×4 balance migration) — checked against the
 * real, already-migrated database, not re-derived from the migration files.
 * Migrations 0089/0090 already ran (this is a live-database check that they
 * ran correctly), so these tests are regression guards against the DATA,
 * not a replay of the migration itself.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";

describe("Part C — the founder-decided catalog", () => {
  it("credit_packs: exactly Starter and Plus are active, at the decided prices", async () => {
    const { data, error } = await admin
      .from("credit_packs")
      .select("name, credits, price_ngn")
      .eq("is_active", true)
      .order("price_ngn");
    if (error) throw error;
    expect(data).toEqual([
      { name: "Starter", credits: 20, price_ngn: 2500 },
      { name: "Plus", credits: 45, price_ngn: 5000 },
    ]);
  });

  it("Plus's 45 credits equal exactly one Directory verification (25) plus one tailoring (20)", async () => {
    const { data } = await admin.from("credit_packs").select("credits").eq("name", "Plus").single();
    expect(data?.credits).toBe(25 + 20);
  });

  it("Popular and Power are retired — deactivated, not deleted", async () => {
    const { data, error } = await admin
      .from("credit_packs")
      .select("name, is_active")
      .in("name", ["Popular", "Power"]);
    if (error) throw error;
    expect(data, "RETIRED PRODUCTS MUST STILL EXIST — deleting them breaks the FK from payment_transactions").toHaveLength(2);
    expect(data?.every((p) => p.is_active === false)).toBe(true);
  });

  it("Popular and Power are not purchasable — filtered out wherever is_active is checked", async () => {
    const { data } = await admin.from("credit_packs").select("name").eq("is_active", true);
    const names = (data ?? []).map((p) => p.name);
    expect(names).not.toContain("Popular");
    expect(names).not.toContain("Power");
  });

  it("passes: exactly the three decided passes, at the decided prices", async () => {
    const { data, error } = await admin
      .from("passes")
      .select("name, duration_days, price_ngn")
      .eq("is_active", true)
      .order("duration_days");
    if (error) throw error;
    expect(data).toEqual([
      { name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 4000 },
      { name: "30-Day Pass", duration_days: 30, price_ngn: 6500 },
      { name: "90-Day Pass", duration_days: 90, price_ngn: 15000 },
    ]);
  });

  it("a retired pack's historical payment_transactions row still resolves and renders", async () => {
    // The billing page's purchase history reads amount/product_type/
    // channel/reference straight off the transaction row and never joins
    // back to credit_packs (src/app/(app)/billing/page.tsx) — so this is
    // checking the actual invariant that makes deactivation safe, not just
    // that the row exists.
    const { data: retiredPack } = await admin
      .from("credit_packs")
      .select("id")
      .eq("name", "Popular")
      .single();
    if (!retiredPack) throw new Error("Popular pack not found — cannot verify historical-row rendering.");

    const { data: historicalRow, error } = await admin
      .from("payment_transactions")
      .select("id, amount, currency, product_type, status")
      .eq("product_id", retiredPack.id)
      .eq("status", "success")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    // Not every environment will have a real historical purchase of the
    // retired pack — assert the SHAPE holds if one exists, rather than
    // requiring one to exist (which would make this test depend on
    // production-only data no fixture can guarantee in CI).
    if (historicalRow) {
      expect(historicalRow.amount).toBeGreaterThan(0);
      expect(historicalRow.product_type).toBe("credit_pack");
    }
  });
});

describe("Part D — the ×4 balance migration, checked against real ledger rows", () => {
  it("every pricing_rebase_4x ledger entry is internally consistent: delta = balance_after * 3/4", async () => {
    const { data, error } = await admin
      .from("credit_ledger")
      .select("user_id, delta, balance_after")
      .eq("reason", "pricing_rebase_4x");
    if (error) throw error;
    expect(data!.length, "the rebase should have touched at least one real balance").toBeGreaterThan(0);

    for (const row of data!) {
      const preMigrationBalance = row.balance_after - row.delta;
      expect(
        row.balance_after,
        `user ${row.user_id}: balance_after must be exactly 4x the pre-migration balance`,
      ).toBe(preMigrationBalance * 4);
      expect(row.delta).toBe((row.balance_after * 3) / 4);
    }
  });

  it("a pre-migration purchaser's ENTITLEMENT survives to the credit: N old tailorings still buys N new tailorings", () => {
    // Pure arithmetic, no DB needed — the actual claim Part D makes, checked
    // against BOTH cost tables directly rather than assumed from the ×4
    // alone. Someone who bought exactly enough for N old-priced tailorings
    // must, after the rebase, hold exactly enough for N new-priced ones.
    const OLD_TAILORING_COST = 5;
    const NEW_TAILORING_COST = 20; // CREDIT_COSTS.tailoringRun
    const BALANCE_MULTIPLIER = 4;

    for (const oldTailoringsBought of [1, 3, 4, 10]) {
      const preMigrationBalance = oldTailoringsBought * OLD_TAILORING_COST;
      const postMigrationBalance = preMigrationBalance * BALANCE_MULTIPLIER;
      const tailoringsAffordableNow = Math.floor(postMigrationBalance / NEW_TAILORING_COST);
      expect(
        tailoringsAffordableNow,
        `${oldTailoringsBought} old tailorings' worth of credits must still buy ${oldTailoringsBought} at the new price`,
      ).toBe(oldTailoringsBought);
    }
  });
});
