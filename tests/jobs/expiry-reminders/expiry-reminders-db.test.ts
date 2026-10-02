/**
 * The closing reminder and the Extend link, against a REAL database (migration 0207).
 *
 * Service-role only: every call here goes through the functions the cron and the confirm page use. Nothing needs an
 * authenticated session, so unlike the RLS suites this runs against a hosted test project too. The authenticated half
 * of the grant check is expiry-reminders-grants.test.ts (CI-bound: sessions cannot be minted locally).
 *
 * TIME IS A PARAMETER. Listing, claiming and redeeming all take `p_now`, so every fixture below lives around a fixed
 * instant in 2030. That keeps these rows out of reach of the real expiry sweep (tests/jobs/expires-at.test.ts closes any
 * internal posting whose expires_at is in the real past) and makes "a minute either side of the window" exact.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../../support/auth";
import { deleteTestOrgs } from "../../support/cleanup";
import { runCleanups, mustDelete } from "../../support/teardown";
import { generateExtendToken } from "@/lib/jobs/expiry-reminders/token";
import { takesRowLockBeforeUpdating } from "./row-lock-check";

const T = new Date("2030-06-15T19:00:00.000Z"); // "now" for every call below
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offsetMs: number, from: Date = T) => new Date(from.getTime() + offsetMs).toISOString();

const jobIds: string[] = [];
let orgId = "";
let userId = "";

async function internalPosting(over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "EXPIRYREM Co",
      title: `EXPIRYREM Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting owned by tests/jobs/expiry-reminders.",
      structured_jd: {},
      status: "open",
      dedup_fingerprint: randomUUID(),
      ...over,
    })
    .select("id, expires_at, title")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  jobIds.push(data.id);
  return data;
}

async function externalPosting(over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "external",
      company_name: "EXPIRYREM Ext Co",
      title: `EXPIRYREM Ext Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture external posting owned by tests/jobs/expiry-reminders.",
      structured_jd: {},
      status: "open",
      dedup_fingerprint: randomUUID(),
      external_source: "expiryrem-test",
      external_url: `https://example.test/${randomUUID()}`,
      ...over,
    })
    .select("id, expires_at")
    .single();
  if (error || !data) throw new Error(`fixture external posting: ${error?.message}`);
  jobIds.push(data.id);
  return data;
}

async function due(now: Date = T, limit = 1000) {
  const { data, error } = await admin.rpc("due_job_expiry_reminders", { p_now: now.toISOString(), p_limit: limit });
  if (error) throw new Error(`due: ${error.message}`);
  return (data ?? []).map((r) => r.job_posting_id).filter((id) => jobIds.includes(id));
}

async function claim(jobId: string, hash = generateExtendToken().hash, now = T) {
  const { data, error } = await admin.rpc("claim_job_expiry_reminder", {
    p_job_posting_id: jobId,
    p_token_hash: hash,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`claim: ${error.message}`);
  return { rows: data ?? [], hash };
}

async function redeem(hash: string, now = T) {
  const { data, error } = await admin.rpc("redeem_job_expiry_extend_token", {
    p_token_hash: hash,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`redeem: ${error.message}`);
  return data![0];
}

async function rowOf(id: string) {
  const { data, error } = await admin.from("job_postings").select("expires_at, status").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data;
}

/** A posting + a CLAIMED, SENT reminder for it, closing at `offset` after T. Returns its raw hash. */
async function linkedPosting(offsetMs = 2 * DAY + 12 * HOUR, over: Record<string, unknown> = {}) {
  const job = await internalPosting({ expires_at: at(offsetMs), ...over });
  const { rows, hash } = await claim(job.id);
  if (rows.length !== 1) throw new Error("fixture claim failed");
  await admin.from("job_expiry_reminders").update({ sent_at: T.toISOString() }).eq("token_hash", hash);
  return { job, hash };
}

beforeAll(async () => {
  const user = await createTestUser("expiryrem");
  userId = user.id;
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ name: `EMPLOYER-TEST expiry-reminders ${randomUUID()}`, created_by: userId, verified: true })
    .select("id")
    .single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  orgId = org.id;
}, 60_000);

afterAll(async () => {
  await runCleanups(
    ["reminders", async () => {
      if (jobIds.length) await mustDelete("job_expiry_reminders", admin.from("job_expiry_reminders").delete().in("job_posting_id", jobIds));
    }],
    ["postings", async () => {
      if (jobIds.length) await mustDelete("job_postings", admin.from("job_postings").delete().in("id", jobIds));
    }],
    ["organisations", async () => {
      if (orgId) await deleteTestOrgs([orgId]);
    }],
    ["users", async () => {
      if (userId) await deleteTestUsers([userId]);
    }],
  );
}, 60_000);

describe("who is due: closes within the next 3 days, (now, now + 3d]", () => {
  it("lists exactly the eligible postings and nothing else", async () => {
    // Eligible: anywhere inside the window, including a job published with 2 days left and the inclusive upper edge.
    const e1 = await internalPosting({ expires_at: at(MIN) });
    const e2 = await internalPosting({ expires_at: at(DAY) });
    const e3 = await internalPosting({ expires_at: at(2 * DAY) });
    const e4 = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    const e5 = await internalPosting({ expires_at: at(3 * DAY) });

    // Not eligible: a minute past the upper edge, the exclusive lower edge itself, and anything already past.
    const tooEarly = await internalPosting({ expires_at: at(3 * DAY + MIN) });
    const farOff = await internalPosting({ expires_at: at(20 * DAY) });
    const atNow = await internalPosting({ expires_at: at(0) });
    const justPast = await internalPosting({ expires_at: at(-MIN) });
    const alreadyPast = await internalPosting({ expires_at: at(-HOUR) });

    // Not eligible: right date, wrong kind of posting.
    const noExpiry = await internalPosting({ expires_at: null });
    const external = await externalPosting({ expires_at: at(2 * DAY) });
    const closed = await internalPosting({ expires_at: at(2 * DAY), status: "closed" });
    const removed = await internalPosting({ expires_at: at(2 * DAY), status: "removed" });
    const draft = await internalPosting({ expires_at: at(2 * DAY), status: "draft" });

    const got = await due();
    expect(new Set(got)).toEqual(new Set([e1.id, e2.id, e3.id, e4.id, e5.id]));
    for (const row of [tooEarly, farOff, atNow, justPast, alreadyPast, noExpiry, external, closed, removed, draft]) {
      expect(got, `${row.id} must not be due`).not.toContain(row.id);
    }
  });

  it("a missed day catches up: a posting closing in 2.5 days is still reminded by a run a day later", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    // T is "yesterday's run" and never happened for this posting; the run a day later is T + 1d, 1.5 days before closing.
    const later = new Date(T.getTime() + DAY);
    expect(await due(later)).toContain(job.id);
    expect((await claim(job.id, undefined, later)).rows).toHaveLength(1);
  });

  it("a second run the same day sends nothing", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY) });
    const first = await claim(job.id);
    await admin.from("job_expiry_reminders").update({ sent_at: T.toISOString() }).eq("token_hash", first.hash);
    const laterSameDay = new Date(T.getTime() + 5 * HOUR);
    expect(await due(laterSameDay)).not.toContain(job.id);
    expect((await claim(job.id, undefined, laterSameDay)).rows).toHaveLength(0);
  });

  it("an extended posting gets a NEW reminder for its NEW closing date, once", async () => {
    const { job, hash } = await linkedPosting(2 * DAY);
    const oldClose = new Date(job.expires_at!).getTime();
    expect((await redeem(hash)).outcome).toBe("extended");
    const newClose = oldClose + 30 * DAY;
    expect(new Date((await rowOf(job.id)).expires_at!).getTime()).toBe(newClose);

    // Right after extending it is not due (28 days out) …
    expect(await due(T)).not.toContain(job.id);
    // … and when the new date comes within 3 days it is, once, with its own claim row.
    const near = new Date(newClose - 2 * DAY);
    expect(await due(near)).toContain(job.id);
    const second = await claim(job.id, undefined, near);
    expect(second.rows).toHaveLength(1);
    expect(new Date(second.rows[0].closes_at).getTime()).toBe(newClose);
    expect((await claim(job.id, undefined, near)).rows).toHaveLength(0);

    const { data } = await admin.from("job_expiry_reminders").select("closes_at").eq("job_posting_id", job.id);
    expect(data).toHaveLength(2); // the first reminder's row is kept, so the first date is never reminded twice either
  });

  it("an already-reminded closing date is not due again; an edited closing date is due once more", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY + 5 * HOUR) });
    expect(await due()).toContain(job.id);

    const { rows, hash } = await claim(job.id);
    expect(rows).toHaveLength(1);
    await admin.from("job_expiry_reminders").update({ sent_at: T.toISOString() }).eq("token_hash", hash);
    expect(await due()).not.toContain(job.id);

    // The employer moves the date: that is a different closing date, reminded once in its own right.
    await admin.from("job_postings").update({ expires_at: at(2 * DAY + 6 * HOUR) }).eq("id", job.id);
    expect(await due()).toContain(job.id);
  });

  it("a posting with NO closing date is never listed, claimed or changed (no backfill)", async () => {
    const job = await internalPosting({ expires_at: null });
    expect(await due()).not.toContain(job.id);
    expect((await claim(job.id)).rows).toHaveLength(0);
    expect((await rowOf(job.id)).expires_at).toBeNull();
  });
});

describe("claiming: exactly once", () => {
  it("the first claim wins and the second, on the same closing date, gets nothing", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY + 8 * HOUR) });
    const first = await claim(job.id);
    const second = await claim(job.id);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
    expect(await due()).not.toContain(job.id); // a live claim hides it from the listing too
  });

  it("many concurrent claims for one posting: exactly one wins", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY + 9 * HOUR) });
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(job.id)));
    expect(results.filter((r) => r.rows.length === 1)).toHaveLength(1);
    const { data } = await admin.from("job_expiry_reminders").select("id").eq("job_posting_id", job.id);
    expect(data).toHaveLength(1);
  });

  it("refuses to claim a posting that is not due (external, closed, out of window)", async () => {
    const external = await externalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    const closed = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR), status: "closed" });
    const far = await internalPosting({ expires_at: at(10 * DAY) });
    const past = await internalPosting({ expires_at: at(-HOUR) });
    for (const job of [external, closed, far, past]) {
      expect((await claim(job.id)).rows).toHaveLength(0);
    }
    const { data } = await admin
      .from("job_expiry_reminders")
      .select("id")
      .in("job_posting_id", [external.id, closed.id, far.id, past.id]);
    expect(data).toHaveLength(0);
  });

  it("an unsent claim older than 30 minutes is abandoned and can be taken over with a fresh token; a fresh one cannot", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY + 10 * HOUR) });
    const first = await claim(job.id);
    expect(first.rows).toHaveLength(1);

    // 29 minutes later: still live.
    expect((await claim(job.id, undefined, new Date(T.getTime() + 29 * MIN))).rows).toHaveLength(0);

    // 31 minutes later: abandoned. Taken over; the old hash no longer names anything.
    const later = new Date(T.getTime() + 31 * MIN);
    const retake = await claim(job.id, undefined, later);
    expect(retake.rows).toHaveLength(1);
    const { data } = await admin.from("job_expiry_reminders").select("token_hash").eq("job_posting_id", job.id);
    expect(data).toEqual([{ token_hash: retake.hash }]);
    expect(first.hash).not.toBe(retake.hash);
  });

  it("a SENT reminder is never taken over, however old", async () => {
    const job = await internalPosting({ expires_at: at(2 * DAY + 11 * HOUR) });
    const first = await claim(job.id);
    await admin.from("job_expiry_reminders").update({ sent_at: T.toISOString() }).eq("token_hash", first.hash);
    expect((await claim(job.id, undefined, new Date(T.getTime() + 2 * HOUR))).rows).toHaveLength(0);
  });
});

describe("the extend link", () => {
  it("extends by 30 days from the CURRENT closing date, once", async () => {
    const { job, hash } = await linkedPosting(2 * DAY + 12 * HOUR);
    const before = new Date(job.expires_at!).getTime();

    const out = await redeem(hash);
    expect(out.outcome).toBe("extended");
    expect(out.job_posting_id).toBe(job.id);
    expect(new Date(out.new_expires_at!).getTime()).toBe(before + 30 * DAY); // from the current date, not from "now"
    expect(new Date((await rowOf(job.id)).expires_at!).getTime()).toBe(before + 30 * DAY);

    // Second use: refused, the date does not move again, and the answer carries the CURRENT closing date and the title.
    const again = await redeem(hash);
    expect(again.outcome).toBe("used");
    expect(again.title).toBe(job.title);
    expect(new Date(again.new_expires_at!).getTime()).toBe(before + 30 * DAY);
    expect(new Date((await rowOf(job.id)).expires_at!).getTime()).toBe(before + 30 * DAY);
  });

  it("concurrent uses of one link: exactly one extends, and the date moves by 30 days once", async () => {
    const { job, hash } = await linkedPosting(2 * DAY + 13 * HOUR);
    const before = new Date(job.expires_at!).getTime();

    const outcomes = await Promise.all(Array.from({ length: 10 }, () => redeem(hash)));
    expect(outcomes.filter((o) => o.outcome === "extended")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "used")).toHaveLength(9);
    expect(new Date((await rowOf(job.id)).expires_at!).getTime()).toBe(before + 30 * DAY);
  });

  it("an expired link (the closing date has passed) does not extend", async () => {
    const { job, hash } = await linkedPosting(2 * DAY + 14 * HOUR);
    const before = (await rowOf(job.id)).expires_at;
    const out = await redeem(hash, new Date(new Date(before!).getTime() + 1000));
    expect(out.outcome).toBe("expired");
    expect((await rowOf(job.id)).expires_at).toBe(before);
  });

  it("a tampered or unknown token does not extend anything", async () => {
    const { job } = await linkedPosting(2 * DAY + 15 * HOUR);
    const before = (await rowOf(job.id)).expires_at;
    expect((await redeem(generateExtendToken().hash)).outcome).toBe("invalid");
    expect((await redeem("")).outcome).toBe("invalid");
    expect((await redeem("' or 1=1 --")).outcome).toBe("invalid");
    expect((await rowOf(job.id)).expires_at).toBe(before);
  });

  it("a link extends ITS posting only", async () => {
    const a = await linkedPosting(2 * DAY + 16 * HOUR);
    const b = await internalPosting({ expires_at: at(2 * DAY + 17 * HOUR) });
    const bBefore = (await rowOf(b.id)).expires_at;
    expect((await redeem(a.hash)).outcome).toBe("extended");
    expect((await rowOf(b.id)).expires_at).toBe(bBefore);
  });

  it.each(["closed", "removed", "draft"] as const)(
    "a posting that is %s by the time the link is used is not extended, says 'closed', and the link is NOT consumed",
    async (status) => {
      const { job, hash } = await linkedPosting(2 * DAY + 18 * HOUR);
      const before = (await rowOf(job.id)).expires_at;
      await admin.from("job_postings").update({ status }).eq("id", job.id);

      const out = await redeem(hash);
      expect(out.outcome).toBe("closed");
      expect((await rowOf(job.id)).expires_at).toBe(before);
      const { data } = await admin.from("job_expiry_reminders").select("used_at").eq("token_hash", hash).single();
      expect(data!.used_at).toBeNull();
    },
  );

  it("an EXTERNAL posting is never extended, even with a link forced into the table", async () => {
    const ext = await externalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    const { hash } = generateExtendToken();
    const { error } = await admin.from("job_expiry_reminders").insert({
      job_posting_id: ext.id,
      closes_at: ext.expires_at!,
      token_hash: hash,
      sent_at: T.toISOString(),
    });
    expect(error).toBeNull();

    const out = await redeem(hash);
    expect(out.outcome).toBe("no_closing_date");
    expect((await rowOf(ext.id)).expires_at).toBe(ext.expires_at);
  });

  it("a posting with no closing date is not extended, and says so", async () => {
    const job = await internalPosting({ expires_at: null });
    const { hash } = generateExtendToken();
    await admin.from("job_expiry_reminders").insert({
      job_posting_id: job.id,
      closes_at: at(2 * DAY + 12 * HOUR),
      token_hash: hash,
      sent_at: T.toISOString(),
    });
    expect((await redeem(hash)).outcome).toBe("no_closing_date");
    expect((await rowOf(job.id)).expires_at).toBeNull();
  });
});

describe("external postings are never reminded about, claimed, or moved", () => {
  it("after a full list-and-claim pass over the whole table, an external posting has no reminder row and an unchanged date", async () => {
    const ext = await externalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    for (const id of await due()) await claim(id);
    const { data } = await admin.from("job_expiry_reminders").select("id").eq("job_posting_id", ext.id);
    expect(data).toHaveLength(0);
    expect((await rowOf(ext.id)).expires_at).toBe(ext.expires_at);
  });
});

describe("the extend function takes the row lock (pinned from the LIVE definition)", () => {
  it("redeem_job_expiry_extend_token locks the token row before it updates the posting", async () => {
    /*
     * The 10-way concurrency test above cannot catch a missing lock on its own: the race window is microseconds, so a
     * lock-less function passes it almost every time. (Measured: with `pg_sleep(0.4)` between the read and the write, a
     * lock-less copy extended 8 of 10; the locked one extended 1.) So the lock is pinned structurally, from the
     * definition Postgres actually holds, and a future rewrite that drops it fails here.
     */
    const { data, error } = await admin.rpc("job_expiry_function_definition", {
      p_name: "redeem_job_expiry_extend_token",
    });
    expect(error).toBeNull();
    expect(data, "the function's live definition could not be read").toEqual(expect.stringContaining("redeem_job_expiry_extend_token"));
    expect(takesRowLockBeforeUpdating(data as string)).toBe(true);
  });

  it("the definition reader refuses any other function name", async () => {
    const { data } = await admin.rpc("job_expiry_function_definition", { p_name: "email_unsubscribe" });
    expect(data).toBeNull();
  });
});

describe("the table and functions are closed to anon", () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const now = T.toISOString();

  /** Every function in the migration with arguments that would otherwise succeed. */
  const CALLS: Array<[string, Record<string, unknown>]> = [
    ["expiry_reminder_window_ok", { p_closes_at: now, p_now: now }],
    ["due_job_expiry_reminders", { p_now: now, p_limit: 5 }],
    ["claim_job_expiry_reminder", { p_job_posting_id: randomUUID(), p_token_hash: "x", p_now: now }],
    ["redeem_job_expiry_extend_token", { p_token_hash: "x", p_now: now }],
    ["job_expiry_function_definition", { p_name: "redeem_job_expiry_extend_token" }],
  ];

  it.each(CALLS)("anon calling %s is refused with permission denied (42501)", async (fn, args) => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const res = await anon.rpc(fn as never, args as never);
    expect(res.error, `${fn} must not be callable by anon`).not.toBeNull();
    expect(res.error!.code).toBe("42501");
  });

  it("anon cannot read the table", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const read = await anon.from("job_expiry_reminders").select("*");
    expect(read.error, "anon read must be refused, not merely empty").not.toBeNull();
  });
});
