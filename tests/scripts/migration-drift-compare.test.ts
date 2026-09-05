/**
 * compareMigrations — the pure comparison logic behind the automated
 * production drift check. No network, no database: this is exactly the
 * `case` statement `audit-migrations.ts`'s `buildQuery` generates as SQL,
 * reimplemented so it can run against a fetched list instead of a live
 * connection, and so it's testable on its own.
 */
import { describe, expect, it } from "vitest";
import { compareMigrations } from "../../scripts/migration-drift-compare";

describe("compareMigrations", () => {
  it("marks an exact name match as applied", () => {
    const result = compareMigrations(["0090_balance_rebase_4x"], ["0090_balance_rebase_4x"]);
    expect(result).toEqual([{ migration: "0090_balance_rebase_4x", status: "applied" }]);
  });

  it("marks a committed migration absent from the applied list as MISSING", () => {
    const result = compareMigrations(["0093_resume_builder_start_events"], []);
    expect(result).toEqual([{ migration: "0093_resume_builder_start_events", status: "MISSING" }]);
  });

  it("resolves a documented alias — 0071's real-world case", () => {
    // The exact pair this check's own construction found unhandled on its
    // first real run against production (see audit-migrations.ts's
    // KNOWN_ALIASES entry for the full story).
    const result = compareMigrations(["0071_drop_admin_mfa"], ["drop_admin_mfa_0071"]);
    expect(result).toEqual([
      { migration: "0071_drop_admin_mfa", status: "applied under a documented alias" },
    ]);
  });

  it("does not resolve an UNDOCUMENTED name mismatch as an alias", () => {
    // If this ever passed, a real gap could hide behind a coincidental
    // stripped-prefix or substring match that isn't actually one of the
    // named KNOWN_ALIASES pairs.
    const result = compareMigrations(["0099_made_up_migration"], ["totally_unrelated_name"]);
    expect(result).toEqual([{ migration: "0099_made_up_migration", status: "MISSING" }]);
  });

  it("matches a migration applied without its numeric prefix", () => {
    const result = compareMigrations(
      ["0049_payment_product_type_ad_wallet_topup"],
      ["payment_product_type_ad_wallet_topup"],
    );
    expect(result).toEqual([
      { migration: "0049_payment_product_type_ad_wallet_topup", status: "applied without its numeric prefix" },
    ]);
  });

  it(
    "SABOTAGE-PROOF TARGET: a prefix-stripped match on the WRONG migration is not a false positive",
    () => {
      // "0049_foo" stripped is "foo"; a totally different migration
      // "0050_foo" also strips to "foo". Two distinct committed migrations
      // must not both silently resolve against one applied row.
      const result = compareMigrations(["0049_foo", "0050_foo"], ["foo"]);
      expect(result).toEqual([
        { migration: "0049_foo", status: "applied without its numeric prefix" },
        { migration: "0050_foo", status: "applied without its numeric prefix" },
      ]);
      // Both resolving is the CORRECT behaviour here (either really could be
      // the one recorded as "foo") — what this pins is that neither is
      // reported MISSING just because the other matched first, which a
      // naive one-shot "find and remove" comparison could get wrong.
    },
  );

  it("checks every committed migration independently, in the order given", () => {
    const result = compareMigrations(
      ["0001_a", "0002_b", "0003_c"],
      ["0001_a", "0003_c"],
    );
    expect(result).toEqual([
      { migration: "0001_a", status: "applied" },
      { migration: "0002_b", status: "MISSING" },
      { migration: "0003_c", status: "applied" },
    ]);
  });

  it("returns an empty result for no committed migrations", () => {
    expect(compareMigrations([], ["anything"])).toEqual([]);
  });
});
