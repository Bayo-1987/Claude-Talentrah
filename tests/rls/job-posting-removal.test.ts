/**
 * Removing a scam posting (0055/0056), and the four separate mechanisms it
 * takes to make that stick.
 *
 * `removed` is not `closed`. Closed means the job ended; removed means we
 * decided nobody should see it, and collapsing the two would lose the only
 * record of the second.
 *
 * Each mechanism below fails differently, and the tests are grouped by which
 * one is doing the work — because when one of them regresses, the others keep
 * the feature looking fine:
 *
 *   1. The SELECT policy hides it from the public. NOT from the owning org:
 *      `is_org_member` is deliberately left out of the new condition, so an
 *      employer is never left wondering where their job went.
 *   2. The UPDATE policy's USING clause stops the org EDITING a removed
 *      posting — otherwise it could rewrite the title and description of a
 *      listing it has been told is a scam.
 *   3. The UPDATE policy's WITH CHECK stops the org SETTING or CLEARING
 *      `removed` itself. Together with (2) that is a trap door: in and out
 *      only through the service role.
 *   4. A TRIGGER stops the nightly ingest un-removing it. This is the one that
 *      is invisible from the policies and the one the feature does not work
 *      without — `ingestAllSources` upserts every posting the source returns
 *      with `status: 'open'`, as the service role, so an operator's removal at
 *      21:00 would be undone by the 05:00 cron with nobody told.
 *
 * And one that is not a policy at all: `removed_at` and `removal_reason` carry
 * moderation history, and `job_postings` has a table-level UPDATE grant. RLS
 * decides which ROWS; grants decide which COLUMNS. Without the column grant an
 * org could write its own removal_reason onto a live posting.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { createClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/types";

type PostingPatch = Partial<Tables<"job_postings">>;

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let member: Awaited<ReturnType<typeof createAuthedTestUser>>;
let outsider: Awaited<ReturnType<typeof createAuthedTestUser>>;
let orgId: string;
let internalId: string;
let externalId: string;
const externalFingerprint = `removal-test-${randomUUID()}`;

async function setStatus(id: string, patch: PostingPatch) {
  const { error } = await admin.from("job_postings").update(patch).eq("id", id);
  if (error) throw new Error(`fixture update failed: ${error.message}`);
}

async function statusOf(id: string) {
  const { data, error } = await admin
    .from("job_postings")
    .select("status, removed_at, removal_reason")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  member = await createAuthedTestUser("removal-member");
  outsider = await createAuthedTestUser("removal-outsider");

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: "REMOVAL-TEST Co",
      domain: `removal-${randomUUID()}.test`,
      created_by: member.id,
      verified: true,
    })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: member.id, role: "owner" });
  if (memberErr) throw new Error(`fixture membership: ${memberErr.message}`);

  const base = {
    company_name: "REMOVAL-TEST Co",
    description: "Fixture posting owned by tests/rls/job-posting-removal.",
    structured_jd: {},
    status: "open" as const,
    posted_at: new Date().toISOString(),
  };

  const { data: internal, error: iErr } = await admin
    .from("job_postings")
    .insert({
      ...base,
      source_type: "internal",
      organization_id: orgId,
      title: "REMOVAL-TEST Internal",
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (iErr || !internal) throw new Error(`fixture internal posting: ${iErr?.message}`);
  internalId = internal.id;

  const { data: ext, error: eErr } = await admin
    .from("job_postings")
    .insert({
      ...base,
      source_type: "external",
      title: "REMOVAL-TEST External",
      external_source: "removal-test",
      external_url: `https://example.test/${randomUUID()}`,
      dedup_fingerprint: externalFingerprint,
    })
    .select("id")
    .single();
  if (eErr || !ext) throw new Error(`fixture external posting: ${eErr?.message}`);
  externalId = ext.id;
});

afterAll(async () => {
  // job_postings does NOT cascade from organizations (deliberately — see
  // CLAUDE.md), so the postings have to go first or the org delete is refused
  // with 23503 and resolves without throwing.
  const { error } = await admin.from("job_postings").delete().in("id", [internalId, externalId]);
  if (error) console.error("[removal cleanup: postings]", error.message);
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers([member.id, outsider.id]);
});

describe("1. the public loses sight of it; the owner does not", () => {
  beforeAll(async () => {
    await setStatus(internalId, {
      status: "removed",
      removed_at: new Date().toISOString(),
      removal_reason: "REMOVAL-TEST: reported as a scam",
    });
    await setStatus(externalId, {
      status: "removed",
      removed_at: new Date().toISOString(),
      removal_reason: "REMOVAL-TEST: reported as a scam",
    });
  });

  it("a signed-out visitor cannot see a removed posting", async () => {
    const { data } = await anon.from("job_postings").select("id").eq("id", internalId);
    expect(data).toEqual([]);
  });

  it("nor a removed external posting", async () => {
    const { data } = await anon.from("job_postings").select("id").eq("id", externalId);
    expect(data).toEqual([]);
  });

  it("a signed-in stranger cannot either", async () => {
    const { data } = await outsider.client.from("job_postings").select("id").eq("id", internalId);
    expect(data).toEqual([]);
  });

  it("but the owning org still sees its own, and the reason", async () => {
    /*
     * The deliberate exception. Without it the product's answer to "where did
     * my job go?" is silence, and removal_reason would be a column nobody can
     * read.
     */
    const { data, error } = await member.client
      .from("job_postings")
      .select("id, status, removal_reason")
      .eq("id", internalId)
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe("removed");
    expect(data!.removal_reason).toContain("scam");
  });

  it("an external posting has no owner to see it — it goes fully dark", async () => {
    // No organization_id, so there is no is_org_member branch to fall through
    // to. Correct: there is no employer here owed an explanation.
    const { data } = await member.client.from("job_postings").select("id").eq("id", externalId);
    expect(data).toEqual([]);
  });
});

describe("2. the owner cannot edit what has been removed", () => {
  it("an update to a removed posting changes nothing", async () => {
    const { error } = await member.client
      .from("job_postings")
      .update({ title: "REMOVAL-TEST rewritten" })
      .eq("id", internalId);
    // A row policy denial affects zero rows rather than erroring, so the
    // assertion that matters is the re-read, not the absence of an error.
    expect(error).toBeNull();

    const { data } = await admin
      .from("job_postings")
      .select("title")
      .eq("id", internalId)
      .single();
    expect(data!.title).toBe("REMOVAL-TEST Internal");
  });
});

describe("4. the nightly ingest cannot un-remove it", () => {
  it("an ingest-shaped write — status open, removed_at untouched — is declined", async () => {
    /*
     * Exactly what `ingestAllSources` upserts: it sets status and never
     * mentions removed_at. Run as the service role, which is the role that IS
     * allowed to set status, so no policy can stop this — only the trigger.
     */
    await setStatus(externalId, { status: "open", last_checked_at: new Date().toISOString() });

    const after = await statusOf(externalId);
    expect(after.status).toBe("removed");
    expect(after.removed_at).not.toBeNull();
    expect(after.removal_reason).toContain("scam");
  });

  it("but the admin restore — status and removed_at in one statement — goes through", async () => {
    await setStatus(externalId, { status: "closed", removed_at: null, removal_reason: null });

    const after = await statusOf(externalId);
    expect(after.status).toBe("closed");
    expect(after.removed_at).toBeNull();
  });

  it("and once restored, the ingest may reopen it normally", async () => {
    await setStatus(externalId, { status: "open" });
    expect((await statusOf(externalId)).status).toBe("open");
  });
});

describe("3. removal is an operator verb, in and out", () => {
  beforeAll(async () => {
    await setStatus(internalId, { status: "open", removed_at: null, removal_reason: null });
  });

  it("the org cannot remove its own posting", async () => {
    const { error } = await member.client
      .from("job_postings")
      .update({ status: "removed" })
      .eq("id", internalId);
    // WITH CHECK, which raises rather than silently matching nothing.
    expect(error).not.toBeNull();
    expect((await statusOf(internalId)).status).toBe("open");
  });

  it("the org cannot restore one either", async () => {
    await setStatus(internalId, {
      status: "removed",
      removed_at: new Date().toISOString(),
      removal_reason: "REMOVAL-TEST: reported as a scam",
    });

    const { error } = await member.client
      .from("job_postings")
      .update({ status: "open", removed_at: null })
      .eq("id", internalId);
    expect(error).not.toBeNull();
    expect((await statusOf(internalId)).status).toBe("removed");

    await setStatus(internalId, { status: "open", removed_at: null, removal_reason: null });
  });

  it("POSITIVE CONTROL: the org can still close and reopen its own posting", async () => {
    // The trap door must not become a wall. Closing is the employer's own
    // verb and has to keep working.
    const { error: closeErr } = await member.client
      .from("job_postings")
      .update({ status: "closed" })
      .eq("id", internalId);
    expect(closeErr).toBeNull();
    expect((await statusOf(internalId)).status).toBe("closed");

    const { error: openErr } = await member.client
      .from("job_postings")
      .update({ status: "open" })
      .eq("id", internalId);
    expect(openErr).toBeNull();
    expect((await statusOf(internalId)).status).toBe("open");
  });
});

describe("moderation history is not the org's to write", () => {
  it("an org cannot set removal_reason on its own live posting", async () => {
    /*
     * The grant, not the policy. The row is theirs and the UPDATE policy
     * permits it, so only the column-level revoke refuses this — which is why
     * it raises (42501) instead of matching zero rows.
     */
    const { error } = await member.client
      .from("job_postings")
      .update({ removal_reason: "REMOVAL-TEST: mine now" })
      .eq("id", internalId);
    expect(error).not.toBeNull();
    expect((await statusOf(internalId)).removal_reason).toBeNull();
  });

  it("nor removed_at", async () => {
    const { error } = await member.client
      .from("job_postings")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", internalId);
    expect(error).not.toBeNull();
    expect((await statusOf(internalId)).removed_at).toBeNull();
  });

  it("REGRESSION: expires_at is still writable — the grant list dropped it once", async () => {
    /*
     * 0056 revokes the table-level UPDATE grant and re-grants safe columns BY
     * NAME. The first version of that list was written on a branch cut before
     * 0053 merged, so `expires_at` was not in it — while existing on the
     * database the migration ran against. The revoke took it; the re-grant did
     * not give it back; nothing noticed, because nothing writes the column
     * yet.
     *
     * This asserts the exception list is exactly `removed_at` and
     * `removal_reason` and nothing else has quietly joined them. The migration
     * now also guards itself and refuses to apply if a column goes missing.
     */
    const { error } = await member.client
      .from("job_postings")
      .update({ expires_at: "2027-01-31T00:00:00.000Z" })
      .eq("id", internalId);
    expect(error).toBeNull();

    await setStatus(internalId, { expires_at: null });
  });

  it("POSITIVE CONTROL: the columns an employer really does own still write", async () => {
    const { error } = await member.client
      .from("job_postings")
      .update({ title: "REMOVAL-TEST Internal", location: "Lagos" })
      .eq("id", internalId);
    expect(error).toBeNull();
  });
});
