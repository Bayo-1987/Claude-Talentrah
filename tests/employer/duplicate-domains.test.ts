/**
 * One VERIFIED organisation per work-email domain — and deliberately no
 * constraint at all on unverified ones.
 *
 * THE GAP. `createOrganizationAction` inserted with no check for an existing
 * organisation at the claimed domain, and the onboarding page's "joinable"
 * list only offers orgs where `verified = true`. So: person A creates an org
 * that is not verified; person B at the same domain signs up, sees an empty
 * joinable list, and creates a second org for the same company. Colleagues end
 * up in disconnected companies with postings and analytics split between them,
 * and no merge path exists.
 *
 * WHY THE OBVIOUS FIX IS WRONG, and this is the part that decided the design.
 * A bare `unique (domain)` looks right until you ask what an UNVERIFIED org
 * actually is. Production holds one: "Fatishcakes", domain `fatishcakes.com`,
 * created by a **gmail.com** user. `evaluateDomainVerification` requires the
 * claimed domain to match the creator's confirmed email domain, so that org
 * can never become verified — it occupies the domain permanently.
 *
 * Under a bare unique constraint the real employer at fatishcakes.com then:
 *   * cannot CREATE — the index rejects them, and
 *   * cannot JOIN — `joinOrganizationAction` refuses any org that isn't
 *     verified.
 * They are locked out with no path forward, which is worse than the duplicate
 * this was meant to prevent. It also makes domain squatting trivial: one free
 * mailbox permanently denies registration to any domain you can name.
 *
 * THE RULE, therefore: verification is what establishes a claim on a domain
 * (that is what 0027/0028 exist for), so only a VERIFIED org owns one. An
 * unverified org owns nothing and must not block anybody.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const DOMAIN = `dupdomain-${randomUUID().slice(0, 8)}.example`;
const createdOrgs: string[] = [];
const createdUsers: string[] = [];

async function makeOrg(name: string, domain: string, verified: boolean, createdBy: string) {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name, domain, created_by: createdBy, verified })
    .select("id")
    .single();
  if (data) createdOrgs.push(data.id);
  return { id: data?.id, error };
}

let ownerA: string;
let ownerB: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([createTestUser("dupdom-a"), createTestUser("dupdom-b")]);
  ownerA = a.id;
  ownerB = b.id;
  createdUsers.push(a.id, b.id);
});

  // deleteTestOrgs, not a bare org delete: job_postings.organization_id is
  // NO ACTION, so the bare version is refused and reports it only in `error`.
afterAll(async () => {
  await deleteTestOrgs(createdOrgs);
  await deleteTestUsers(createdUsers);
}, 60_000);

describe("a verified organisation owns its domain", () => {
  it("a second VERIFIED org at the same domain is rejected", async () => {
    const first = await makeOrg("Acme One", DOMAIN, true, ownerA);
    expect(first.error, "the first verified org should be created normally").toBeNull();

    const second = await makeOrg("Acme Two", DOMAIN, true, ownerB);
    expect(
      second.error,
      "SPLIT COMPANY: two verified orgs share one domain, so colleagues land in disconnected companies",
    ).not.toBeNull();
    expect(second.error?.code, "should be a unique violation").toBe("23505");
  });
});

describe("an unverified organisation owns nothing", () => {
  const SQUATTED = `squatted-${randomUUID().slice(0, 8)}.example`;

  it("an unverified org does NOT block the real employer from registering", async () => {
    /*
     * The anti-squatting case, modelled on the real production row: a consumer
     * mailbox claimed a company domain, so the org is permanently unverifiable.
     * It must not be able to lock the actual company out.
     */
    const squatter = await makeOrg("Squatter Co", SQUATTED, false, ownerA);
    expect(squatter.error).toBeNull();

    const realEmployer = await makeOrg("Real Co", SQUATTED, true, ownerB);
    expect(
      realEmployer.error,
      "DOMAIN SQUATTING: an unverifiable org blocked the genuine employer from registering",
    ).toBeNull();
  });

  it("two unverified orgs at one domain are allowed", async () => {
    // Neither has a claim, so there is nothing to arbitrate. Constraining this
    // would only re-create the lock-out above.
    const d = `both-unverified-${randomUUID().slice(0, 8)}.example`;
    expect((await makeOrg("U One", d, false, ownerA)).error).toBeNull();
    expect((await makeOrg("U Two", d, false, ownerB)).error).toBeNull();
  });
});

describe("the constraint is scoped, not global", () => {
  it("organisations with no domain are unconstrained", async () => {
    // `domain` is nullable and plenty of orgs will never claim one.
    expect((await makeOrg("No Domain A", null as unknown as string, true, ownerA)).error).toBeNull();
    expect((await makeOrg("No Domain B", null as unknown as string, true, ownerB)).error).toBeNull();
  });

  it("different domains are unaffected", async () => {
    const d1 = `alpha-${randomUUID().slice(0, 8)}.example`;
    const d2 = `beta-${randomUUID().slice(0, 8)}.example`;
    expect((await makeOrg("Alpha", d1, true, ownerA)).error).toBeNull();
    expect((await makeOrg("Beta", d2, true, ownerB)).error).toBeNull();
  });
});
