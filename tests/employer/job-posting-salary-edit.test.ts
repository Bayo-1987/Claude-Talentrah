/**
 * send-457 — an invalid salary on an edit used to silently drop every other
 * field in the same submission, not just salary.
 *
 * `updateJobAction` validated every section of the form and early-returned
 * on the FIRST one that failed — including `readSalaryForm`, which requires
 * an amount and a currency to travel together. Typing a salary amount with
 * no currency (easy to do: the "add a currency" hint was gated on
 * `initial?.salaryMin`, so it never showed the first time anyone typed an
 * amount) aborted the whole action before the `UPDATE` ever ran. The person's
 * other edits — title, location, description, years of experience — were
 * never rejected and re-shown as an error; they were just dropped, with no
 * navigation away and a small error banner easy to miss on a long page.
 * Confirmed against real production data: a posting's salary was genuinely
 * null in the database after being "saved" with an amount typed in, not a
 * display bug.
 *
 * ── THE RECIPE ──────────────────────────────────────────────────────────
 *
 * Same direct-Server-Action pattern as job-posting-skills.test.ts: a real,
 * RLS-honouring session client (tests/support/auth.ts's sessionFor()), one
 * employer identity for the whole file (requireEmployer's own cache()
 * memoization means a second identity here would silently resolve to the
 * first), next/cache's revalidatePath stubbed, redirect() left real and
 * parsed via its NEXT_REDIRECT digest.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { randomUUID } from "node:crypto";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { postJobAction, updateJobAction } = await import("@/lib/employer/actions");

function redirectDigest(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  }
  return digest;
}

function createdJobId(err: unknown): string {
  const url = redirectDigest(err).split(";")[2];
  const match = url.match(/posted=([^&;]+)/);
  if (!match) throw new Error(`redirect URL had no posted= id: ${url}`);
  return match[1];
}

/** A real base form every test starts from and overrides via `extra` —
 * mirrors what job-posting-form.tsx actually submits. */
function baseForm(overrides: { title: string }): FormData {
  const form = new FormData();
  form.set("title", overrides.title);
  form.set("location", "Lagos, Nigeria");
  form.set(
    "description",
    "A real job description, long enough to pass the form's own 40-character minimum length check.",
  );
  form.append("skills", "javascript");
  return form;
}

async function rowOf(jobId: string) {
  const { data, error } = await admin
    .from("job_postings")
    .select("title, salary_min, salary_max, salary_currency, salary_unit")
    .eq("id", jobId)
    .single();
  if (error || !data) throw new Error(`fixture lookup: ${error?.message}`);
  return data;
}

let userId: string;
let userEmail: string;
let orgId: string;
const createdJobIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("jobsalaryedit");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  const orgName = `JOBSALARYEDIT-TEST-${randomUUID()}`;
  const { data: org, error: orgError } = await testClientRef.current
    .from("organizations")
    .insert({ name: orgName, domain: "jobsalaryedit-test.example", created_by: userId })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await testClientRef.current
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);
}, 60_000);

afterAll(async () => {
  if (createdJobIds.length) {
    await admin.from("job_postings").delete().in("id", createdJobIds);
  }
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteTestOrgs([orgId]);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("updateJobAction: an invalid salary must not block unrelated fields from saving", () => {
  it("a salary amount with no currency still saves the title change in the same submission", async () => {
    const form = baseForm({ title: `Growth Marketer ${randomUUID()}` });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const before = await rowOf(jobId);
    expect(before.salary_min).toBeNull();

    const newTitle = `Growth Marketer (Updated) ${randomUUID()}`;
    const editForm = baseForm({ title: newTitle });
    editForm.set("salaryMin", "500000");
    // salaryCurrency deliberately left blank — the exact real-world mistake:
    // an amount typed in, no currency, and nothing on the page said it was
    // required.

    const result = await updateJobAction(jobId, null, editForm);

    // This alone would still pass on the pre-fix, broken behaviour (the
    // whole action returning this same error is exactly what it did before)
    // — it's the second assertion below that actually catches the bug.
    expect(result).toEqual({ error: "Add a currency for the salary, or clear both amounts." });

    const after = await rowOf(jobId);
    // THE ACTUAL FIX: the title change was not silently dropped along with
    // the rejected salary. Before this fix, updateJobAction early-returned
    // on the salary check before the UPDATE ever ran, so `after.title`
    // would still equal the ORIGINAL title here.
    expect(after.title).toBe(newTitle);
    // And salary itself was left untouched — no amount without a currency
    // ever reaches the database, half-written or otherwise.
    expect(after.salary_min).toBeNull();
    expect(after.salary_currency).toBeNull();
  });

  it("a complete, valid salary still saves normally alongside other edits", async () => {
    const form = baseForm({ title: `Ops Lead ${randomUUID()}` });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const newTitle = `Ops Lead (Updated) ${randomUUID()}`;
    const editForm = baseForm({ title: newTitle });
    editForm.set("salaryMin", "400000");
    editForm.set("salaryMax", "600000");
    editForm.set("salaryCurrency", "NGN");

    try {
      await updateJobAction(jobId, null, editForm);
      throw new Error("expected a redirect");
    } catch (err) {
      redirectDigest(err); // proves it succeeded rather than erroring
    }

    const after = await rowOf(jobId);
    expect(after.title).toBe(newTitle);
    expect(after.salary_min).toBe(400000);
    expect(after.salary_max).toBe(600000);
    expect(after.salary_currency).toBe("NGN");
  });
});
