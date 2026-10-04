/**
 * The signed-in user's own details on the mentorship apply page are read on the server, for that user's own row (src/lib/mentorship/queries.ts).
 *
 * This runs the REAL read functions and the real save action against a real database, with the session mocked to a real RLS-honouring client the same way
 * tests/mentorship/mentor-profile-display-name-action.test.ts does it. Only the Paystack calls are stubbed. It covers: a mentor reading their own details, a mentor
 * saving and reading them back, a note shown only for a rejected or suspended application, another signed-in user (or no session) asking and getting nothing, and the
 * applicant states the page loads for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`own-profile-details-read suite cannot run: ${key} is not set.`);
}

const current = vi.hoisted(() => ({ id: null as string | null }));
const sessionClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sessionClient.current }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ user: { id: current.id } }),
  getOptionalUser: async () => (current.id ? { user: { id: current.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/paystack/client", () => ({
  listNigerianBanks: async () => [],
  isDecline: () => false,
  resolveAccountNumber: async () => ({ account_name: "RESOLVED NAME" }),
  createTransferRecipient: async () => ({ recipient_code: "RCP_own_details_read_test" }),
}));

const { sessionFor } = await import("../support/auth");
const { getOwnPayoutDetails, getOwnMentorProfile } = await import("@/lib/mentorship/queries");
const { saveMentorPayoutDetailsAction } = await import("@/lib/mentorship/payout-details");

const tag = randomUUID().replace(/-/g, "").slice(0, 10);
let approved: { id: string; email: string };
let rejected: { id: string; email: string };
let pending: { id: string; email: string };
let suspended: { id: string; email: string };
let other: { id: string; email: string };

async function signOut() {
  current.id = null;
  sessionClient.current = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signInAs(user: { id: string; email: string }) {
  current.id = user.id;
  sessionClient.current = await sessionFor(user.email, user.id);
}

beforeAll(async () => {
  [approved, rejected, pending, suspended, other] = await Promise.all([
    createTestUser(`opr-approved-${tag}`),
    createTestUser(`opr-rejected-${tag}`),
    createTestUser(`opr-pending-${tag}`),
    createTestUser(`opr-suspended-${tag}`),
    createTestUser(`opr-other-${tag}`),
  ]);
  const rows = [
    { user_id: approved.id, status: "approved", base_price_ngn: 12_345, display_name: "Own Details Approved", payout_bank_code: "058", payout_account_number: "0123456789", payout_account_name: "Test Mentor", payout_recipient_code: "RCP_fixture", payout_bank_verified_at: new Date().toISOString(), review_note: "note on approval" },
    { user_id: rejected.id, status: "rejected", display_name: "Own Details Rejected", review_note: "Please add detail" },
    { user_id: pending.id, status: "pending", display_name: "Own Details Pending", review_note: "pending note" },
    { user_id: suspended.id, status: "suspended", display_name: "Own Details Suspended", review_note: "Suspended for review" },
  ];
  const { error } = await admin.from("mentor_profiles").upsert(rows, { onConflict: "user_id" });
  if (error) throw new Error(`fixture mentor rows: ${error.message}`);
}, 90_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().in("user_id", [approved.id, rejected.id, pending.id, suspended.id]);
  await deleteTestUsers([approved.id, rejected.id, pending.id, suspended.id, other.id]);
}, 60_000);

describe("own details", () => {
  it("a mentor reads their own details", async () => {
    await signInAs(approved);
    expect(await getOwnPayoutDetails(approved.id)).toEqual({ bankCode: "058", accountNumber: "0123456789", accountName: "Test Mentor", verifiedAt: expect.anything() });
  });

  it("a mentor saves details through the real action and reads them back", async () => {
    await signInAs(approved);
    const fd = new FormData();
    fd.set("bankCode", "044");
    fd.set("accountNumber", "0987654321");
    const res = await saveMentorPayoutDetailsAction({ status: "idle", message: "" }, fd);
    expect(res.status, res.message).toBe("success");
    expect(await getOwnPayoutDetails(approved.id)).toMatchObject({ bankCode: "044", accountNumber: "0987654321", accountName: "RESOLVED NAME" });
  });

  it("another signed-in user gets nothing, whichever id they ask for", async () => {
    await signInAs(other);
    expect(await getOwnPayoutDetails(approved.id)).toBeNull();
    expect(await getOwnPayoutDetails(other.id)).toBeNull();
  });
});

describe("own application page data and the reviewer note", () => {
  it("a rejected applicant sees the reviewer's note", async () => {
    await signInAs(rejected);
    expect(await getOwnMentorProfile(rejected.id)).toMatchObject({ status: "rejected", displayName: "Own Details Rejected", reviewNote: "Please add detail" });
  });

  it("a suspended mentor sees the note on their own page", async () => {
    await signInAs(suspended);
    expect(await getOwnMentorProfile(suspended.id)).toMatchObject({ status: "suspended", reviewNote: "Suspended for review" });
  });

  it("a pending applicant gets no note (even if a row carries one) and a user with no application loads without error", async () => {
    await signInAs(pending);
    expect(await getOwnMentorProfile(pending.id)).toMatchObject({ status: "pending", reviewNote: null });
    await signInAs(other);
    expect(await getOwnMentorProfile(other.id)).toBeNull();
  });

  it("an approved mentor's profile loads and does not carry a note", async () => {
    await signInAs(approved);
    expect(await getOwnMentorProfile(approved.id)).toMatchObject({ status: "approved", displayName: "Own Details Approved", reviewNote: null });
  });

  it("another user cannot read someone else's note through the own-profile reader", async () => {
    await signInAs(other);
    expect(await getOwnMentorProfile(rejected.id)).toBeNull();
  });
});

describe("no session, and an id that is not the session's", () => {
  it("with no session, the own-details reader returns null for any id", async () => {
    await signOut();
    expect(await getOwnPayoutDetails(approved.id)).toBeNull();
    expect(await getOwnPayoutDetails(rejected.id)).toBeNull();
  });

  it("with no session, the own-profile reader returns no data and no note (it may return null or refuse the read; either way nothing comes back)", async () => {
    await signOut();
    const profile = await getOwnMentorProfile(rejected.id).catch(() => null);
    expect(profile).toBeNull();
  });

  it("a signed-in user passing a different user's id gets null from both readers", async () => {
    await signInAs(other);
    expect(await getOwnPayoutDetails(approved.id)).toBeNull();
    expect(await getOwnPayoutDetails(rejected.id)).toBeNull();
    expect((await getOwnMentorProfile(rejected.id).catch(() => null))?.reviewNote ?? null).toBeNull();
    expect((await getOwnMentorProfile(suspended.id).catch(() => null))?.reviewNote ?? null).toBeNull();
  });
});

describe("a user with no mentor row, the apply page, and the logged-out public landing", () => {
  it("a signed-in user with no mentor row: the own-details reader returns null and the apply page still renders", async () => {
    await signInAs(other);
    expect(await getOwnPayoutDetails(other.id)).toBeNull();
    expect(await getOwnMentorProfile(other.id)).toBeNull();
    const Page = (await import("@/app/(app)/mentorship/apply/page")).default;
    expect(await Page()).toBeTruthy();
  });

  it("the apply page renders for a pending, rejected, suspended and approved user", async () => {
    const Page = (await import("@/app/(app)/mentorship/apply/page")).default;
    for (const user of [pending, rejected, suspended, approved]) {
      await signInAs(user);
      expect(await Page(), `apply page for ${user.id}`).toBeTruthy();
    }
  });

  it("logged out: the public price range reaches the approved mentor's price, and /mentorship renders the public landing with it", async () => {
    await signOut();
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    const range = await getApprovedMentorPriceRangeNgn();
    // Other suites may create approved mentors at the same time, so assert containment of this file's fixture price, not an exact range.
    expect(range).not.toBeNull();
    expect(range!.minNgn).toBeLessThanOrEqual(12_345);
    expect(range!.maxNgn).toBeGreaterThanOrEqual(12_345);
    const Page = (await import("@/app/(app)/mentorship/(list)/page")).default;
    const { MentorshipPublicLanding } = await import("@/components/mentorship/public-landing");
    const el = (await Page({ searchParams: Promise.resolve({}) })) as { type: unknown; props: { priceRangeNgn: { minNgn: number; maxNgn: number } | null } };
    expect(el.type).toBe(MentorshipPublicLanding);
    expect(el.props.priceRangeNgn!.minNgn).toBeLessThanOrEqual(12_345);
    expect(el.props.priceRangeNgn!.maxNgn).toBeGreaterThanOrEqual(12_345);
  });
});

