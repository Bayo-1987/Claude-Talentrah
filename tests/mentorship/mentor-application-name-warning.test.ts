/**
 * send-400 — pendingMentorApplications() (src/lib/admin/moderation/queues.ts)
 * wiring for checkMentorDisplayName's organisation-name check.
 *
 * tests/lib/mentor-name-validation.test.ts already proves the pure heuristic
 * is correct in isolation, including both real production names ("Zimcrest
 * Technologies", "Info Talentrah") that motivated it. This suite proves the
 * other half: that the admin mentor-review queue actually reaches the
 * applicant's own organisation via a real `organization_members` /
 * `organizations` join and surfaces the resulting warning — a join that
 * didn't exist before this change and could easily be wired wrong (wrong FK
 * direction, wrong column, RLS silently dropping rows) without a test that
 * exercises it against the real database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`mentor-application-name-warning suite cannot run: ${key} is not set.`);
}

const { pendingMentorApplications } = await import("@/lib/admin/moderation/queues");

// A hex-only random tag can't accidentally spell any of COMPANY_WORD's
// listed words (they all need letters hex digits don't have — i, n, g, t,
// h, l, m, o, p, r, s, u, v, w, y), so it can't produce a false positive
// through that path — only through the organisation-name join this suite
// exists to test.
const tag = randomUUID().replace(/-/g, "").slice(0, 10);
const uniqueWord = `fictorq${tag}`;

let matchUserId: string;
let cleanUserId: string;
let orgId: string;

beforeAll(async () => {
  const [matchUser, cleanUser] = await Promise.all([
    createTestUser(`name-warn-match-${tag}`),
    createTestUser(`name-warn-clean-${tag}`),
  ]);
  matchUserId = matchUser.id;
  cleanUserId = cleanUser.id;

  const { error: matchProfileError } = await admin
    .from("profiles")
    .update({ first_name: uniqueWord, last_name: "Reviewer" })
    .eq("id", matchUserId);
  if (matchProfileError) throw new Error(`fixture profile: ${matchProfileError.message}`);

  const { error: cleanProfileError } = await admin
    .from("profiles")
    .update({ first_name: "Nkem", last_name: "Adeyemi" })
    .eq("id", cleanUserId);
  if (cleanProfileError) throw new Error(`fixture profile: ${cleanProfileError.message}`);

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `${uniqueWord} circle`, domain: `${tag}.example`, created_by: matchUserId })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: matchUserId, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);

  const { error: mentorError } = await admin.from("mentor_profiles").insert([
    { user_id: matchUserId, status: "pending", bio: `fixture ${tag}` },
    { user_id: cleanUserId, status: "pending", bio: `fixture ${tag}` },
  ]);
  if (mentorError) throw new Error(`fixture mentor_profiles: ${mentorError.message}`);
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().in("user_id", [matchUserId, cleanUserId]);
  await deleteTestOrgs([orgId]);
  await deleteTestUsers([matchUserId, cleanUserId]);
}, 60_000);

describe("pendingMentorApplications' nameWarning", () => {
  it("flags an applicant whose profile name shares a word with their own organisation's name", async () => {
    const queue = await pendingMentorApplications();
    const match = queue.find((a) => a.userId === matchUserId);
    expect(match, "fixture applicant missing from the pending queue").toBeTruthy();
    expect(
      match?.nameWarning,
      "REGRESSION: an applicant's own organisation name matching their profile name was not surfaced",
    ).toMatch(/organisation name/i);
  });

  it("does not flag an applicant with an ordinary name and no matching organisation", async () => {
    const queue = await pendingMentorApplications();
    const clean = queue.find((a) => a.userId === cleanUserId);
    expect(clean, "fixture applicant missing from the pending queue").toBeTruthy();
    expect(clean?.nameWarning, "FALSE POSITIVE: an ordinary applicant name was flagged").toBeNull();
  });
});
