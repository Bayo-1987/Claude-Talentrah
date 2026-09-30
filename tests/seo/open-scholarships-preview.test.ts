/**
 * send-480 — loadOpenScholarshipsPreview: the four real rows on the signed-out
 * /scholarships landing page ("Open this cycle").
 *
 * Runs against the REAL database with a REAL anon client, like
 * tests/seo/landing-page-data.test.ts, for the same reason: a mock proves the
 * function calls the client, never that RLS and the still-open filter really
 * decide what a signed-out visitor sees.
 *
 * SHARED-DATABASE HYGIENE. Other files in this run insert and delete scholarship
 * fixtures at the same time, so this file never assumes it is the only writer:
 * it asks for a large `limit`, filters the result down to ITS OWN tagged fixtures
 * and asserts on those, and on relative order among them. It never touches a row
 * it did not create.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { loadOpenScholarshipsPreview } from "@/lib/seo/landing-page-data";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`open-scholarships-preview test cannot run: ${key} is not set.`);
}

type DB = SupabaseClient<Database>;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: DB = createClient<Database>(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: DB = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RUN = randomUUID().slice(0, 8);
const created: string[] = [];

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function fixture(
  label: string,
  over: { moderation_status: "verified" | "pending"; application_deadline: string | null; deadline_note?: string | null },
) {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `PREVIEW-TEST Provider ${label} ${RUN}`,
      program_name: `PREVIEW-TEST ${label} ${RUN}`,
      host_institution: "PREVIEW-TEST University",
      degree_levels: ["msc"],
      field_tags: [],
      funding_type: "full",
      funding_covers: ["tuition"],
      eligibility_nationalities: ["Nigeria"],
      official_url: "https://example.test/preview-fixture",
      dedup_fingerprint: `preview-test-${label}-${RUN}`,
      // Internal review trail — must never come back through a public loader.
      moderation_note: `INTERNAL-ONLY ${label} ${RUN}`,
      ...over,
    })
    .select("id, program_name")
    .single();
  if (error || !data) throw new Error(`could not create fixture ${label}: ${error?.message}`);
  created.push(data.id);
  return data;
}

afterAll(async () => {
  if (created.length === 0) return;
  const { error } = await admin.from("scholarships").delete().in("id", created);
  if (error) throw new Error(`preview fixtures were not cleaned up: ${error.message}`);
});

const mine = (rows: Array<{ program_name: string }>) => rows.filter((r) => r.program_name.endsWith(RUN));

describe("loadOpenScholarshipsPreview", () => {
  it("includes verified open listings, dated and undated, and excludes pending and already-closed ones", async () => {
    const soon = await fixture("soon", { moderation_status: "verified", application_deadline: isoDate(5) });
    const undated = await fixture("undated", { moderation_status: "verified", application_deadline: null, deadline_note: "Varies by partner" });
    const pending = await fixture("pending", { moderation_status: "pending", application_deadline: isoDate(6) });
    const closed = await fixture("closed", { moderation_status: "verified", application_deadline: isoDate(-2) });

    const names = mine(await loadOpenScholarshipsPreview(anon, 500)).map((r) => r.program_name);
    expect(names).toContain(soon.program_name);
    expect(names).toContain(undated.program_name);
    expect(names, "a pending listing must never appear").not.toContain(pending.program_name);
    expect(names, "a listing whose deadline passed must not appear").not.toContain(closed.program_name);
  });

  it("does not rely on RLS alone: a service-role client (which bypasses it) still never sees a pending row", async () => {
    const pending = await fixture("pending-admin", { moderation_status: "pending", application_deadline: isoDate(7) });
    const names = mine(await loadOpenScholarshipsPreview(admin, 500)).map((r) => r.program_name);
    expect(names).not.toContain(pending.program_name);
  });

  it("orders by nearest deadline first, with undated listings after every dated one", async () => {
    const later = await fixture("later", { moderation_status: "verified", application_deadline: isoDate(30) });
    const sooner = await fixture("sooner", { moderation_status: "verified", application_deadline: isoDate(3) });
    const undated = await fixture("undated-order", { moderation_status: "verified", application_deadline: null });

    const names = mine(await loadOpenScholarshipsPreview(anon, 500)).map((r) => r.program_name);
    const pos = (n: string) => names.indexOf(n);
    expect(pos(sooner.program_name)).toBeGreaterThan(-1);
    expect(pos(sooner.program_name)).toBeLessThan(pos(later.program_name));
    expect(pos(later.program_name)).toBeLessThan(pos(undated.program_name));
  });

  it("honours the limit", async () => {
    await fixture("limit-a", { moderation_status: "verified", application_deadline: isoDate(8) });
    await fixture("limit-b", { moderation_status: "verified", application_deadline: isoDate(9) });
    expect((await loadOpenScholarshipsPreview(anon, 2)).length).toBe(2);
    expect((await loadOpenScholarshipsPreview(anon)).length, "the default is four").toBeLessThanOrEqual(4);
  });

  it("returns only the columns a public landing row renders — never the moderation trail", async () => {
    await fixture("columns", { moderation_status: "verified", application_deadline: isoDate(4) });
    const rows = mine(await loadOpenScholarshipsPreview(anon, 500));
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "application_deadline",
        "deadline_note",
        "degree_levels",
        "funding_type",
        "host_institution",
        "id",
        "official_url",
        "program_name",
        "provider",
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("INTERNAL-ONLY");
  });
});
