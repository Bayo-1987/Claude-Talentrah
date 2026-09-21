/**
 * The real Server Actions behind send-447's "save as draft" feature, run end
 * to end — not the RLS/grant mechanics alone (tests/rls/job-posting-draft-
 * visibility.test.ts covers those), but the actual code paths an employer's
 * browser submits to.
 *
 * ── THE RECIPE ─────────────────────────────────────────────────────────────
 *
 * Same direct-Server-Action pattern tests/employer/job-posting-skills.test.ts
 * already establishes: createClient() is mocked to a REAL, RLS-honouring
 * session (tests/support/auth.ts's sessionFor()), next/cache's
 * revalidatePath is stubbed (it throws outside a real Next request), and
 * redirect() is left real — outside Next's request context it throws a
 * plain Error with a `NEXT_REDIRECT;<type>;<url>;<status>;` digest, parsed
 * directly below to recover the created job's id.
 *
 * ONE employer identity for the whole file, same reasoning as
 * job-posting-skills.test.ts's own header: requireEmployer() -> requireUser()
 * -> getOptionalUser() is wrapped in React's cache(), which degrades to an
 * unscoped, never-expiring module-level memo outside a real request. A
 * second employer would silently keep resolving to the first one's cached
 * identity, so this file stays single-user.
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

const { postJobAction, publishJobAction, requestJobReviewAction } = await import(
  "@/lib/employer/actions"
);

function redirectDigest(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  }
  return digest;
}

/** postJobAction redirects to "/employer/jobs?posted=<id>" for BOTH intents
 * (see the action's own comment on why) — the only place the new row's id
 * is observable from outside the action. */
function createdJobId(err: unknown): string {
  const url = redirectDigest(err).split(";")[2];
  const match = url.match(/posted=([^&;]+)/);
  if (!match) throw new Error(`redirect URL had no posted= id: ${url}`);
  return match[1];
}

/** A real base form every test starts from — mirrors what job-posting-
 * form.tsx actually submits, minus the fields a given test overrides. */
function baseForm(overrides: { title: string; intent?: "draft" | "publish" }): FormData {
  const form = new FormData();
  form.set("title", overrides.title);
  form.set("location", "Lagos, Nigeria");
  form.set(
    "description",
    "A real job description, long enough to pass the form's own 40-character minimum length check.",
  );
  form.append("skills", "sql");
  if (overrides.intent) form.set("intent", overrides.intent);
  return form;
}

async function rowOf(id: string) {
  const { data, error } = await admin
    .from("job_postings")
    .select("status, posted_at, admin_review_requested_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

let userId: string;
let userEmail: string;
let orgId: string;
const createdJobIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("draftactions");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  const orgName = `DRAFTACTIONS-TEST-${randomUUID()}`;
  const { data: org, error: orgError } = await testClientRef.current
    .from("organizations")
    .insert({ name: orgName, domain: "draftactions-test.example", created_by: userId })
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

describe("postJobAction: two intents, one action", () => {
  it('intent="draft" inserts status = draft', async () => {
    const form = baseForm({ title: "DRAFTACTIONS Backend Engineer", intent: "draft" });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const row = await rowOf(jobId);
    expect(row.status).toBe("draft");
  });

  it('intent="publish" still inserts status = open — the pre-existing behaviour, unchanged', async () => {
    const form = baseForm({ title: "DRAFTACTIONS Frontend Engineer", intent: "publish" });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const row = await rowOf(jobId);
    expect(row.status).toBe("open");
  });

  it("no intent at all defaults to publish, not a silent draft", async () => {
    // The primary submit button's own behaviour before this send (and
    // still, for any caller that never sends intent — e.g. a stale client).
    const form = baseForm({ title: "DRAFTACTIONS Data Engineer" });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const row = await rowOf(jobId);
    expect(row.status).toBe("open");
  });
});

describe("publishJobAction: the real action, end to end", () => {
  let draftId: string;

  beforeAll(async () => {
    const form = baseForm({ title: "DRAFTACTIONS Publish-Me Engineer", intent: "draft" });
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      draftId = createdJobId(err);
    }
    createdJobIds.push(draftId);
  });

  it("transitions draft -> open and stamps posted_at, in one real call", async () => {
    const before = await rowOf(draftId);
    expect(before.status).toBe("draft");

    const beforePublish = Date.now();
    await publishJobAction(draftId);
    const afterPublish = Date.now();

    const after = await rowOf(draftId);
    expect(after.status).toBe("open");
    expect(after.posted_at).not.toBeNull();
    const postedAtMs = new Date(after.posted_at).getTime();
    expect(postedAtMs).toBeGreaterThanOrEqual(beforePublish);
    expect(postedAtMs).toBeLessThanOrEqual(afterPublish + 1000);
  });
});

describe("requestJobReviewAction: refuses a non-open posting", () => {
  let draftId: string;
  let openId: string;

  beforeAll(async () => {
    const draftForm = baseForm({ title: "DRAFTACTIONS Review-Guard Draft", intent: "draft" });
    try {
      await postJobAction(null, draftForm);
      throw new Error("expected a redirect");
    } catch (err) {
      draftId = createdJobId(err);
    }
    createdJobIds.push(draftId);

    const openForm = baseForm({ title: "DRAFTACTIONS Review-Guard Open", intent: "publish" });
    try {
      await postJobAction(null, openForm);
      throw new Error("expected a redirect");
    } catch (err) {
      openId = createdJobId(err);
    }
    createdJobIds.push(openId);
  });

  it("does nothing against a draft's id — the button's own condition is not the only gate", async () => {
    /*
     * Found while auditing this feature, not asked for directly: before this
     * send, this action never checked status at all. The "Submit for
     * review" button already only renders for `job.status === "open"`, but
     * that is a rendering condition — a direct call with a draft's own id
     * would previously have queued it for Path 3 review anyway.
     */
    await requestJobReviewAction(draftId);
    const row = await rowOf(draftId);
    expect(row.admin_review_requested_at).toBeNull();
  });

  it("POSITIVE CONTROL: still works normally for an open posting", async () => {
    await requestJobReviewAction(openId);
    const row = await rowOf(openId);
    expect(row.admin_review_requested_at).not.toBeNull();
  });
});
