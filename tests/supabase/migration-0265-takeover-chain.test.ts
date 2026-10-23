/**
 * A chain of take-overs of one push endpoint (F5): A registers E, B takes E, C takes E, then A registers E again. The previous owner's row keeps a revoked tombstone endpoint; the tombstone is
 * unique per row (it carries the row's own id), so a chain never meets the unique key. Every row is printed with owner, whether its endpoint is a tombstone of its own id, and its revoke state.
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, asRole, personSql, replay0265, scalar } from "./migration-0265-support";

const A = "00000000-0000-4000-8000-00000000c0a1";
const B = "00000000-0000-4000-8000-00000000c0b2";
const C = "00000000-0000-4000-8000-00000000c0c3";
const E = "https://push.example.invalid/chain-endpoint";
const reg = (u: string, tag: string) => asRole("authenticated", [`select 'R|${tag}|' || public.register_push_subscription('${E}', 'key-${tag}', 'sec-${tag}', 'Chrome', null)::text;`], u);
const ROWS = `select string_agg(case when user_id = '${A}' then 'A' when user_id = '${B}' then 'B' else 'C' end || ':' || case when endpoint = '${E}' then 'LIVE-ENDPOINT' when endpoint = 'https://revoked.invalid/' || id::text then 'tombstone-of-own-id' else 'OTHER' end || ':' || case when revoked_at is null then 'active' else 'revoked' end || ':' || coalesce(revoke_reason, '-') || ':' || p256dh, ' | ' order by user_id, (revoked_at is null) desc) from public.push_subscriptions`;

const r = replay0265(
  [
    FIXTURES,
    personSql(A),
    personSql(B),
    personSql(C),
    reg(A, "a1"),
    scalar("after_a", ROWS),
    reg(B, "b"),
    scalar("after_b", ROWS),
    reg(C, "c"),
    scalar("after_c", ROWS),
    reg(A, "a2"),
    scalar("after_a_again", ROWS),
    scalar("rows", "select count(*) from public.push_subscriptions"),
    scalar("live_endpoint_rows", `select count(*) from public.push_subscriptions where endpoint = '${E}'`),
    scalar("distinct_endpoints", "select count(distinct endpoint) from public.push_subscriptions"),
    scalar("live_owner", `select case when user_id = '${A}' then 'A' else 'other' end from public.push_subscriptions where endpoint = '${E}'`),
  ].join("\n"),
);

describe("a chain of take-overs of one endpoint", () => {
  it("the replay applies and no unique violation occurs", () => expect(r.ok, r.stderr).toBe(true));
  it("prints every row at each step", () => {
    console.log("CHAIN after A       :", r.res.after_a);
    console.log("CHAIN after B takes :", r.res.after_b);
    console.log("CHAIN after C takes :", r.res.after_c);
    console.log("CHAIN after A again :", r.res.after_a_again);
    expect(r.res.after_a).toBe("A:LIVE-ENDPOINT:active:-:key-a1");
  });
  it("each take-over leaves the previous owner's row revoked (user) with a tombstone of its own id and unusable keys, and the new owner's row live", () => {
    expect(r.res.after_b).toBe("A:tombstone-of-own-id:revoked:user:revoked | B:LIVE-ENDPOINT:active:-:key-b");
    expect(r.res.after_c).toBe("A:tombstone-of-own-id:revoked:user:revoked | B:tombstone-of-own-id:revoked:user:revoked | C:LIVE-ENDPOINT:active:-:key-c");
  });
  it("when A registers E again it is a NEW row for A (the old A row stays a tombstone), C's row is tombstoned, exactly one row holds the endpoint, and every endpoint is distinct", () => {
    expect(r.res.after_a_again).toBe(
      "A:LIVE-ENDPOINT:active:-:key-a2 | A:tombstone-of-own-id:revoked:user:revoked | B:tombstone-of-own-id:revoked:user:revoked | C:tombstone-of-own-id:revoked:user:revoked",
    );
    expect([r.res.rows, r.res.live_endpoint_rows, r.res.distinct_endpoints, r.res.live_owner]).toEqual(["4", "1", "4", "A"]);
  });
});
