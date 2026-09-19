/**
 * send-418 — warnIfNameLooksLikeOwnOrg (src/lib/mentorship/name-validation.ts),
 * the same organisation-name join tests/mentorship/mentor-application-name-
 * warning.test.ts already proves for the ADMIN queue (send-400), now run at
 * the moment a mentor actually chooses their own display_name
 * (applyToBecomeMentorAction / updateMentorProfileAction). This proves the
 * join reaches the real `organization_members` / `organizations` tables
 * through the caller's own AUTHENTICATED client, not just that
 * checkMentorDisplayName's pure heuristic is correct in isolation
 * (tests/lib/mentor-name-validation.test.ts already covers that half).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`display-name-org-warning suite cannot run: ${key} is not set.`);
}

const { warnIfNameLooksLikeOwnOrg } = await import("@/lib/mentorship/name-validation");

const tag = randomUUID().replace(/-/g, "").slice(0, 10);
const uniqueWord = `orgword${tag}`;

let owner: { id: string; client: DB };
let outsider: { id: string; client: DB };
let orgId: string;

beforeAll(async () => {
  [owner, outsider] = await Promise.all([
    createAuthedTestUser(`dispname-warn-owner-${tag}`),
    createAuthedTestUser(`dispname-warn-outsider-${tag}`),
  ]);

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `${uniqueWord} circle`, domain: `${tag}.example`, created_by: owner.id })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: owner.id, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);
}, 60_000);

afterAll(async () => {
  await deleteTestOrgs([orgId]);
  await deleteTestUsers([owner.id, outsider.id]);
}, 60_000);

describe("warnIfNameLooksLikeOwnOrg", () => {
  it("warns when the candidate display name shares a word with the caller's own organisation", async () => {
    const warning = await warnIfNameLooksLikeOwnOrg(owner.client, owner.id, `${uniqueWord} Reviewer`);
    expect(warning, "REGRESSION: a display name matching the caller's own org was not flagged").toMatch(
      /organisation name/i,
    );
  });

  it("does not warn for an ordinary name with no matching organisation", async () => {
    const warning = await warnIfNameLooksLikeOwnOrg(outsider.client, outsider.id, "Nkem Adeyemi");
    expect(warning, "FALSE POSITIVE: an ordinary display name was flagged").toBeNull();
  });
});
