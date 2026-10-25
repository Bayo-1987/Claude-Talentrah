/**
 * 0273 (N1B) part B, register_push_subscription, replayed CUMULATIVELY (0265 then 0273):
 *   F4  the endpoint host must be one of the known push services; each host below is cited in the report from a page read in the session that wrote it
 *   a take-over keeps the previous owner's FIRST revoke reason and time
 * The allow-list is a literal in the function; this file reads the migration text and asserts it equals PUSH_ENDPOINT_HOSTS in contract.ts.
 * Service set of the local stack: REDUCED (auth, db, kong, rest, storage).
 */
import { describe, expect, it } from "vitest";
import { NOTIFICATION_REFUSAL_REASONS } from "@/lib/notifications/contract-db";
import { PUSH_ENDPOINT_HOSTS } from "@/lib/notifications/contract";
import { D1, FIXTURES, F0273, U1, U2, asRole, probe, readMigration, replay0265, rowsOf, scalar } from "./migration-0265-support";

const reg = (endpoint: string, zone = "null") => `select public.register_push_subscription(p_endpoint => '${endpoint.replace(/'/g, "''")}', p_p256dh => 'k', p_auth => 'a', p_ua => 'Chrome', p_timezone => ${zone})`;
const asU1 = (lines: string[]) => asRole("authenticated", lines, U1);
const UUID = "00000000-0000-4000-8000-0000000000ab";

const ACCEPTED: Array<[string, string]> = [
  ["Chrome (FCM)", "https://fcm.googleapis.com/fcm/send/cpqAgzGzkzQ:APA9"],
  ["Chrome, no path", "https://fcm.googleapis.com"],
  ["Chrome, a query straight after the host", "https://fcm.googleapis.com?x=1"],
  ["upper case host, accepted after lower-casing", "https://FCM.GoogleAPIs.COM/fcm/send/abc"],
  ["Firefox (autopush)", "https://updates.push.services.mozilla.com/wpush/v2/gAAAA"],
  ["Safari (web.push.apple.com)", "https://web.push.apple.com/QKmekz9T3h2Dpbl"],
  ["another host under push.apple.com", "https://abc.push.apple.com/x"],
  ["a fragment straight after the host", "https://fcm.googleapis.com#frag"],
  ["Edge (WNS)", "https://wns2-ch1p.notify.windows.com/w/?token=BQYAAADi9"],
  ["another subdomain of notify.windows.com", "https://db5.notify.windows.com/x"],
];
const REFUSED: Array<[string, string]> = [
  ["a trailing dot after the host", "https://fcm.googleapis.com./fcm/send/abc"],
  ["a space after the host", "https://fcm.googleapis.com /fcm/send/abc"],
  ["a space in the path", "https://fcm.googleapis.com/fcm/send/a b"],
  ["a tab in the path", "https://fcm.googleapis.com/fcm/send/a\tb"],
  ["a newline in the path", "https://fcm.googleapis.com/fcm/send/a\nb"],
  ["a backslash in the path", "https://fcm.googleapis.com/fcm/send/a\\b"],
  ["a backslash that hides another host", "https://evil.example\\@fcm.googleapis.com/x"],
  ["a backslash before the listed host", "https://evil.example\\.fcm.googleapis.com/x"],
  ["a percent-encoded dot in the host", "https://fcm.googleapis%2ecom/fcm/send/abc"],
  ["a percent-encoded letter in the host", "https://%66cm.googleapis.com/fcm/send/abc"],
  ["user info before the listed host", "https://user@fcm.googleapis.com/fcm/send/abc"],
  ["the listed host as user info", "https://fcm.googleapis.com@evil.example/x"],
  ["user info with a password", "https://u:p@fcm.googleapis.com/x"],
  ["a port 443", "https://fcm.googleapis.com:443/fcm/send/abc"],
  ["a port 8443", "https://fcm.googleapis.com:8443/fcm/send/abc"],
  ["an empty port", "https://fcm.googleapis.com:/fcm/send/abc"],
  ["user info before a suffix host (apple)", "https://user@web.push.apple.com/x"],
  ["user info before a suffix host (windows)", "https://user:pw@wns2.notify.windows.com/x"],
  ["a port on a suffix host (apple)", "https://web.push.apple.com:443/x"],
  ["a port on a suffix host (windows)", "https://wns2.notify.windows.com:8443/x"],
  ["a percent-encoded dot in a suffix host", "https://web%2epush.apple.com/x"],
  ["a trailing dot on a suffix host", "https://web.push.apple.com./x"],
  ["a bracket in a suffix host", "https://[web.push.apple.com]/x"],
  ["an underscore in a suffix host", "https://we_b.push.apple.com/x"],
  ["a percent sign in a suffix host", "https://we%b.notify.windows.com/x"],
  ["the listed host as a prefix of another", "https://fcm.googleapis.com.evil.example/x"],
  ["the listed host as a suffix of another", "https://evil-fcm.googleapis.com/x"],
  ["the listed host with a letter in front", "https://xfcm.googleapis.com/x"],
  ["a parent domain", "https://googleapis.com/x"],
  ["a different top level", "https://fcm.googleapis.co/x"],
  ["the listed host only in the path", "https://evil.example/fcm.googleapis.com/fcm/send/abc"],
  ["the listed host only in the query", "https://evil.example/?h=fcm.googleapis.com"],
  ["a subdomain of an exact-match host", "https://a.updates.push.services.mozilla.com/x"],
  ["a sibling of the exact-match mozilla host", "https://push.services.mozilla.com/x"],
  ["the mozilla host with a suffix", "https://updates.push.services.mozilla.com.evil.example/x"],
  ["the apple suffix with nothing in front", "https://push.apple.com/x"],
  ["the apple suffix with no dot in front", "https://evilpush.apple.com/x"],
  ["the apple suffix followed by another domain", "https://x.push.apple.com.evil.example/x"],
  ["the windows suffix with nothing in front", "https://notify.windows.com/x"],
  ["the windows suffix with no dot in front", "https://evilnotify.windows.com/x"],
  ["the windows suffix followed by another domain", "https://x.notify.windows.com.evil.example/x"],
  ["the old Android GCM host", "https://android.googleapis.com/gcm/send/abc"],
  ["the tombstone host of a taken-over device", `https://revoked.invalid/${UUID}`],
  ["the invalid top level", "https://push.example.invalid/x"],
  ["an IPv4 address", "https://127.0.0.1/x"],
  ["the cloud metadata address", "https://169.254.169.254/latest/meta-data"],
  ["an IPv6 address", "https://[::1]/x"],
  ["no host at all", "https:///fcm/send/abc"],
  ["nothing after the scheme", "https://"],
  ["a single-label host", "https://localhost/x"],
];

describe("F4: the host allow-list", () => {
  const body = [
    FIXTURES,
    asU1([
      ...ACCEPTED.map(([, e], i) => rowsOf(`ok${i}`, reg(e))),
      ...REFUSED.map(([, e], i) => probe(`no${i}`, reg(e), "P0001", "host_not_allowed")),
      // the order of the checks: scheme, then length, then host, then zone
      probe("scheme_first", reg("http://evil.example/x"), "P0001", "not_https"),
      probe("length_before_host", reg("https://evil.example/" + "x".repeat(2100)), "P0001", "value_too_long"),
      probe("host_before_zone", reg("https://evil.example/x", "'Mars/Olympus'"), "P0001", "host_not_allowed"),
      probe("zone_after_a_good_host", reg("https://fcm.googleapis.com/z", "'Mars/Olympus'"), "22023"),
      // a refused registration stores nothing
    ]),
    scalar("stored", "select count(*) from public.push_subscriptions"),
    scalar("stored_hosts", "select string_agg(distinct lower(substring(endpoint from '^https://([^/?#]*)')), ',' order by lower(substring(endpoint from '^https://([^/?#]*)'))) from public.push_subscriptions"),
  ].join("\n");
  const r = replay0265(body);

  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it.each(ACCEPTED.map(([n, e], i) => [n, e, i] as const))("accepted: %s", (_n, _e, i) => expect(r.res[`ok${i}`]).toBe("1"));
  it.each(REFUSED.map(([n, e], i) => [n, e, i] as const))("refused with host_not_allowed: %s", (_n, _e, i) => expect(r.res[`no${i}`]).toBe("ok"));
  it("the checks run in the order scheme, length, host, zone", () => {
    for (const k of ["scheme_first", "length_before_host", "host_before_zone", "zone_after_a_good_host"]) expect(r.res[k], k).toBe("ok");
  });
  it("only the listed hosts end up stored", () => {
    expect(r.res.stored).toBe(String(ACCEPTED.length));
    expect(r.res.stored_hosts).toBe("abc.push.apple.com,db5.notify.windows.com,fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,wns2-ch1p.notify.windows.com");
  });
});

describe("F4: the list in the SQL equals the contract constant, and the new refusal reason exists", () => {
  const sql = readMigration(F0273);
  const start = sql.indexOf("create or replace function public.register_push_subscription(");
  const fn = sql.slice(start, sql.indexOf("$register$;", start));
  const literals = (re: RegExp) => [...(re.exec(fn)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
  it("the exact hosts and the suffixes in register_push_subscription are exactly the constant", () => {
    expect(start).toBeGreaterThan(-1);
    expect(literals(/v_host = any \(array\[([^\]]+)\]\)/)).toEqual([...PUSH_ENDPOINT_HOSTS.exact]);
    expect(literals(/unnest\(array\[([^\]]+)\]\) s\(suffix\)/)).toEqual([...PUSH_ENDPOINT_HOSTS.suffixes]);
  });
  it("the constant is the four services read from their own documentation: Chrome, Firefox, Safari, Edge", () => {
    expect(PUSH_ENDPOINT_HOSTS).toEqual({ exact: ["fcm.googleapis.com", "updates.push.services.mozilla.com"], suffixes: ["push.apple.com", "notify.windows.com"] });
  });
  it("host_not_allowed is a closed refusal reason of the contract", () => expect(NOTIFICATION_REFUSAL_REASONS).toContain("host_not_allowed"));
});

describe("a take-over keeps the previous owner's first revoke reason and time", () => {
  const E = "https://fcm.googleapis.com/fcm/send/takeover";
  const body = [
    FIXTURES,
    `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short, revoked_at, revoke_reason) values ('${D1}', '${U1}', '${E}', 'k', 'a', 'Chrome', now() - interval '2 days', 'gone');`,
    asRole("authenticated", [rowsOf("take_over_a_revoked_row", reg(E))], U2),
    scalar("previous", `select revoke_reason || '/' || (revoked_at = now() - interval '2 days')::text || '/' || (endpoint = 'https://revoked.invalid/' || id::text)::text || '/' || p256dh || '/' || auth from public.push_subscriptions where id = '${D1}'`),
    scalar("new_owner", `select user_id from public.push_subscriptions where endpoint = '${E}'`),
    // an active row is still revoked now, with the reason user
    `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short) values ('00000000-0000-4000-8000-0000000000d2', '${U2}', '${E}-2', 'k', 'a', 'Chrome');`,
    asRole("authenticated", [rowsOf("take_over_an_active_row", reg(`${E}-2`))], U1),
    scalar("active_previous", "select revoke_reason || '/' || (revoked_at is not null)::text from public.push_subscriptions where id = '00000000-0000-4000-8000-0000000000d2'"),
    // each other reason is kept too
    ...["kill", "bad_key", "deleted", "user"].flatMap((reason, i) => [
      `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short, revoked_at, revoke_reason) values ('00000000-0000-4000-8000-0000000000e${i}', '${U1}', '${E}-r${i}', 'k', 'a', 'Chrome', now() - interval '${i + 1} hours', '${reason}');`,
      asRole("authenticated", [rowsOf(`take_${reason}`, reg(`${E}-r${i}`))], U2),
      scalar(`kept_${reason}`, `select revoke_reason || '/' || (revoked_at = now() - interval '${i + 1} hours')::text from public.push_subscriptions where id = '00000000-0000-4000-8000-0000000000e${i}'`),
    ]),
  ].join("\n");
  const r = replay0265(body);
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it("a row that was already revoked keeps its reason and its time; its endpoint becomes its own tombstone and its keys are wiped", () => {
    expect(r.res.take_over_a_revoked_row).toBe("1");
    expect(r.res.previous).toBe("gone/true/true/revoked/revoked");
    expect(r.res.new_owner).toBe(U2);
  });
  it("a live row is revoked now with the reason user", () => expect(r.res.active_previous).toBe("user/true"));
  it("each of the other revoke reasons and its time survives a take-over", () => {
    for (const reason of ["kill", "bad_key", "deleted", "user"]) expect(r.res[`kept_${reason}`], reason).toBe(`${reason}/true`);
  });
});
