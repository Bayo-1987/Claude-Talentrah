/**
 * The closing reminder and the Extend link, against a REAL database (migration 0207).
 *
 * Service-role only: every call here goes through the functions the cron and the confirm page use. Nothing needs an
 * authenticated session, so unlike the RLS suites this runs against a hosted test project too.
 *
 * TIME IS A PARAMETER. Both listing and redeeming take `p_now`, so every fixture below lives around a fixed instant in
 * 2030. That keeps these rows out of reach of the real expiry sweep (tests/jobs/expires-at.test.ts closes any internal
 * posting whose expires_at is in the real past) and makes "a minute either side of the window" exact.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../../support/auth";
import { deleteTestOrgs } from "../../support/cleanup";
import { runCleanups, mustDelete } from "../../support/teardown";
import { generateExtendToken } from "@/lib/jobs/expiry-reminders/token";

const T = new Date("2030-06-15T19:00:00.000Z"); // "now" for every call below
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(T.getTime() + offsetMs).toISOString();

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
    .select("id, expires_at")
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

async function due(limit = 1000) {
  const { data, error } = await admin.rpc("due_job_expiry_reminders", { p_now: T.toISOString(), p_limit: limit });
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

async function expiresOf(id: string) {
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

describe("who is due: a 25-hour window, (now + 2d, now + 3d + 1h]", () => {
  it("lists exactly the eligible postings and nothing else", async () => {
    // Eligible — inside the window, and on its inclusive upper edge.
    const e1 = await internalPosting({ expires_at: at(2 * DAY + MIN) });
    const e2 = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    const e3 = await internalPosting({ expires_at: at(3 * DAY) });
    const e4 = await internalPosting({ expires_at: at(3 * DAY + HOUR) });

    // Not eligible — a minute outside either edge, and the exclusive lower edge itself.
    const lowEdge = await internalPosting({ expires_at: at(2 * DAY) });
    const tooSoon = await internalPosting({ expires_at: at(2 * DAY - MIN) });
    const tooEarly = await internalPosting({ expires_at: at(3 * DAY + HOUR + MIN) });
    const farOff = await internalPosting({ expires_at: at(20 * DAY) });
    const alreadyPast = await internalPosting({ expires_at: at(-HOUR) });

    // Not eligible — right date, wrong kind of posting.
    const noExpiry = await internalPosting({ expires_at: null });
    const external = await externalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    const closed = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR), status: "closed" });
    const removed = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR), status: "removed" });
    const draft = await internalPosting({ expires_at: at(2 * DAY + 12 * HOUR), status: "draft" });

    const got = await due();
    expect(new Set(got)).toEqual(new Set([e1.id, e2.id, e3.id, e4.id]));
    for (const row of [lowEdge, tooSoon, tooEarly, farOff, alreadyPast, noExpiry, external, closed, removed, draft]) {
      expect(got, `${row.id} must not be due`).not.toContain(row.id);
    }
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
    for (const job of [external, closed, far]) {
      expect((await claim(job.id)).rows).toHaveLength(0);
    }
    const { data } = await admin
      .from("job_expiry_reminders")
      .select("id")
      .in("job_posting_id", [external.id, closed.id, far.id]);
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
    expect(new Date((await expiresOf(job.id)).expires_at!).getTime()).toBe(before + 30 * DAY);

    // Second use: refused, and the date does not move again.
    const again = await redeem(hash);
    expect(again.outcome).toBe("used");
    expect(new Date((await expiresOf(job.id)).expires_at!).getTime()).toBe(before + 30 * DAY);
  });

  it("concurrent uses of one link: exactly one extends, and the date moves by 30 days once", async () => {
    const { job, hash } = await linkedPosting(2 * DAY + 13 * HOUR);
    const before = new Date(job.expires_at!).getTime();

    const outcomes = await Promise.all(Array.from({ length: 10 }, () => redeem(hash)));
    expect(outcomes.filter((o) => o.outcome === "extended")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "used")).toHaveLength(9);
    expect(new Date((await expiresOf(job.id)).expires_at!).getTime()).toBe(before + 30 * DAY);
  });

  it("an expired link (the closing date has passed) does not extend", async () => {
    const { job, hash } = await linkedPosting(2 * DAY + 14 * HOUR);
    const before = (await expiresOf(job.id)).expires_at;
    const out = await redeem(hash, new Date(new Date(before!).getTime() + 1000));
    expect(out.outcome).toBe("expired");
    expect((await expiresOf(job.id)).expires_at).toBe(before);
  });

  it("a tampered or unknown token does not extend anything", async () => {
    const { job } = await linkedPosting(2 * DAY + 15 * HOUR);
    const before = (await expiresOf(job.id)).expires_at;
    expect((await redeem(generateExtendToken().hash)).outcome).toBe("invalid");
    expect((await redeem("")).outcome).toBe("invalid");
    expect((await redeem("' or 1=1 --")).outcome).toBe("invalid");
    expect((await expiresOf(job.id)).expires_at).toBe(before);
  });

  it("a link extends ITS posting only", async () => {
    const a = await linkedPosting(2 * DAY + 16 * HOUR);
    const b = await internalPosting({ expires_at: at(2 * DAY + 17 * HOUR) });
    const bBefore = (await expiresOf(b.id)).expires_at;
    expect((await redeem(a.hash)).outcome).toBe("extended");
    expect((await expiresOf(b.id)).expires_at).toBe(bBefore);
  });

  it.each(["closed", "removed", "draft"] as const)(
    "a posting that is %s by the time the link is used is not extended, and the link is NOT consumed",
    async (status) => {
      const { job, hash } = await linkedPosting(2 * DAY + 18 * HOUR);
      const before = (await expiresOf(job.id)).expires_at;
      await admin.from("job_postings").update({ status }).eq("id", job.id);

      const out = await redeem(hash);
      expect(out.outcome).toBe("unavailable");
      expect((await expiresOf(job.id)).expires_at).toBe(before);
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
    expect(out.outcome).toBe("unavailable");
    expect((await expiresOf(ext.id)).expires_at).toBe(ext.expires_at);
  });

  it("a posting with no closing date is not extended", async () => {
    const job = await internalPosting({ expires_at: null });
    const { hash } = generateExtendToken();
    await admin.from("job_expiry_reminders").insert({
      job_posting_id: job.id,
      closes_at: at(2 * DAY + 12 * HOUR),
      token_hash: hash,
      sent_at: T.toISOString(),
    });
    expect((await redeem(hash)).outcome).toBe("unavailable");
    expect((await expiresOf(job.id)).expires_at).toBeNull();
  });
});

describe("external postings are never reminded about, claimed, or moved", () => {
  it("after a full list-and-claim pass over the whole table, an external posting has no reminder row and an unchanged date", async () => {
    const ext = await externalPosting({ expires_at: at(2 * DAY + 12 * HOUR) });
    for (const id of await due()) await claim(id);
    const { data } = await admin.from("job_expiry_reminders").select("id").eq("job_posting_id", ext.id);
    expect(data).toHaveLength(0);
    expect((await expiresOf(ext.id)).expires_at).toBe(ext.expires_at);
  });
});

describe("the table is closed to every client role", () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  it("anon can neither read the table nor call any of the functions", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const read = await anon.from("job_expiry_reminders").select("*");
    expect(read.error, "anon read must be refused, not merely empty").not.toBeNull();

    for (const [fn, args] of [
      ["due_job_expiry_reminders", { p_now: T.toISOString(), p_limit: 5 }],
      ["claim_job_expiry_reminder", { p_job_posting_id: randomUUID(), p_token_hash: "x", p_now: T.toISOString() }],
      ["redeem_job_expiry_extend_token", { p_token_hash: "x", p_now: T.toISOString() }],
    ] as const) {
      const res = await anon.rpc(fn, args as never);
      expect(res.error, `${fn} must not be callable by anon`).not.toBeNull();
    }
  });
});
