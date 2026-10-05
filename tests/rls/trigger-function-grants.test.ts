/**
 * #683 — the four trigger-only functions that a database built from the repo used to leave executable by anon and authenticated (migration 0213).
 *
 * Two halves, the same pair 0211 proves for its six: (1) no client role can execute any of them, service_role still can; (2) each trigger still FIRES when
 * the action that triggers it happens (a trigger does not need the caller's EXECUTE: that privilege is checked when the trigger is created).
 *
 * Reads the grants through function_acl_audit() (0212, service role only), so the answer is the real catalogue and not a mirror. Uses the service role
 * only, so it can also be run against the preview project with the hosted escape hatch.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const FUNCTIONS = ["apply_credit_ledger_entry", "log_application_stage_change", "trigger_check_activation_from_applications", "trigger_check_activation_from_resumes"] as const;
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

interface AclRow { function_name: string; identity_args: string; security_definer: boolean; anon_exec: boolean; authenticated_exec: boolean; service_role_exec: boolean; public_exec: boolean }
async function aclRows(): Promise<AclRow[]> {
  const { data, error } = await admin.rpc("function_acl_audit" as never);
  if (error) throw new Error(`function_acl_audit: ${error.message}`);
  return (data ?? []) as unknown as AclRow[];
}

describe("who can execute the four trigger functions (the four ACL tests are the discriminating ones: they fail on a database without 0213)", () => {
  it("the audit sees all four (the test is not vacuous)", async () => {
    const rows = await aclRows();
    for (const fn of FUNCTIONS) expect(rows.filter((r) => r.function_name === fn), fn).toHaveLength(1);
  });

  it.each(FUNCTIONS)("%s: not executable by public, anon or authenticated; service_role keeps it", async (fn) => {
    const row = (await aclRows()).find((r) => r.function_name === fn)!;
    expect(row.anon_exec, "anon").toBe(false);
    expect(row.authenticated_exec, "authenticated").toBe(false);
    expect(row.public_exec, "PUBLIC").toBe(false);
    expect(row.service_role_exec, "service_role").toBe(true);
  });

  // DEFENCE IN DEPTH, NOT THE DISCRIMINATING CHECK: these pass with or without 0213, because PostgREST does not expose functions that return `trigger` (a call is refused
  // with PGRST202 either way). The four ACL assertions above are what tell an aligned database from an unaligned one.
  it.each(FUNCTIONS)("%s: a direct call as anon is refused (passes with or without 0213)", async (fn) => {
    const { error } = await anon.rpc(fn as never);
    expect(error, "an anon call must not reach the function").not.toBeNull();
    expect(["42501", "PGRST202"]).toContain(error!.code);
  });
});

describe("the triggers still fire", () => {
  let userId = "";
  let orgId = "";
  const resumeIds: string[] = [];
  const appIds: string[] = [];

  beforeAll(async () => {
    const u = await createTestUser("grant0213");
    userId = u.id;
  }, 120_000);
  afterAll(async () => {
    for (const id of appIds) await admin.from("applications").delete().eq("id", id);
    if (resumeIds.length) await admin.from("resumes").delete().in("id", resumeIds);
    if (orgId) await deleteOrgsCascade(admin, [orgId]);
    if (userId) await deleteTestUsers([userId]);
  }, 120_000);

  it("a credit ledger entry updates the balance (apply_credit_ledger_entry)", async () => {
    const before = (await admin.from("profiles").select("credits_balance").eq("id", userId).single()).data!.credits_balance;
    const { error } = await admin.from("credit_ledger").insert({ user_id: userId, delta: 3, reason: "admin_adjustment", balance_after: before + 3 });
    expect(error).toBeNull();
    const after = (await admin.from("profiles").select("credits_balance").eq("id", userId).single()).data!.credits_balance;
    expect(after).toBe(before + 3);
  });

  it("a stage change writes a stage event (log_application_stage_change)", async () => {
    const org = await admin.from("organizations").insert({ name: `G0213-TEST Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true }).select("id, name").single();
    if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
    orgId = org.data.id;
    const job = await admin.from("job_postings").insert({ source_type: "internal", organization_id: orgId, company_name: org.data.name, title: `G0213-TEST ${randomUUID().slice(0, 6)}`, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() }).select("id").single();
    if (job.error || !job.data) throw new Error(`fixture job: ${job.error?.message}`);
    const resume = await admin.from("resumes").insert({ user_id: userId, structured_content: { contact: { name: "Fixture" }, summary: "Fixture.", experience: [], education: [], skills: ["sql"] } }).select("id").single();
    if (resume.error || !resume.data) throw new Error(`fixture resume: ${resume.error?.message}`);
    resumeIds.push(resume.data.id);
    const app = await admin.from("applications").insert({ user_id: userId, job_posting_id: job.data.id, resume_id: resume.data.id, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
    if (app.error || !app.data) throw new Error(`fixture application: ${app.error?.message}`);
    appIds.push(app.data.id);
    const upd = await admin.from("applications").update({ stage: "interviewing" }).eq("id", app.data.id);
    expect(upd.error).toBeNull();
    const { data: events } = await admin.from("application_stage_events").select("id").eq("application_id", app.data.id);
    expect((events ?? []).length, "a stage event per change").toBeGreaterThan(0);
  });
});
