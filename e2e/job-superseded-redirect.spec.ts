import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { randomUUID } from "node:crypto";

/**
 * 0202 / S12 (b) — a superseded duplicate's old URL answers 308 to the row that replaced it, on the BUILT app (CI runs
 * `next build && next start`), because a redirect thrown after the response has started is not a 308 at all: the
 * `loading.tsx`-in-the-segment trap documented in jobs/[id]/job-for-request.ts. A status code is only observable on the
 * wire, so this is a wire test: no redirect following.
 *
 * It also pins the other two public outcomes: the kept row still answers 200, and an id nobody ever had is still 404 (a
 * dead end is not a redirect loop).
 */
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin =
  SERVICE && SUPA_URL
    ? createClient<Database>(SUPA_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
if (process.env.CI && !admin) throw new Error("job-superseded-redirect spec cannot run in CI: missing service key or Supabase URL");

test("a superseded posting 308s to the kept one; the kept one is 200; an unknown id is 404", async ({ request }) => {
  if (!admin) return;
  const tag = randomUUID().slice(0, 8);
  const description = `Fixture posting for the superseded-redirect e2e (${tag}). It owns the client relationship and runs the project end to end.`;
  const base = {
    source_type: "external" as const,
    title: `E2E Superseded ${tag}`,
    company_name: `E2E Superseded Co ${tag}`,
    location: "Remote, South Africa",
    work_type: "remote" as const,
    external_source: "e2e",
    status: "open" as const,
    description,
  };
  const ids: string[] = [];
  try {
    const older = await admin
      .from("job_postings")
      .insert({ ...base, external_url: `https://example.invalid/e2e/${tag}/a`, dedup_fingerprint: `e2e-sup-a-${tag}`, posted_at: new Date(Date.now() - 7_200_000).toISOString() })
      .select("id")
      .single();
    const kept = await admin
      .from("job_postings")
      .insert({ ...base, external_url: `https://example.invalid/e2e/${tag}/b`, dedup_fingerprint: `e2e-sup-b-${tag}`, posted_at: new Date(Date.now() - 3_600_000).toISOString() })
      .select("id")
      .single();
    if (older.error || kept.error) throw new Error(`fixture: ${older.error?.message ?? kept.error?.message}`);
    ids.push(older.data.id, kept.data.id);

    // Before: both are public.
    expect((await request.get(`/jobs/${older.data.id}`, { maxRedirects: 0 })).status()).toBe(200);

    const applied = await admin.rpc("apply_job_supersession", { p_companies: [base.company_name] });
    expect(applied.error).toBeNull();

    const res = await request.get(`/jobs/${older.data.id}`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(new URL(res.headers()["location"]!, "http://x").pathname).toBe(`/jobs/${kept.data.id}`);

    expect((await request.get(`/jobs/${kept.data.id}`, { maxRedirects: 0 })).status()).toBe(200);
    expect((await request.get(`/jobs/${randomUUID()}`, { maxRedirects: 0 })).status()).toBe(404);
  } finally {
    if (ids.length) {
      await admin.from("job_postings").update({ superseded_by: null }).in("id", ids);
      await admin.from("job_postings").delete().in("id", ids);
    }
  }
});
