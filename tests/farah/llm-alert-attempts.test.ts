/**
 * The operator-alert attempts (migration 0235) — DATABASE-BACKED, CI ONLY. They run against the ephemeral per-job database CI builds from supabase/migrations; they never run against a hosted project,
 * and they have not been seen run on the authoring machine (there is no database there). The concurrency assertions are shared with tests/farah/alert-race-detection.test.ts, which shows they can fail.
 *
 * ISOLATION. Today's row for each alert is shared by every test run on one database, so each test starts by putting that alert's row back to a clean state (the service role may update it).
 * tests/farah/tally-isolation.test.ts allows only this file and the grants test to reach the table or its functions, and the route tests use mocks.
 *
 *   (a) one attempt in flight under a lease;  (b) attempts bounded;  (c) a send recorded as done closes the alert;  (d) the two alerts are independent;
 *   (e) the lease runs out;  (f) bad input is refused and changes nothing;  (g) the table's own checks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { admin as typedAdmin } from "../support/auth";
import { assertAttemptsBounded, assertOneAttemptInFlight, type AlertName } from "./support/alert-assertions";

// The generated Database types do not know the new table or functions until they are regenerated after 0235, and CI typechecks before it tests.
const admin = typedAdmin as unknown as SupabaseClient;
const TABLE = "llm_daily_usage_alert_markers";
const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);

async function claimRaw(alert: unknown, max: unknown, lease: unknown) {
  return admin.rpc("claim_llm_alert_attempt", { p_alert: alert as string, p_max_attempts: max as number, p_lease_seconds: lease as number });
}
async function claim(alert: AlertName, max = 3, lease = 10): Promise<boolean> {
  const { data, error } = await claimRaw(alert, max, lease);
  if (error) throw error;
  return data === true;
}
async function mark(alert: unknown) {
  return admin.rpc("mark_llm_alert_sent", { p_alert: alert as string });
}
async function row(alert: AlertName, day = utcDate()) {
  const { data, error } = await admin.from(TABLE).select("day, alert, attempts, last_attempt_at, sent_at").eq("day", day).eq("alert", alert).maybeSingle();
  if (error) throw error;
  return data as { attempts: number; last_attempt_at: string | null; sent_at: string | null } | null;
}
/** Puts today's row for the alert back to "nothing attempted, nothing sent". */
async function reset(alert: AlertName) {
  const { error } = await admin.from(TABLE).upsert({ day: utcDate(), alert, attempts: 0, last_attempt_at: null, sent_at: null }, { onConflict: "day,alert" });
  if (error) throw error;
}
/** Runs a test body; if the UTC date changed while it ran, runs it once more on the new day. */
async function onOneUtcDay(body: () => Promise<void>): Promise<void> {
  const before = utcDate();
  try {
    await body();
  } catch (err) {
    if (utcDate() === before) throw err;
    await body();
    return;
  }
  if (utcDate() !== before) await body();
}

beforeEach(async () => {
  await reset("eighty");
  await reset("reached");
});

describe("(a) one attempt in flight at a time", () => {
  it("the first caller gets the attempt, and the next one inside the lease does not", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      expect(await claim("eighty")).toBe(true);
      expect(await claim("eighty")).toBe(false);
      expect((await row("eighty"))?.attempts).toBe(1);
    });
  });

  it("50 concurrent callers: exactly one gets the attempt", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      await assertOneAttemptInFlight((alert, max, lease) => claim(alert, max, lease));
    });
  });
});

describe("(b) the attempts are bounded", () => {
  it("with no lease, a caller can try again at once, but only up to the maximum: the 4th is refused", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      expect([await claim("eighty", 3, 0), await claim("eighty", 3, 0), await claim("eighty", 3, 0), await claim("eighty", 3, 0)]).toEqual([true, true, true, false]);
      expect((await row("eighty"))?.attempts).toBe(3);
    });
  });

  it("50 concurrent callers with no lease and a maximum of 3: exactly 3 get an attempt", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      await assertAttemptsBounded((alert, max, lease) => claim(alert, max, lease));
      expect((await row("eighty"))?.attempts).toBe(3);
    });
  });

  it("the default maximum is 3 attempts a day", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      const results: boolean[] = [];
      for (let i = 0; i < 5; i += 1) {
        const { data, error } = await admin.rpc("claim_llm_alert_attempt", { p_alert: "eighty", p_lease_seconds: 0 });
        expect(error).toBeNull();
        results.push(data === true);
      }
      expect(results).toEqual([true, true, true, false, false]);
    });
  });
});

describe("(c) a send recorded as done closes the alert", () => {
  it("after mark_llm_alert_sent no caller gets an attempt, even with attempts left and no lease; the second mark says it was already recorded", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      expect(await claim("eighty", 3, 0)).toBe(true);
      expect((await mark("eighty")).data).toBe(true);
      expect(await claim("eighty", 3, 0)).toBe(false);
      expect((await mark("eighty")).data).toBe(false);
      const r = await row("eighty");
      expect(r?.attempts).toBe(1);
      expect(r?.sent_at).not.toBeNull();
    });
  });

  it("marking an alert that was never attempted today records nothing and says so (a send can only be recorded for an attempt that was taken)", async () => {
    await onOneUtcDay(async () => {
      await reset("reached");
      expect((await mark("reached")).data).toBe(false);
      expect((await row("reached"))?.sent_at).toBeNull();
    });
  });

  it("a failed send leaves the alert open: the attempt is counted, nothing is marked, and a later caller (lease over) gets the next attempt", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      expect(await claim("eighty", 3, 0)).toBe(true);
      expect((await row("eighty"))?.sent_at).toBeNull();
      expect(await claim("eighty", 3, 0)).toBe(true);
      expect((await row("eighty"))?.attempts).toBe(2);
    });
  });

  it("yesterday's sent alert does not close today's", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      const yesterday = utcDate(new Date(Date.now() - 86_400_000));
      const { error } = await admin.from(TABLE).upsert({ day: yesterday, alert: "eighty", attempts: 3, last_attempt_at: new Date(Date.now() - 86_400_000).toISOString(), sent_at: new Date(Date.now() - 86_400_000).toISOString() }, { onConflict: "day,alert" });
      expect(error).toBeNull();
      expect(await claim("eighty")).toBe(true);
    });
  });
});

describe("(d) the 80% and 'reached' alerts are independent", () => {
  it("an 80% alert that is sent, or used up, does not use up the 'reached' alert", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      await reset("reached");
      expect(await claim("eighty", 3, 0)).toBe(true);
      expect((await mark("eighty")).data).toBe(true);
      expect(await claim("eighty", 3, 0)).toBe(false);
      expect(await claim("reached", 3, 0)).toBe(true);
      expect((await row("reached"))?.attempts).toBe(1);
      expect((await row("reached"))?.sent_at).toBeNull();
    });
  });
});

describe("(e) the lease", () => {
  it("an attempt older than the lease no longer blocks the next one; a younger one still does", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
      await admin.from(TABLE).update({ attempts: 1, last_attempt_at: ago(5) }).eq("day", utcDate()).eq("alert", "eighty");
      expect(await claim("eighty", 3, 10)).toBe(false); // 5 s ago, lease 10 s: still in flight
      await admin.from(TABLE).update({ attempts: 1, last_attempt_at: ago(11) }).eq("day", utcDate()).eq("alert", "eighty");
      expect(await claim("eighty", 3, 10)).toBe(true); // 11 s ago: the attempt is presumed over
      expect((await row("eighty"))?.attempts).toBe(2);
    });
  });
});

describe("(f) bad input is refused with SQLSTATE 22023 and changes nothing", () => {
  it("an unknown alert, and a maximum or lease outside the allowed range, on both functions", async () => {
    await onOneUtcDay(async () => {
      await reset("eighty");
      const before = await row("eighty");
      const bad: Array<[unknown, unknown, unknown]> = [
        ["nope", 3, 10],
        [null, 3, 10],
        ["EIGHTY", 3, 10],
        ["eighty", 0, 10],
        ["eighty", 11, 10],
        ["eighty", null, 10],
        ["eighty", 3, -1],
        ["eighty", 3, 601],
        ["eighty", 3, null],
      ];
      for (const [a, m, l] of bad) expect((await claimRaw(a, m, l)).error?.code, JSON.stringify([a, m, l])).toBe("22023");
      for (const a of ["nope", null, "EIGHTY", "reached "]) expect((await mark(a)).error?.code, String(a)).toBe("22023");
      expect(await row("eighty")).toEqual(before);
    });
  });
});

describe("(g) the table's own checks", () => {
  it("refuses an unknown alert name (23514) and an attempts count outside 0 to 10 (23514)", async () => {
    await onOneUtcDay(async () => {
      expect((await admin.from(TABLE).insert({ day: utcDate(new Date(Date.now() + 86_400_000 * 3)), alert: "zzz", attempts: 0 })).error?.code).toBe("23514");
      expect((await admin.from(TABLE).update({ attempts: 11 }).eq("day", utcDate()).eq("alert", "eighty")).error?.code).toBe("23514");
      expect((await admin.from(TABLE).update({ attempts: -1 }).eq("day", utcDate()).eq("alert", "eighty")).error?.code).toBe("23514");
    });
  });
});
