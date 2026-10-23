/**
 * N1-R34: resolve_stale_claim refuses an open e-mail claim younger than a fixed floor of 30 minutes, whatever the caller passes; stale_notification_claims keeps its caller-chosen age. The figure has one
 * named source, STALE_CLAIM_MIN_AGE_MINUTES in contract.ts; the SQL holds it as a literal (no helper function: the function allow-list is closed), and this file reads the migration text and asserts the
 * literal equals the constant. The boundary is run against the database: 29 minutes is refused, 30 is accepted.
 */
import { describe, expect, it } from "vitest";
import { STALE_CLAIM_MIN_AGE_MINUTES } from "@/lib/notifications/contract";
import { A2, FIXTURES, U1, F0265, grantPermissionSql, probe, readMigration, replay0265, scalar } from "./migration-0265-support";

const S = (n: number) => `00000000-0000-4000-8000-0000000fb${String(n).padStart(3, "0")}`;
const claim = (n: number, channel: string, age: string) =>
  `insert into public.notification_deliveries (id, user_id, kind, subject_id, channel, claimed_at) values ('${S(n)}', '${U1}', 'match_alert', '${S(n + 50)}', '${channel}', now() - interval '${age}');`;
const resolve = (n: number) => `select public.resolve_stale_claim(p_id => '${S(n)}', p_actor => '${A2}', p_resolution => 'mark_sent')`;

describe("the stale floor has one source", () => {
  const sql = readMigration(F0265);
  const body = sql.slice(sql.indexOf("create function public.resolve_stale_claim("), sql.indexOf("$resolve$;", sql.indexOf("create function public.resolve_stale_claim(")));
  it("the SQL literal in resolve_stale_claim equals the contract constant", () => {
    const literals = [...body.matchAll(/interval '(\d+) minutes'/g)].map((m) => Number(m[1]));
    expect(literals).toEqual([STALE_CLAIM_MIN_AGE_MINUTES]);
  });
  it("the constant is 30, the figure the ruling fixed", () => expect(STALE_CLAIM_MIN_AGE_MINUTES).toBe(30));
  it("stale_notification_claims keeps its age parameter and has no floor of its own", () => {
    const a = sql.indexOf("create function public.stale_notification_claims(");
    const fn = sql.slice(a, sql.indexOf("$stale$;", a));
    expect(fn).toContain("p_older_than interval");
    expect(fn).not.toMatch(/interval '\d+ minutes'/);
  });
});

describe("the boundary, against the database", () => {
  const r = replay0265(
    [
      FIXTURES,
      grantPermissionSql(A2),
      claim(1, "email", "29 minutes"),
      claim(2, "email", `${STALE_CLAIM_MIN_AGE_MINUTES} minutes`),
      claim(3, "email", "29 minutes 59 seconds"),
      probe("age_29", resolve(1), "P0001", "invalid_state"),
      probe("age_29_59", resolve(3), "P0001", "invalid_state"),
      resolve(2) + ";",
      scalar("age_30_resolved", `select (sent_at is not null)::text from public.notification_deliveries where id = '${S(2)}'`),
      // the sweep's own list, called with the same age, agrees with what can be resolved
      claim(4, "email", "31 minutes"),
      scalar("listed_at_30", `select string_agg(right(id::text, 3), ',' order by id) from public.stale_notification_claims('email', interval '${STALE_CLAIM_MIN_AGE_MINUTES} minutes')`),
    ].join("\n"),
  );
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a claim aged 29 minutes (or 29 minutes 59 seconds) is refused; one aged 30 minutes is accepted", () => {
    expect([r.res.age_29, r.res.age_29_59]).toEqual(["ok", "ok"]);
    expect(r.res.age_30_resolved).toBe("true");
  });
  it("the sweep's list at the same age shows only claims that are open and old enough, and the age is its caller's to choose", () => {
    expect(r.res.listed_at_30).toBe("004"); // claim 2 was resolved above; 1 and 3 are younger; 4 is 31 minutes old
  });
});
