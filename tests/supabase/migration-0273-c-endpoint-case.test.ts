/**
 * 0273 (N1B) FIX finding N1, register_push_subscription, replayed CUMULATIVELY (0265 then 0273): the endpoint is stored with its host lower-cased (the scheme is already https, the path is
 * untouched), BEFORE the unique key, the take-over lookup, the endpoint lock and the ten-device count. So two spellings of one host are one endpoint.
 * Finding N2 is in the same file: registering one's own device again refreshes the browser name.
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { FIXTURES, U1, U2, asRole, probe, replay0265, rowsOf, scalar } from "./migration-0265-support";

const reg = (endpoint: string, ua = "Chrome") => `select public.register_push_subscription(p_endpoint => '${endpoint}', p_p256dh => 'k', p_auth => 'a', p_ua => '${ua}', p_timezone => null)`;
const asU1 = (lines: string[]) => asRole("authenticated", lines, U1);
const asU2 = (lines: string[]) => asRole("authenticated", lines, U2);
const LOWER = "https://fcm.googleapis.com/fcm/send/AbC-Path";
const UPPER_HOST = "https://FCM.GoogleAPIs.com/fcm/send/AbC-Path";
const live = (who: string) => `select count(*) from public.push_subscriptions where user_id = '${who}' and revoked_at is null`;

describe("N1: one endpoint, however the host is spelled", () => {
  const body = [
    FIXTURES,
    // the same person, two spellings: one row, refreshed in place, stored in the lower-case host form with the path as typed
    asU1([rowsOf("first", reg(UPPER_HOST)), rowsOf("second", reg(LOWER))]),
    scalar("one_row_for_u1", live(U1)),
    scalar("stored", `select endpoint from public.push_subscriptions where user_id = '${U1}'`),
    scalar("same_id", `select (select count(distinct id) from public.push_subscriptions where user_id = '${U1}')`),
    // another person registering the other spelling takes the device over: one live row in total, theirs
    asU2([rowsOf("take_over_other_spelling", reg(UPPER_HOST.replace("FCM.GoogleAPIs.com", "fcm.GOOGLEAPIS.com")))]),
    scalar("live_rows_for_the_endpoint", `select count(*) from public.push_subscriptions where revoked_at is null and lower(substring(endpoint from '^https://([^/?#]*)')) = 'fcm.googleapis.com'`),
    scalar("owner_now", `select user_id from public.push_subscriptions where revoked_at is null and endpoint = '${LOWER}'`),
    scalar("old_row_revoked", `select revoke_reason from public.push_subscriptions where user_id = '${U1}'`),
    // the path keeps its case: two paths that differ only in case are two endpoints
    asU1([rowsOf("path_case_a", reg("https://web.push.apple.com/AbC")), rowsOf("path_case_b", reg("https://WEB.push.apple.com/abc"))]),
    scalar("path_case_rows", `select count(*) from public.push_subscriptions where user_id = '${U1}' and endpoint like 'https://web.push.apple.com/%'`),
    scalar("path_case_values", `select string_agg(endpoint, ',' order by endpoint) from public.push_subscriptions where user_id = '${U1}' and endpoint like 'https://web.push.apple.com/%'`),
    // query and fragment after the host keep their case too, and the host stops at the first / ? #
    asU1([rowsOf("query_form", reg("https://UPDATES.push.services.mozilla.com?Q=AbC")), rowsOf("fragment_form", reg("https://Web2.Push.Apple.com#FrAg"))]),
    scalar("query_stored", `select string_agg(endpoint, ',' order by endpoint) from public.push_subscriptions where user_id = '${U1}' and (endpoint like 'https://updates%' or endpoint like 'https://web2%')`),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the second spelling by the same person refreshes the first row: one row, one id, stored with a lower-case host and the path as typed", () => {
    expect([r.res.first, r.res.second]).toEqual(["1", "1"]);
    expect(r.res.one_row_for_u1).toBe("1");
    expect(r.res.same_id).toBe("1");
    expect(r.res.stored).toBe(LOWER);
  });
  it("another person registering another spelling takes the device over: one live row for the endpoint, the old row revoked", () => {
    expect(r.res.take_over_other_spelling).toBe("1");
    expect(r.res.live_rows_for_the_endpoint).toBe("1");
    expect(r.res.owner_now).toBe(U2);
    expect(r.res.old_row_revoked).toBe("user");
  });
  it("the path keeps its case: two paths that differ only in case are two endpoints, both with the lower-case host", () => {
    expect([r.res.path_case_a, r.res.path_case_b]).toEqual(["1", "1"]);
    expect(r.res.path_case_rows).toBe("2");
    expect(r.res.path_case_values.split(",").sort()).toEqual(["https://web.push.apple.com/AbC", "https://web.push.apple.com/abc"]);
  });
  it("a query or a fragment right after the host keeps its case; only the host is lower-cased", () => {
    expect(r.res.query_stored.split(",").sort()).toEqual(["https://updates.push.services.mozilla.com?Q=AbC", "https://web2.push.apple.com#FrAg"]);
  });
});

describe("N1: the ten-device limit counts one endpoint once", () => {
  const ep = (n: number) => `https://fcm.googleapis.com/fcm/send/cap-${n}`;
  const body = [
    FIXTURES,
    asU1([
      ...Array.from({ length: 9 }, (_, i) => rowsOf(`d${i}`, reg(ep(i)))),
      rowsOf("tenth_upper", reg("https://FCM.googleapis.com/fcm/send/cap-tenth")),
      // the same endpoint in the other spelling is the tenth device again, not an eleventh
      rowsOf("tenth_lower", reg("https://fcm.googleapis.com/fcm/send/cap-tenth")),
      // the stored form is lower case; asking again in the typed upper-case form is still the tenth, not an eleventh
      rowsOf("tenth_upper_again", reg("https://FCM.googleapis.com/fcm/send/cap-tenth")),
      probe("eleventh_refused", reg("https://fcm.googleapis.com/fcm/send/cap-eleventh"), "P0001", "device_limit"),
      probe("eleventh_upper_refused", reg("https://FCM.GOOGLEAPIS.COM/fcm/send/cap-eleventh"), "P0001", "device_limit"),
    ]),
    scalar("live", live(U1)),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("nine devices, a tenth in either spelling, and the same tenth again is accepted; an eleventh in either spelling is refused", () => {
    expect([r.res.tenth_upper, r.res.tenth_lower, r.res.tenth_upper_again]).toEqual(["1", "1", "1"]);
    expect([r.res.eleventh_refused, r.res.eleventh_upper_refused]).toEqual(["ok", "ok"]);
    expect(r.res.live).toBe("10");
  });
});

describe("N2: registering one's own device again refreshes everything it carries, the browser name included", () => {
  const E = "https://fcm.googleapis.com/fcm/send/refresh";
  const body = [
    FIXTURES,
    asU1([rowsOf("first", reg(E, "Chrome")), rowsOf("again", `select public.register_push_subscription(p_endpoint => '${E}', p_p256dh => 'k2', p_auth => 'a2', p_ua => 'Firefox', p_timezone => 'Europe/London')`)]),
    scalar("refreshed", `select ua_short || '/' || p256dh || '/' || auth || '/' || timezone from public.push_subscriptions where user_id = '${U1}'`),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("the browser name, both keys and the zone are the new ones", () => expect(r.res.refreshed).toBe("Firefox/k2/a2/Europe/London"));
});
