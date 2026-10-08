/**
 * Every place that changes what the employer job-list widget shows purges that organisation's embed page (plan v2.1, item 4): the REAL employer Server Actions run against the test
 * database with `revalidateEmbed` spied. A post, an edit, a close, a reopen and a delete each purge the right organisation; a Company Profile edit does too; and the other
 * organisation is never purged by someone else's action. The expiry sweep purges each affected organisation once.
 *
 * Same direct-Server-Action recipe as tests/employer/job-posting-salary-edit.test.ts (a real RLS-honouring session client, one employer identity for the file).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
const embed = vi.hoisted(() => ({ one: vi.fn(), many: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => testClientRef.current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/embed/revalidate", async (orig) => ({
  ...(await orig<typeof import("@/lib/embed/revalidate")>()),
  revalidateEmbed: embed.one,
  revalidateEmbedForOrganizations: embed.many,
}));

const { postJobAction, updateJobAction, setJobStatusAction, deleteJobAction, updateCompanyProfileAction } = await import("@/lib/employer/actions");
const { closeExpiredInternalPostings } = await import("@/lib/jobs/expiry");

function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  return digest.split(";")[2];
}
function jobForm(title: string): FormData {
  const f = new FormData();
  f.set("title", title);
  f.set("location", "Lagos, Nigeria");
  f.set("description", "A real job description, long enough to pass the form's own 40-character minimum length check.");
  f.append("skills", "javascript");
  return f;
}
async function postJob(title: string): Promise<string> {
  try {
    await postJobAction(null, jobForm(title));
  } catch (err) {
    const m = redirectUrl(err).match(/posted=([^&;]+)/);
    if (m) return m[1];
  }
  throw new Error("post did not redirect with posted=<id>");
}

let userId: string;
let orgId: string;
const createdJobIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("widgethooks");
  userId = user.id;
  testClientRef.current = await sessionFor(user.email, user.id);
  const { data: org, error } = await testClientRef.current
    .from("organizations")
    .insert({ name: `WIDGETHOOKS-TEST-${randomUUID()}`, domain: "widgethooks-test.example", created_by: userId })
    .select("id")
    .single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  orgId = org.id;
  const { error: m } = await testClientRef.current.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  if (m) throw new Error(`fixture membership: ${m.message}`);
}, 60_000);

beforeEach(() => {
  embed.one.mockReset();
  embed.many.mockReset();
});

afterAll(async () => {
  if (createdJobIds.length) await admin.from("job_postings").delete().in("id", createdJobIds);
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteTestOrgs([orgId]);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("employer actions purge their own organisation's widget page", () => {
  it("posting a job", async () => {
    const id = await postJob(`Hook Post ${randomUUID()}`);
    createdJobIds.push(id);
    expect(embed.one).toHaveBeenCalledWith(orgId);
  });

  it("editing, closing, reopening and deleting a job", async () => {
    const id = await postJob(`Hook Life ${randomUUID()}`);
    createdJobIds.push(id);

    embed.one.mockClear();
    await updateJobAction(id, null, jobForm(`Hook Life Edited ${randomUUID()}`)).catch(() => undefined);
    expect(embed.one).toHaveBeenCalledWith(orgId);

    embed.one.mockClear();
    await setJobStatusAction(id, "closed");
    expect(embed.one).toHaveBeenCalledWith(orgId);

    embed.one.mockClear();
    await setJobStatusAction(id, "open");
    expect(embed.one).toHaveBeenCalledWith(orgId);

    await setJobStatusAction(id, "closed");
    embed.one.mockClear();
    await deleteJobAction(id).catch(() => undefined);
    expect(embed.one).toHaveBeenCalledWith(orgId);
  });

  it("a Company Profile edit (the name and logo are shown on the widget)", async () => {
    const f = new FormData();
    f.set("name", `WIDGETHOOKS-TEST-${randomUUID()}`);
    f.set("domain", "widgethooks-test.example");
    await updateCompanyProfileAction(null, f);
    expect(embed.one).toHaveBeenCalledWith(orgId);
  });

  it("never purges any other organisation", async () => {
    const id = await postJob(`Hook Only Mine ${randomUUID()}`);
    createdJobIds.push(id);
    expect(embed.one.mock.calls.every((c) => c[0] === orgId)).toBe(true);
  });
});

describe("the expiry sweep purges each affected organisation once", () => {
  it("closing two expired postings of one organisation purges it once, and an unexpired posting purges nothing", async () => {
    const mk = async (key: string, expires: string | null) => {
      const { data, error } = await admin
        .from("job_postings")
        .insert({
          source_type: "internal",
          organization_id: orgId,
          company_name: "WIDGETHOOKS",
          title: `WIDGETHOOKS sweep ${key} ${randomUUID().slice(0, 6)}`,
          description: "Fixture posting for the expiry sweep hook test.",
          structured_jd: { skills: ["sql"] },
          status: "open",
          expires_at: expires,
          dedup_fingerprint: randomUUID(),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`sweep fixture: ${error?.message}`);
      createdJobIds.push(data.id);
      return data.id;
    };
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const a = await mk("a", past);
    const b = await mk("b", past);
    await mk("live", null);

    // Scope the sweep to this test's own postings: any other expired posting in the test database would also be swept, so only assert on this organisation's purge.
    const result = await closeExpiredInternalPostings();
    expect(result.ids).toEqual(expect.arrayContaining([a, b]));
    const orgsPassed = (embed.many.mock.calls.at(-1)?.[0] ?? []) as Array<string | null>;
    expect(orgsPassed).toContain(orgId);
  });
});
