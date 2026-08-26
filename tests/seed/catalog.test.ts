/**
 * The paid catalogs must be reproducible on an empty database.
 *
 * WHY THIS FILE EXISTS. Standing up a second Supabase project on 2026-08-26
 * found `credit_packs` and `passes` EMPTY and nothing able to fill them. They
 * existed in production only because one of the uncommitted 0001–0025
 * migrations inserted them once, years of sessions ago. `scripts/seed.ts`
 * owned every other catalog — resume templates, scholarships, demo jobs — and
 * simply did not know about these two.
 *
 * It cost a red CI run to notice, and only because the suite was finally
 * pointed at a database that had never been production. The class of bug is
 * "works because the data has been there for weeks", which no amount of
 * testing against that same database can surface.
 *
 * These tests deliberately do NOT run the seed — it needs a dev server for
 * scholarship and job ingestion, which a unit suite has no business starting.
 * They assert the two properties that made the seed unable to do its job:
 * the natural keys exist and bite, and the catalog constants are internally
 * coherent.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";

describe("catalog natural keys (0051)", () => {
  it("credit_packs rejects a duplicate name", async () => {
    const name = `SEEDTEST Pack ${randomUUID().slice(0, 8)}`;
    const first = await admin.from("credit_packs").insert({ name, credits: 1, price_ngn: 1 });
    expect(first.error, "the first insert should succeed").toBeNull();
    try {
      const dup = await admin.from("credit_packs").insert({ name, credits: 2, price_ngn: 2 });
      // 23505 is the unique violation. Without it, a re-seed after a copy edit
      // duplicates the product rather than updating it — the exact failure
      // 0042's slug constraint was added to prevent for resume_templates.
      expect(dup.error?.code, "a duplicate pack name was accepted").toBe("23505");
    } finally {
      const { error } = await admin.from("credit_packs").delete().eq("name", name);
      if (error) console.warn(`[cleanup] credit_packs ${name}: ${error.message}`);
    }
  });

  it("passes rejects a duplicate name", async () => {
    const name = `SEEDTEST Pass ${randomUUID().slice(0, 8)}`;
    const first = await admin.from("passes").insert({ name, duration_days: 1, price_ngn: 1 });
    expect(first.error, "the first insert should succeed").toBeNull();
    try {
      const dup = await admin.from("passes").insert({ name, duration_days: 2, price_ngn: 2 });
      expect(dup.error?.code, "a duplicate pass name was accepted").toBe("23505");
    } finally {
      const { error } = await admin.from("passes").delete().eq("name", name);
      if (error) console.warn(`[cleanup] passes ${name}: ${error.message}`);
    }
  });

  it("upsert-on-name updates in place rather than duplicating", async () => {
    // This is the operation the seed performs on every re-run. If it ever
    // duplicates instead of updating, checkout starts showing two of the same
    // product.
    const name = `SEEDTEST Upsert ${randomUUID().slice(0, 8)}`;
    try {
      await admin.from("credit_packs").upsert({ name, credits: 10, price_ngn: 1000 }, { onConflict: "name" });
      await admin.from("credit_packs").upsert({ name, credits: 20, price_ngn: 2000 }, { onConflict: "name" });
      const { data } = await admin.from("credit_packs").select("credits, price_ngn").eq("name", name);
      expect(data, "a re-seed duplicated the pack instead of updating it").toHaveLength(1);
      expect(data?.[0]?.credits).toBe(20);
      expect(data?.[0]?.price_ngn).toBe(2000);
    } finally {
      const { error } = await admin.from("credit_packs").delete().eq("name", name);
      if (error) console.warn(`[cleanup] credit_packs ${name}: ${error.message}`);
    }
  });
});

describe("the catalog the seed ships", () => {
  it("every pack and pass the seed defines is present and priced", async () => {
    /*
     * Reads the live catalog rather than the constants, so this fails on a
     * database the seed has never touched — which is precisely the state that
     * went unnoticed until a second project existed.
     */
    const { data: packs } = await admin.from("credit_packs").select("name, credits, price_ngn");
    const { data: passes } = await admin.from("passes").select("name, duration_days, price_ngn");

    for (const expected of ["Starter", "Popular", "Power"]) {
      expect(
        (packs ?? []).some((p) => p.name === expected),
        `credit pack "${expected}" is missing — run \`npm run seed\``,
      ).toBe(true);
    }
    for (const expected of ["7-Day Sprint Pass", "30-Day Pass"]) {
      expect(
        (passes ?? []).some((p) => p.name === expected),
        `pass "${expected}" is missing — run \`npm run seed\``,
      ).toBe(true);
    }

    // Anchors from build-prompt §6.9. Pinned so a price change is a deliberate
    // edit to two places, not a silent drift in one.
    expect((packs ?? []).find((p) => p.name === "Starter")?.price_ngn).toBe(2500);
    expect((passes ?? []).find((p) => p.name === "30-Day Pass")?.price_ngn).toBe(6500);
  });
});
