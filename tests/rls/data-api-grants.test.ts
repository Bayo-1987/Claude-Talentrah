/**
 * send-459 — a standing regression test for 0192's own grants, not just its
 * one-time `do $$ ... end $$` apply-time check. That block only protects
 * this one migration's own apply; nothing stops a FUTURE migration from
 * accidentally revoking one of these grants again (the exact shape of
 * mistake CLAUDE.md's own "0027 revoked a grant as tidy-up" lesson
 * describes). This file is that standing check.
 *
 * PostgREST does not expose `information_schema` to a supabase-js client at
 * all (confirmed twice already in this repo — see
 * tests/employer/assessment-storage-rls.test.ts's own "EXPLICIT GRANT
 * CHECK" comment and 0096's header), so this reads through
 * `data_api_grants_snapshot()` (0193) — a SECURITY DEFINER function that
 * runs the same `information_schema.role_table_grants` query 0192's own
 * self-check uses, inside Postgres, and returns plain rows a normal
 * `.rpc()` call can read. ONE call, not eight — every assertion below reads
 * from the same in-memory snapshot, matching 0192's own `do $$` block
 * check-for-check so the two can't drift from each other.
 */
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";

async function grantsSnapshot() {
  const { data, error } = await admin.rpc("data_api_grants_snapshot");
  if (error) throw error;
  return data ?? [];
}

function hasGrant(
  snapshot: Awaited<ReturnType<typeof grantsSnapshot>>,
  table: string,
  grantee: "anon" | "authenticated",
  privilege?: string,
): boolean {
  return snapshot.some(
    (g) => g.table_name === table && g.grantee === grantee && (privilege === undefined || g.privilege_type === privilege),
  );
}

describe("Data API grant catch-up (0192) holds — send-458/459", () => {
  it("job_posting_reports: authenticated has INSERT", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "job_posting_reports", "authenticated", "INSERT")).toBe(true);
  });

  it("course_recommendations: anon has SELECT", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "course_recommendations", "anon", "SELECT")).toBe(true);
  });

  it("blog_posts: anon has SELECT", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "blog_posts", "anon", "SELECT")).toBe(true);
  });

  it("job_posting_assessment_files: anon has SELECT; authenticated has INSERT, UPDATE and DELETE", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "job_posting_assessment_files", "anon", "SELECT")).toBe(true);
    expect(hasGrant(snapshot, "job_posting_assessment_files", "authenticated", "INSERT")).toBe(true);
    expect(hasGrant(snapshot, "job_posting_assessment_files", "authenticated", "UPDATE")).toBe(true);
    expect(hasGrant(snapshot, "job_posting_assessment_files", "authenticated", "DELETE")).toBe(true);
  });

  it("country_default_events: authenticated has SELECT; anon has no grant at all", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "country_default_events", "authenticated", "SELECT")).toBe(true);
    expect(hasGrant(snapshot, "country_default_events", "anon")).toBe(false);
  });

  it("resume_builder_start_events: authenticated has SELECT; anon has no grant at all", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "resume_builder_start_events", "authenticated", "SELECT")).toBe(true);
    expect(hasGrant(snapshot, "resume_builder_start_events", "anon")).toBe(false);
  });

  it("farah_session_events: authenticated has SELECT; anon has no grant at all", async () => {
    const snapshot = await grantsSnapshot();
    expect(hasGrant(snapshot, "farah_session_events", "authenticated", "SELECT")).toBe(true);
    expect(hasGrant(snapshot, "farah_session_events", "anon")).toBe(false);
  });
});
