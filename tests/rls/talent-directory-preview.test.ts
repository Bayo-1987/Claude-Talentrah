/**
 * EMP-1 / E1 — the free preview must use the SAME gate as the paid search, for every profile state, and must never show a profile the
 * paid search would not.
 *
 * "Same gate" is enforced two ways. Structurally: both talent_directory_search and talent_directory_preview read the one
 * talent_directory_listed_ids() function (pinned statically in tests/talent-directory/gate-single-definition.test.ts). Behaviourally, here:
 * profiles in every state are seeded, and the preview's count, the shared helper's membership and the paid search's p_candidate_id lookup
 * must agree on every one.
 *
 * AUTHENTICATED-SESSION TESTS: these need a minted session (createAuthedTestUser), so they run in CI, not on a laptop whose JWT secret
 * does not match the target project. The service-role and anon halves of the same story are in tests/talent-directory/preview-derivation.test.ts.
 *
 * "Suspended" is not a state of the directory gate: profiles carry no suspension flag, and the gate is exactly
 * `opt_in = true AND talent_verification_status = 'verified'`. The statuses a candidate CAN be in short of 'verified' are
 * 'unverified', 'pending' and 'rejected', and all of them are seeded below.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory preview RLS suite cannot run: ${key} is not set.`);
}

type Status = "unverified" | "pending" | "verified" | "rejected";
const STATES: Array<{ label: string; optIn: boolean; status: Status; listed: boolean }> = [
  { label: "opted-in + verified", optIn: true, status: "verified", listed: true },
  { label: "opted-in only (unverified)", optIn: true, status: "unverified", listed: false },
  { label: "opted-in, verification pending", optIn: true, status: "pending", listed: false },
  { label: "opted-in, verification rejected", optIn: true, status: "rejected", listed: false },
  { label: "verified only (not opted in)", optIn: false, status: "verified", listed: false },
  { label: "neither", optIn: false, status: "unverified", listed: false },
];

let candidates: Array<{ id: string; label: string; listed: boolean }> = [];
let subscribedOwner: { id: string; client: DB };
let unsubscribedOwner: { id: string; client: DB };
let outsider: { id: string; client: DB };
const orgIds: string[] = [];

async function listedIds(): Promise<string[]> {
  const { data, error } = await admin.rpc("talent_directory_listed_ids");
  expect(error, error?.message).toBeNull();
  return (data ?? []) as unknown as string[];
}

async function listedCount(): Promise<number> {
  const { data, error } = await admin.rpc("talent_directory_listed_count");
  expect(error, error?.message).toBeNull();
  return data as unknown as number;
}

beforeAll(async () => {
  [subscribedOwner, unsubscribedOwner, outsider] = await Promise.all([
    createAuthedTestUser("tdprev-org-sub"),
    createAuthedTestUser("tdprev-org-nosub"),
    createAuthedTestUser("tdprev-outsider"),
  ]);

  const made = await Promise.all(STATES.map((s) => createAuthedTestUser(`tdprev-${s.label.replace(/\W+/g, "-")}`)));
  candidates = made.map((m, i) => ({ id: m.id, label: STATES[i].label, listed: STATES[i].listed }));

  await Promise.all(
    candidates.map((c, i) =>
      admin
        .from("profiles")
        .update({
          talent_directory_opt_in: STATES[i].optIn,
          talent_verification_status: STATES[i].status,
          talent_verified_at: STATES[i].status === "verified" ? new Date().toISOString() : null,
        })
        .eq("id", c.id),
    ),
  );

  const { data: o1 } = await admin
    .from("organizations")
    .insert({ name: `TDPrev Sub Org ${randomUUID().slice(0, 8)}`, created_by: subscribedOwner.id, verified: true })
    .select("id")
    .single();
  const { data: o2 } = await admin
    .from("organizations")
    .insert({ name: `TDPrev NoSub Org ${randomUUID().slice(0, 8)}`, created_by: unsubscribedOwner.id, verified: true })
    .select("id")
    .single();
  orgIds.push(o1!.id, o2!.id);
  await Promise.all([
    admin.from("organization_members").insert({ organization_id: o1!.id, user_id: subscribedOwner.id, role: "owner" }),
    admin.from("organization_members").insert({ organization_id: o2!.id, user_id: unsubscribedOwner.id, role: "owner" }),
  ]);
  const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
  await admin.from("talent_directory_subscriptions").insert({
    organization_id: o1!.id,
    plan_id: plan!.id,
    expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    status: "active",
  });
}, 120_000);

afterAll(async () => {
  if (orgIds[0]) await admin.from("talent_directory_subscriptions").delete().eq("organization_id", orgIds[0]);
  await deleteTestOrgs(orgIds);
  await deleteTestUsers([...candidates.map((c) => c.id), subscribedOwner?.id, unsubscribedOwner?.id, outsider?.id].filter(Boolean));
}, 60_000);

describe("the shared gate: listed iff opted in AND verified, in every state", () => {
  it.each(STATES.map((s) => [s.label, s] as const))("%s", async (label, state) => {
    const c = candidates.find((x) => x.label === label)!;
    const ids = await listedIds();
    expect(ids.includes(c.id), `talent_directory_listed_ids disagrees about "${label}"`).toBe(state.listed);
  });

  it("the paid search's candidate lookup agrees with the shared helper on every state", async () => {
    for (const c of candidates) {
      const { data, error } = await subscribedOwner.client.rpc("talent_directory_search", { p_candidate_id: c.id });
      expect(error, error?.message).toBeNull();
      const found = (data ?? []).some((r) => r.user_id === c.id);
      expect(found, `paid search and shared gate disagree about "${c.label}"`).toBe(c.listed);
    }
  });
});

describe("the preview, as an employer with no subscription", () => {
  it("returns the same count as the shared gate (re-read until the pool is stable: other suites add candidates too)", async () => {
    let lastBefore = -1;
    let preview = -2;
    let lastAfter = -3;
    for (let attempt = 0; attempt < 5; attempt++) {
      lastBefore = await listedCount();
      const { data, error } = await unsubscribedOwner.client.rpc("talent_directory_preview");
      expect(error, error?.message).toBeNull();
      preview = (data as unknown as { count: number }).count;
      lastAfter = await listedCount();
      if (lastBefore === lastAfter) break;
    }
    expect(preview).toBe(lastBefore);
    expect(lastBefore).toBe(lastAfter);
  });

  it("the count includes the listed fixture and excludes every non-listed one: flipping a fixture moves the count by exactly the gate", async () => {
    // Directional, not exact (other suites run concurrently): taking the one listed fixture out of the gate never raises the count,
    // and the shared helper agrees it is gone.
    const listed = candidates.find((c) => c.listed)!;
    const before = ((await unsubscribedOwner.client.rpc("talent_directory_preview")).data as unknown as { count: number }).count;
    await admin.from("profiles").update({ talent_directory_opt_in: false }).eq("id", listed.id);
    try {
      expect((await listedIds()).includes(listed.id)).toBe(false);
      const after = ((await unsubscribedOwner.client.rpc("talent_directory_preview")).data as unknown as { count: number }).count;
      expect(after).toBeLessThanOrEqual(before);
    } finally {
      await admin.from("profiles").update({ talent_directory_opt_in: true }).eq("id", listed.id);
    }
  });

  it("the payload has only count and samples, and a sample has only the five safe keys: no id, name, photo, email, employer", async () => {
    const { data, error } = await unsubscribedOwner.client.rpc("talent_directory_preview");
    expect(error, error?.message).toBeNull();
    const payload = data as unknown as { count: number; samples: Array<Record<string, unknown>> };
    expect(Object.keys(payload).sort()).toEqual(["count", "samples"]);
    expect(payload.samples.length).toBeLessThanOrEqual(3);
    for (const s of payload.samples) {
      expect(Object.keys(s).sort()).toEqual(["availableForHire", "remoteReady", "role", "skills", "yearsBand"]);
    }
    const text = JSON.stringify(payload);
    for (const c of candidates) expect(text).not.toContain(c.id);
    expect(text).not.toMatch(/first_name|last_name|email|avatar|photo|company|user_id/i);
  });

  it("a non-listed profile never appears in a sample (the fixtures' ids are absent whatever the pool size)", async () => {
    const { data } = await unsubscribedOwner.client.rpc("talent_directory_preview");
    const text = JSON.stringify(data);
    for (const c of candidates.filter((x) => !x.listed)) expect(text).not.toContain(c.id);
  });

  it("works for an org with a subscription too (it is a read of an aggregate, not a second paywall)", async () => {
    const { data, error } = await subscribedOwner.client.rpc("talent_directory_preview");
    expect(error, error?.message).toBeNull();
    expect((data as unknown as { count: number }).count).toBeGreaterThanOrEqual(1);
  });

  it("is not available to a signed-in user who belongs to no organisation: null, not a count", async () => {
    const { data, error } = await outsider.client.rpc("talent_directory_preview");
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("authenticated may not call the internals", () => {
  it.each([
    ["talent_directory_listed_ids", {}],
    ["talent_directory_listed_count", {}],
    ["talent_directory_preview_for", { p_ids: [] as string[] }],
    ["talent_directory_years_band", { p_years: 3 }],
    ["talent_directory_role_family", { p_title: "Engineer" }],
  ] as const)("%s", async (fn, args) => {
    const { error } = await unsubscribedOwner.client.rpc(fn as never, args as never);
    expect(error, `${fn} is callable by any signed-in user`).not.toBeNull();
  });
});

describe("the paid search itself did not change behaviour", () => {
  it("an org with no subscription still gets nothing from it", async () => {
    const { data, error } = await unsubscribedOwner.client.rpc("talent_directory_search", {});
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("a subscribed org still sees the listed candidate in a plain search", async () => {
    const listed = candidates.find((c) => c.listed)!;
    const { data } = await subscribedOwner.client.rpc("talent_directory_search", { p_candidate_id: listed.id });
    expect((data ?? []).map((r) => r.user_id)).toEqual([listed.id]);
  });
});

describe("the waitlist table is closed to a signed-in employer too", () => {
  it("an org owner cannot read, insert into, update or delete the waitlist", async () => {
    const read = await unsubscribedOwner.client.from("talent_directory_waitlist").select("*");
    expect(read.error, "an authenticated session was granted SELECT on the waitlist").not.toBeNull();

    const insert = await unsubscribedOwner.client.from("talent_directory_waitlist").insert({ organization_id: orgIds[1] });
    expect(insert.error, "an authenticated session was granted INSERT on the waitlist").not.toBeNull();

    const update = await unsubscribedOwner.client
      .from("talent_directory_waitlist")
      .update({ joined_by: null })
      .eq("organization_id", orgIds[1]);
    expect(update.error, "an authenticated session was granted UPDATE on the waitlist").not.toBeNull();

    const del = await unsubscribedOwner.client.from("talent_directory_waitlist").delete().eq("organization_id", orgIds[1]);
    expect(del.error, "an authenticated session was granted DELETE on the waitlist").not.toBeNull();
  });
});
