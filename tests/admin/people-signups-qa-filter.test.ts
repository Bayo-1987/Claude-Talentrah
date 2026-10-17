/**
 * /admin/people/signups must not list or count the owner's QA and test accounts (SIGNUPS-LIST-QA-FILTER).
 *
 * The rule is `isQaAccount` (src/lib/profile/qa-account.ts, the TypeScript twin of public.is_qa_account, migrations 0240 and 0251). The list shows "N people, page X of Y", so the
 * exclusion has to happen in the QUERY, before paging: filtering the fetched page afterwards would leave the total, the page count and the page contents all wrong. That is
 * why this runs against the real database (the local stack, or CI's): the recording fake in people-query-composition.test.ts can prove the calls were made, not that Postgres
 * answers correctly.
 *
 * ONE dataset, used by every test: the accounts below are real profile rows (UNPOOLED auth users with the fields set directly), QA and real ones mixed, with created_at set to
 * known minutes in the year 2031 so the date filter scopes the list to exactly these rows and the order is known. There are more real accounts than one page holds, with QA
 * accounts spread through the whole range, so a page that is filtered afterwards, or a total that still counts QA rows, cannot pass.
 *
 * NO POOL. The shared test pool (tests/support/auth.ts, POOL_MAX_SIZE 40) is for the many small files that need one user each; this file needs 68. Leasing them through
 * createTestUser would hold every pool row for the whole file and starve tests/support/test-user-pool.test.ts, which claims rows directly and expects them back. So each row is an
 * auth user made with admin.auth.admin.createUser (five at a time), on the same @talentrah.test domain the other unpooled fixtures use, and a test below asserts this file leases
 * nothing from the pool.
 *
 * IF A HOOK CRASHES. tests/support/global-teardown.ts sweeps AUTH accounts whose email ends in @talentrah.test and that are older than two hours (SWEEP_STALE_AFTER_MS), and it
 * reads the auth email, not the profile's. Every row here has an auth email of signups-qa-<tag>-<n>@talentrah.test whatever its profile email says, so rows left by a crash,
 * including ones carrying the owner's bare mailbox or a +qa- address on their PROFILE, are removed by the sweep. afterAll also resets each profile to an ordinary address
 * before deleting, so nothing pinned survives a hook that is only half done.
 *
 * THREE-WAY PARITY: for every case the TypeScript rule, public.is_qa_account (called through the service-role client) and the list filter must agree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, deleteTestUsers } from "../support/auth";
import { RUN_TAG } from "../support/list-users";
import { isQaAccount } from "@/lib/profile/qa-account";
import { listSignups, countSignupsSince } from "@/lib/admin/people/queries";
import { PAGE_SIZE } from "@/lib/admin/people/signups";

const T = randomUUID().slice(0, 8);

interface Case {
  label: string;
  email: string;
  first?: string | null;
  last?: string | null;
  leaderboard?: string | null;
  /** Cannot be stored: profiles_names_have_visible_characters refuses a blank first or last name. Checked as a pure function (TypeScript against SQL) only. */
  notStorable?: boolean;
}

/** The pinned cases of 0240/0251's own self-check and tests/profile/qa-account.test.ts, with a tag in each address so every row is distinct. */
const CASES: Case[] = [
  // QA by email
  { label: "+qa- in the email", email: `hello+qa-seeker-${T}@talentrah.com` },
  { label: "+QA- in the email, any case", email: `hello+QA-Employer-${T}@talentrah.com` },
  { label: "the owner's plus-address", email: `stonebridgehibr1+${T}@gmail.com` },
  { label: "the owner's plus-address, mixed case", email: `StoneBridgeHibr1+${T}b@GMAIL.COM` },
  { label: "the owner's plus-address, spaces around it", email: `  stonebridgehibr1+${T}c@gmail.com  ` },
  { label: "the owner's plus-address with a name Amara Test", email: `stonebridgehibr1+${T}d@gmail.com`, first: "Amara", last: "Test" },
  // QA by name
  { label: "first QA, last Seeker", email: `qa-name-1-${T}@example.test`, first: "QA", last: "Seeker" },
  { label: "first 'QA Seeker'", email: `qa-name-2-${T}@example.test`, first: "QA Seeker" },
  { label: "first QA, no last", email: `qa-name-3-${T}@example.test`, first: "QA" },
  { label: "no first, last 'QA Seeker'", email: `qa-name-4-${T}@example.test`, last: "QA Seeker" },
  { label: "blank first, last 'QA Seeker'", email: `qa-name-5-${T}@example.test`, first: "  ", last: "QA Seeker", notStorable: true },
  { label: "first '  QA Tester  '", email: `qa-name-6-${T}@example.test`, first: "  QA Tester  " },
  { label: "leaderboard 'QA Tester'", email: `qa-name-7-${T}@example.test`, leaderboard: "QA Tester" },
  { label: "leaderboard 'QA Tester\\t' (still starts with 'QA ')", email: `qa-name-8-${T}@example.test`, leaderboard: "QA Tester\t" },
  // NOT QA: the bare mailbox and look-alike addresses
  { label: "the owner's BARE mailbox (a real account)", email: "stonebridgehibr1@gmail.com" },
  { label: "empty tag", email: "stonebridgehibr1+@gmail.com" },
  { label: "stonebridgehibr12", email: `stonebridgehibr12+${T}@gmail.com` },
  { label: "xstonebridgehibr1", email: `xstonebridgehibr1+${T}@gmail.com` },
  { label: "stonebridge.hibr1", email: `stonebridge.hibr1+${T}@gmail.com` },
  { label: "googlemail.com", email: `stonebridgehibr1+${T}@googlemail.com` },
  { label: "gmail.co", email: `stonebridgehibr1+${T}@gmail.co` },
  { label: "gmail.com.evil.test", email: `stonebridgehibr1+${T}@gmail.com.evil.test` },
  { label: "evilgmail.com", email: `stonebridgehibr1+${T}@evilgmail.com` },
  { label: "another mailbox's plus-address", email: `someone+${T}@gmail.com` },
  { label: "+qa without the hyphen", email: `real+qa${T}@example.com` },
  // NOT QA: names
  { label: "Ada Lovelace", email: `ada-${T}@example.com`, first: "Ada", last: "Lovelace" },
  { label: "Qasim", email: `qasim-${T}@example.com`, first: "Qasim", last: "Khan" },
  { label: "Qa Hoang", email: `qa-hoang-${T}@example.com`, first: "Qa", last: "Hoang" },
  { label: "QAnon", email: `qanon-${T}@example.com`, first: "QAnon" },
  { label: "QA as a surname", email: `ada-qa-${T}@example.com`, first: "Ada", last: "QA" },
  { label: "Ada, last 'QA Seeker' (full name is Ada QA Seeker)", email: `ada-qa2-${T}@example.com`, first: "Ada", last: "QA Seeker" },
  { label: "QA-Team", email: `qa-team-${T}@example.com`, first: "QA-Team" },
  { label: "tab before QA (not trimmed)", email: `tab-1-${T}@example.com`, first: "\tQA", last: "Seeker" },
  { label: "tab before QA in the last name", email: `tab-2-${T}@example.com`, last: "\tQA Seeker" },
  { label: "leaderboard 'QA\\t' (not a QA name)", email: `tab-3-${T}@example.com`, leaderboard: "QA\t" },
  { label: "no names at all", email: `nobody-${T}@example.com` },
];

/** Real accounts to make more than one page of them, and extra QA accounts so QA rows sit in every part of the range. */
const FILLER_REAL = 29;
const FILLER_QA = 4;

interface Row extends Case {
  id: string;
  createdAt: string;
  qa: boolean;
}

const rows: Row[] = [];
/** Every auth user this file created, recorded the moment it exists (before its profile is set), so afterAll removes it even if the fixture stops half way. */
const createdIds: string[] = [];
/** How many pool rows this file's own run tag holds: read before the fixture and after it is built (see the last test of the first describe). */
const poolLeases = { before: -1, after: -1 };
/** The auth email domain the global sweep keys on (tests/support/fixture-accounts.ts TEST_ACCOUNT_DOMAIN). */
const AUTH_DOMAIN = "@talentrah.test";
const CONCURRENCY = 5;
const FROM = "2031-03-01";
const TO = "2031-03-02";
const BASE = Date.parse("2031-03-01T00:00:00.000Z");

const fieldsOf = (c: Case) => ({ email: c.email, firstName: c.first ?? null, lastName: c.last ?? null, leaderboardName: c.leaderboard ?? null });

async function sqlSaysQa(c: Case): Promise<boolean> {
  const { data, error } = await admin.rpc("is_qa_account" as never, { p_email: c.email, p_first: c.first ?? null, p_last: c.last ?? null, p_display: c.leaderboard ?? null } as never);
  if (error) throw new Error(`is_qa_account: ${error.message}`);
  return data as unknown as boolean;
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the results in order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i], i);
  });
  await Promise.all(workers);
  return results;
}

/** An unpooled auth user, retried a few times ONLY when the auth API reports a rate limit. */
async function createUnpooledUser(email: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (!error && data.user) return data.user.id;
    if (attempt < 4 && error && /rate limit/i.test(error.message)) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    throw new Error(`createUser ${email}: ${error?.message ?? "no user returned"}`);
  }
}

async function leasedByThisRun(): Promise<number> {
  const { count, error } = await admin.from("test_user_pool").select("user_id", { count: "exact", head: true }).eq("leased_by", RUN_TAG);
  if (error) throw new Error(`pool lease count: ${error.message}`);
  return count ?? 0;
}

beforeAll(async () => {
  poolLeases.before = await leasedByThisRun();
  const all: Case[] = [
    ...CASES.filter((c) => !c.notStorable),
    ...Array.from({ length: FILLER_REAL }, (_, i) => ({ label: `real filler ${i}`, email: `filler-real-${i}-${T}@example.com`, first: `Real${i}`, last: "Person" })),
    ...Array.from({ length: FILLER_QA }, (_, i) => ({ label: `QA filler ${i}`, email: `filler-qa-${i}-${T}@example.com`, first: "QA", last: `Filler${i}` })),
  ];
  // A fixed shuffle (the same every run) so QA rows are spread through the whole range instead of sitting together.
  const order = all.map((c, i) => ({ c, k: (i * 37) % all.length }));
  order.sort((a, b) => a.k - b.k || 0);
  const built = await mapLimit(order, CONCURRENCY, async ({ c }, i) => {
    // The AUTH email is what the global sweep keys on; the PROFILE email (set below) is what the list shows and the rule reads.
    const id = await createUnpooledUser(`signups-qa-${T}-${i}${AUTH_DOMAIN}`);
    createdIds.push(id);
    const createdAt = new Date(BASE + i * 60_000).toISOString();
    const { error } = await admin
      .from("profiles")
      .update({ email: c.email, first_name: c.first ?? null, last_name: c.last ?? null, referral_leaderboard_display_name: c.leaderboard ?? null, created_at: createdAt })
      .eq("id", id);
    if (error) throw new Error(`fixture ${c.label}: ${error.message}`);
    return { ...c, id, createdAt, qa: isQaAccount(fieldsOf(c)) } satisfies Row;
  });
  rows.push(...built);
  poolLeases.after = await leasedByThisRun();
}, 240_000);

afterAll(async () => {
  // First move every profile back to an ordinary address on the test-account domain, so that neither the owner's bare mailbox nor a +qa- address can sit on a row that
  // survives this hook; only then delete the users. A failed delete is left to the global sweep (see the header), which is why it is reported, not thrown.
  await mapLimit(createdIds, CONCURRENCY, (id) =>
    Promise.resolve(
      admin
        .from("profiles")
        .update({ email: `signups-qa-clean-${id}${AUTH_DOMAIN}`, first_name: null, last_name: null, referral_leaderboard_display_name: null, created_at: new Date().toISOString() })
        .eq("id", id),
    ).then(() => undefined),
  );
  await deleteTestUsers(createdIds);
}, 240_000);

const expectedReal = () => rows.filter((r) => !r.qa).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

async function wholeList() {
  const page1 = await listSignups({ page: 1, from: FROM, to: TO });
  const pages = [page1];
  for (let p = 2; p <= page1.pageCount; p++) pages.push(await listSignups({ page: p, from: FROM, to: TO }));
  return pages;
}

describe("the dataset is what the tests think it is", () => {
  it("has more real accounts than one page, and at least one QA account", () => {
    expect(
      expectedReal().length,
      `there must be MORE real accounts than one page (${PAGE_SIZE}), or page 2 and the total cannot show that QA rows leave no holes: a smaller page size or fewer cases fails here, not silently`,
    ).toBeGreaterThan(PAGE_SIZE);
    expect(
      rows.filter((r) => r.qa).length,
      "there must be QA accounts in the dataset, or every exclusion assertion below passes without excluding anything",
    ).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(CASES.filter((c) => !c.notStorable).length + FILLER_REAL + FILLER_QA);
  });

  it("leases no rows from the shared test pool, and none of its users is a pool row", async () => {
    // Counted for THIS file's own run tag, not the whole pool: other files lease and release rows at the same moment (and test-user-pool.test.ts does nothing else), so a
    // pool-wide count would differ between two reads for reasons that have nothing to do with this file.
    expect(poolLeases.before, "the pool lease count was not read before the fixture").toBeGreaterThanOrEqual(0);
    expect(poolLeases.after, "this file leased pool rows while building its fixture").toBe(poolLeases.before);
    const { data, error } = await admin.from("test_user_pool").select("user_id").in("user_id", createdIds);
    if (error) throw new Error(`pool membership: ${error.message}`);
    expect(data ?? [], "some of this file's users are rows of the shared pool").toEqual([]);
  });
});

describe("three-way parity: the TypeScript rule, public.is_qa_account and the list filter agree on every case", () => {
  it("TypeScript and SQL agree on every case", async () => {
    const disagreements: string[] = [];
    for (const c of CASES) {
      const ts = isQaAccount(fieldsOf(c));
      const sql = await sqlSaysQa(c);
      if (ts !== sql) disagreements.push(`${c.label}: TypeScript ${ts}, SQL ${sql}`);
    }
    expect(disagreements).toEqual([]);
  });

  it("the list shows exactly the accounts the rule does not call QA (every case, by id)", async () => {
    const pages = await wholeList();
    const listed = new Set(pages.flatMap((p) => p.rows.map((r) => r.id)));
    const wrong: string[] = [];
    for (const r of rows) {
      if (r.qa && listed.has(r.id)) wrong.push(`QA account listed: ${r.label} (${r.email})`);
      if (!r.qa && !listed.has(r.id)) wrong.push(`real account missing: ${r.label} (${r.email})`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the list, the total and the pages", () => {
  it("counts only real accounts in the total and the page count", async () => {
    const page1 = await listSignups({ page: 1, from: FROM, to: TO });
    const real = expectedReal();
    expect(page1.total).toBe(real.length);
    expect(page1.pageCount).toBe(Math.ceil(real.length / PAGE_SIZE));
  });

  it("page 1 is the newest real accounts, full; page 2 is the next real accounts, with no holes where QA rows were", async () => {
    const real = expectedReal();
    const p1 = await listSignups({ page: 1, from: FROM, to: TO });
    const p2 = await listSignups({ page: 2, from: FROM, to: TO });
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.rows.map((r) => r.id)).toEqual(real.slice(0, PAGE_SIZE).map((r) => r.id));
    expect(p2.rows.map((r) => r.id)).toEqual(real.slice(PAGE_SIZE, PAGE_SIZE * 2).map((r) => r.id));
    expect(p2.rows.length).toBe(real.length - PAGE_SIZE);
  });

  it("a real account's row is unchanged: id, email, name, newest-first order", async () => {
    const ada = rows.find((r) => r.label === "Ada Lovelace")!;
    const all = (await wholeList()).flatMap((p) => p.rows);
    const row = all.find((r) => r.id === ada.id)!;
    expect(row.email).toBe(ada.email);
    expect(row.name).toBe("Ada Lovelace");
    const times = all.map((r) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("the other filters still compose with it: an email search finds a real account and never a QA one", async () => {
    const ada = rows.find((r) => r.label === "Ada Lovelace")!;
    const found = await listSignups({ page: 1, from: FROM, to: TO, email: `ada-${T}@` });
    expect(found.rows.map((r) => r.id)).toEqual([ada.id]);
    expect(found.total).toBe(1);

    const qaSearch = await listSignups({ page: 1, from: FROM, to: TO, email: `hello+qa-seeker-${T}` });
    expect(qaSearch.rows).toEqual([]);
    expect(qaSearch.total).toBe(0);
  });
});

describe("the new-signups counter", () => {
  it("counts only real accounts", async () => {
    const n = await countSignupsSince("2031-02-28T23:59:59.000Z");
    expect(n).toBe(expectedReal().length);
  });

  it("counts a real account that signed up after the moment and nothing for a QA one", async () => {
    // since = just before the newest real account: exactly that one is newer.
    const real = expectedReal();
    const since = new Date(Date.parse(real[0].createdAt) - 1000).toISOString();
    expect(await countSignupsSince(since)).toBe(1);
    // since = just before the newest QA account: if it is newer than every real one, nothing counts.
    const qa = rows.filter((r) => r.qa).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const afterAllReal = new Date(Date.parse(qa.createdAt) - 1000).toISOString();
    const expectedCount = real.filter((r) => r.createdAt > afterAllReal).length;
    expect(await countSignupsSince(afterAllReal)).toBe(expectedCount);
  });
});
