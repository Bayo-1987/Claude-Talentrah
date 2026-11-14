/**
 * The mass-email runner against the contract's in-memory database (which enforces the cap, the ceiling and the eligibility rules the way the real one does), a fake provider
 * that records every request, and a clock that is the database's own clock. The same behaviours are checked against the real database in mass-send-real-database.test.ts.
 */
import { describe, expect, it } from "vitest";
import { batchIdempotencyKey } from "@/lib/admin/messages/idempotency";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { runEmailSend } from "@/lib/notifications/admin-messages/run-email";
import { APPROVER, CREATOR, SUPER, addressOf, makeWorld, uuid } from "./mass-send-support";

const idsOf = (addresses: string[]) => addresses.map((a) => uuid(Number(/person(\d+)@/.exec(a)![1])));

describe("pacing and batching", () => {
  it("a mass send never goes out faster than the configured pace", async () => {
    const w = makeWorld({ people: 250 });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result.status).toBe("finished");
    expect(w.fake.requests.map((r) => r.emails.length)).toEqual([100, 100, 50]);
    for (let i = 1; i < w.fake.requests.length; i++) expect(w.fake.requests[i].at - w.fake.requests[i - 1].at).toBeGreaterThanOrEqual(2000);
    expect(w.fake.maxInFlight()).toBe(1);
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("sent");
    expect(w.backend.messages.find((x) => x.id === m.id)!.sent_count).toBe(250);
  });

  it("101 recipients become two batches", async () => {
    const w = makeWorld({ people: 101 });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    expect(w.fake.requests.map((r) => r.emails.length)).toEqual([100, 1]);
    expect(w.fake.requests[1].at - w.fake.requests[0].at).toBeGreaterThanOrEqual(2000);
  });

  it("no request carries more than the configured number, and never more than 100", async () => {
    const w = makeWorld({ people: 100, config: { perRequest: 30 } });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    expect(w.fake.requests.map((r) => r.emails.length)).toEqual([30, 30, 30, 10]);
    expect(Math.max(...w.fake.requests.map((r) => r.emails.length))).toBeLessThanOrEqual(100);
  });

  it("every email has exactly one recipient", async () => {
    const w = makeWorld({ people: 5 });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    for (const e of w.fake.requests.flatMap((r) => r.emails)) expect(typeof e.to).toBe("string");
    expect(new Set(w.sentAddresses()).size).toBe(5);
  });

  it("slows down when the provider reports few requests left in its window", async () => {
    const w = makeWorld({ people: 101, script: [{ kind: "ok", quota: { rateRemaining: 1, dailyRemaining: 90, monthlyRemaining: 2000 } }] });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    expect(w.fake.requests[1].at - w.fake.requests[0].at).toBeGreaterThanOrEqual(4000);
  });

  it("mass sends use the mass-send address and never the sign-in address", async () => {
    const w = makeWorld({ people: 3 });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    for (const e of w.fake.requests.flatMap((r) => r.emails)) {
      expect(e.from).toBe("Talentrah <announce@mail.example.test>");
      expect(e.from).not.toContain("hello@talentrah.com");
      expect(e.from).not.toContain("farah@");
    }
  });

  it("with no configured from-address the run refuses to start and sends nothing", async () => {
    const w = makeWorld({ people: 3, identity: null });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "refused_start", reason: "no_sender_identity", sent: 0 });
    expect(w.fake.requests).toHaveLength(0);
    expect(w.backend.deliveries).toHaveLength(0);
  });

  it("each batch carries an Idempotency-Key derived from its recipient set", async () => {
    const w = makeWorld({ people: 101 });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    const [first, second] = w.fake.requests;
    expect(first.key).toBe(batchIdempotencyKey(m.id, idsOf(first.emails.map((e) => e.to))));
    expect(second.key).toBe(batchIdempotencyKey(m.id, idsOf(second.emails.map((e) => e.to))));
    expect(first.key).not.toBe(second.key);
  });
});

describe("the provider's answers", () => {
  it("a 429 with retry-after is honoured before the next request, and the retry carries the same key", async () => {
    const w = makeWorld({ people: 3, script: [{ kind: "rate_limited", retryAfterSec: 7, quota: null }] });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result.status).toBe("finished");
    expect(w.fake.requests).toHaveLength(2);
    expect(w.fake.requests[1].at - w.fake.requests[0].at).toBeGreaterThanOrEqual(7000);
    expect(w.fake.requests[1].key).toBe(w.fake.requests[0].key);
    expect(w.sentAddresses()).toHaveLength(6); // the first request was refused, the second accepted: the provider saw the same three twice, the runner recorded three sent
    expect(result.sent).toBe(3);
  });

  it("gives up after repeated rate limits, with the claims left open and nobody marked sent", async () => {
    const limited = { kind: "rate_limited", retryAfterSec: 1, quota: null } as const;
    const w = makeWorld({ people: 3, script: [limited, limited, limited, limited, limited] });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_rate_limit", sent: 0 });
    expect(w.outcomes(m.id)).toEqual([null, null, null]);
    expect(w.backend.deliveries.every((d) => d.released_at === null && d.sent_at === null)).toBe(true);
  });

  it("daily_quota_exceeded stops the send and leaves the remainder unsent and resumable", async () => {
    const w = makeWorld({ people: 150, script: [{ kind: "ok", quota: null }, { kind: "quota_exceeded", scope: "daily" }] });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_provider_quota", reason: "provider_daily_quota", sent: 100 });
    expect(w.queuedCount(m.id)).toBe(50);
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("sending"); // not finished, not failed: still resumable
    // Resumable means a person resolves the open claims, then a run sends the rest.
    w.backend.advance(31 * 60_000);
    for (const claim of await w.backend.staleNotificationClaims({ p_channel: "email", p_older_than: "30 minutes" })) {
      await w.backend.resolveStaleClaim({ p_id: claim.id, p_actor: CREATOR, p_resolution: "release_for_retry" });
    }
    const again = await runEmailSend(w.deps, m.id);
    expect(again.status).toBe("finished");
    expect(w.queuedCount(m.id)).toBe(0);
  });

  it("monthly_quota_exceeded stops the send the same way", async () => {
    const w = makeWorld({ people: 10, script: [{ kind: "quota_exceeded", scope: "monthly" }] });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_provider_quota", reason: "provider_monthly_quota", sent: 0 });
    expect(w.queuedCount(m.id)).toBe(10);
  });

  it("an unknown outcome stops the send and leaves every claim open: nothing is released and nobody is retried", async () => {
    const w = makeWorld({ people: 5, script: [{ kind: "unknown" }] });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_unknown_outcome", sent: 0, remainingQueued: 5 });
    expect(w.backend.deliveries).toHaveLength(5);
    expect(w.backend.deliveries.every((d) => d.released_at === null)).toBe(true);
  });

  it("a request the provider refuses outright marks those recipients failed and stops", async () => {
    const w = makeWorld({ people: 3, script: [{ kind: "rejected" }] });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_provider_rejected", failed: 3, sent: 0 });
    expect(w.outcomes(m.id)).toEqual(["failed", "failed", "failed"]);
  });

  it("the sender refuses to start with missing quota headers", async () => {
    for (const quota of [null, { rateRemaining: 5, dailyRemaining: null, monthlyRemaining: null }]) {
      const w = makeWorld({ people: 3, quota });
      const m = await w.startedMessage();
      const result = await runEmailSend(w.deps, m.id);
      expect(result).toMatchObject({ status: "refused_start", reason: "quota_headers_absent", sent: 0 });
      expect(w.fake.requests).toHaveLength(0);
      expect(w.backend.deliveries).toHaveLength(0);
    }
  });

  it("the sender refuses to start when the provider has no room left", async () => {
    const w = makeWorld({ people: 3, quota: { rateRemaining: 5, dailyRemaining: 0, monthlyRemaining: 100 } });
    const m = await w.startedMessage();
    expect(await runEmailSend(w.deps, m.id)).toMatchObject({ status: "refused_start", reason: "provider_quota_exhausted" });
    expect(w.fake.requests).toHaveLength(0);
  });

  it("a batch is cut to what the provider says it will still accept", async () => {
    const w = makeWorld({ people: 10, quota: { rateRemaining: 5, dailyRemaining: 4, monthlyRemaining: 100 } });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(w.fake.requests.map((r) => r.emails.length)).toEqual([4]);
    expect(result).toMatchObject({ status: "stopped_provider_quota", sent: 4, remainingQueued: 6 });
  });
});

describe("eligibility is asked again before EVERY batch (NOTIF-EMAIL-BATCH-GUARD-1)", () => {
  it("a deleted account is never in a batch (and neither is one whose deletion is pending)", async () => {
    const w = makeWorld({ people: 6 });
    const m = await w.startedMessage();
    w.backend.requestDeletion(uuid(2)); // pending deletion: the row is still there
    w.backend.deleteUser(uuid(4)); // gone: the recipient row went with it
    const result = await runEmailSend(w.deps, m.id);
    const sent = w.sentAddresses();
    expect(sent).not.toContain(addressOf(2));
    expect(sent).not.toContain(addressOf(4));
    expect(sent.sort()).toEqual([addressOf(1), addressOf(3), addressOf(5), addressOf(6)]);
    expect(result.sent).toBe(4);
    const pending = w.backend.recipients.find((r) => r.user_id === uuid(2))!;
    expect(pending.email_outcome).toBe("skipped_deleted");
  });

  it("asks the database about each batch, not once for the whole list", async () => {
    const w = makeWorld({ people: 250 });
    const m = await w.startedMessage();
    let asked = 0;
    const spied = { ...w.deps, rpcs: { ...w.backend, adminEmailEligibleRecipients: async (a: Parameters<typeof w.backend.adminEmailEligibleRecipients>[0]) => { asked += 1; return w.backend.adminEmailEligibleRecipients(a); } } };
    // the spread of a class instance drops its prototype methods, so bind the ones the runner uses
    const rpcs = {
      adminEmailEligibleRecipients: spied.rpcs.adminEmailEligibleRecipients,
      claimNotification: w.backend.claimNotification.bind(w.backend),
      markNotificationSent: w.backend.markNotificationSent.bind(w.backend),
      recordAdminMessageProgress: w.backend.recordAdminMessageProgress.bind(w.backend),
      finishAdminMessageSend: w.backend.finishAdminMessageSend.bind(w.backend),
      pauseAdminMessageSend: w.backend.pauseAdminMessageSend.bind(w.backend),
    };
    await runEmailSend({ ...w.deps, rpcs }, m.id);
    expect(asked).toBe(3);
  });

  it("a deletion requested while the send is under way is caught by the next batch", async () => {
    const w = makeWorld({ people: 150 });
    const m = await w.startedMessage();
    const late = uuid(120); // in the second batch
    const real = w.fake.provider.sendBatch.bind(w.fake.provider);
    w.deps.provider = { ...w.fake.provider, sendBatch: async (e, o) => { const r = await real(e, o); w.backend.requestDeletion(late); return r; } };
    await runEmailSend(w.deps, m.id);
    expect(w.sentAddresses()).not.toContain(addressOf(120));
    expect(w.sentAddresses()).toHaveLength(149);
  });

  it("an opted-out account is never in a batch, on the announcement stream", async () => {
    const w = makeWorld({ people: 4 });
    const m = await w.startedMessage();
    w.backend.person(uuid(3))!.prefs.email_announcements = false; // opted out between Prepare and send
    const result = await runEmailSend(w.deps, m.id);
    expect(w.sentAddresses()).not.toContain(addressOf(3));
    expect(w.backend.recipients.find((r) => r.user_id === uuid(3))!.email_outcome).toBe("skipped_opted_out");
    expect(result.sent).toBe(3);
  });

  it("an opted-out account is never in a batch, on the promotion stream (and the announcement switch does not matter there)", async () => {
    const w = makeWorld({ people: 4, kind: "promotion" });
    const m = await w.startedMessage();
    w.backend.person(uuid(2))!.prefs.email_promotions = false;
    w.backend.person(uuid(3))!.prefs.email_announcements = false; // a different stream: still receives a promotion
    await runEmailSend(w.deps, m.id);
    expect(w.sentAddresses()).not.toContain(addressOf(2));
    expect(w.sentAddresses()).toContain(addressOf(3));
  });

  it("an unconfirmed address, a QA account and a blank address are never in a batch", async () => {
    const w = makeWorld({ people: 5 });
    const m = await w.startedMessage();
    w.backend.person(uuid(1))!.emailConfirmed = false;
    w.backend.person(uuid(2))!.isQa = true;
    w.backend.person(uuid(3))!.emailPresent = false;
    const result = await runEmailSend(w.deps, m.id);
    expect(w.sentAddresses().sort()).toEqual([addressOf(4), addressOf(5)]);
    expect(result).toMatchObject({ sent: 2, skipped: 3 });
    expect([1, 2, 3].map((i) => w.backend.recipients.find((r) => r.user_id === uuid(i))!.email_outcome)).toEqual(["skipped_inactive", "skipped_inactive", "skipped_inactive"]);
  });

  it("the whole batch is recorded: the message's counts add up to its audience", async () => {
    const w = makeWorld({ people: 6 });
    const m = await w.startedMessage();
    w.backend.requestDeletion(uuid(2));
    w.backend.person(uuid(5))!.prefs.email_announcements = false;
    await runEmailSend(w.deps, m.id);
    const row = w.backend.messages.find((x) => x.id === m.id)!;
    expect([row.sent_count, row.failed_count, row.skipped_count]).toEqual([4, 0, 2]);
    expect(row.status).toBe("sent");
  });
});

describe("the daily cap and the monthly ceiling", () => {
  it("cap reached stops the send and leaves the rest queued", async () => {
    const w = makeWorld({ people: 10, cap: 3 });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "paused_email_cap", reason: "cap_24h", sent: 3, remainingQueued: 7 });
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("paused_email_cap");
    expect(w.sentAddresses()).toHaveLength(3); // the provider saw no 4th email
    expect(w.queuedCount(m.id)).toBe(7);
    expect(w.outcomes(m.id).filter((o) => o === "sent")).toHaveLength(3);
    expect(w.outcomes(m.id).filter((o) => o === null)).toHaveLength(7); // none dropped, none marked failed
    // a retry run does not send either
    const again = await runEmailSend(w.deps, m.id);
    expect(again.status).toBe("not_sending");
    expect(w.sentAddresses()).toHaveLength(3);
    expect(w.fake.requests).toHaveLength(1);
  });

  it("the cap stops mid-batch: what was claimed is sent, the rest of the batch stays queued", async () => {
    const w = makeWorld({ people: 5, cap: 2 });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    expect(w.fake.requests.map((r) => r.emails.length)).toEqual([2]);
    expect(w.queuedCount(m.id)).toBe(3);
  });

  it("the monthly ceiling pauses sending", async () => {
    const w = makeWorld({ people: 4, ceiling: 5 });
    const first = await w.startedMessage();
    expect((await runEmailSend(w.deps, first.id)).status).toBe("finished"); // 4 of the 5
    const second = await w.startedMessage();
    const result = await runEmailSend(w.deps, second.id);
    expect(result).toMatchObject({ status: "paused_email_ceiling", reason: "ceiling_month", sent: 1, remainingQueued: 3 });
    expect(w.backend.messages.find((x) => x.id === second.id)!.status).toBe("paused_email_ceiling");
    expect(w.sentAddresses()).toHaveLength(5); // nothing was sent anyway
    expect(w.queuedCount(second.id)).toBe(3);
  });

  it("the cap counts a rolling 24 hours, not a calendar day", async () => {
    const w = makeWorld({ people: 4, cap: 4, start: new Date("2026-10-26T23:00:00Z") });
    const first = await w.startedMessage();
    expect((await runEmailSend(w.deps, first.id)).sent).toBe(4);
    w.backend.setNow(new Date("2026-10-27T00:30:00Z")); // the next calendar day, 90 minutes later
    const second = await w.startedMessage();
    const refused = await runEmailSend(w.deps, second.id);
    expect(refused).toMatchObject({ status: "paused_email_cap", sent: 0 });
    expect(w.queuedCount(second.id)).toBe(4);
    w.backend.setNow(new Date("2026-10-27T23:01:00Z")); // more than 24 hours after the first four
    await w.backend.resumeAdminMessageSend({ p_message: second.id, p_actor: CREATOR });
    const allowed = await runEmailSend(w.deps, second.id);
    expect(allowed).toMatchObject({ status: "finished", sent: 4 });
  });

  it("the ceiling counts the UTC calendar month and starts again on the 1st", async () => {
    const w = makeWorld({ people: 3, ceiling: 3, start: new Date("2026-10-31T23:50:00Z") });
    const october = await w.startedMessage();
    expect((await runEmailSend(w.deps, october.id)).sent).toBe(3);
    w.backend.setNow(new Date("2026-10-31T23:59:00Z"));
    const stillOctober = await w.startedMessage();
    expect(await runEmailSend(w.deps, stillOctober.id)).toMatchObject({ status: "paused_email_ceiling", sent: 0 });
    // the next UTC month: a new count. (The 24-hour cap is high here, so only the month decides.)
    w.backend.setNow(new Date("2026-11-01T00:01:00Z"));
    await w.backend.resumeAdminMessageSend({ p_message: stillOctober.id, p_actor: CREATOR });
    expect(await runEmailSend(w.deps, stillOctober.id)).toMatchObject({ status: "finished", sent: 3 });
  });

  it("raising the cap in the setting lets a resumed message continue, and raising it alone resumes nothing", async () => {
    const w = makeWorld({ people: 10, cap: 3 });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id);
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("paused_email_cap");
    await w.backend.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 50, p_actor: SUPER });
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("paused_email_cap"); // raising a limit never resumes a send
    expect((await runEmailSend(w.deps, m.id)).status).toBe("not_sending");
    expect(w.sentAddresses()).toHaveLength(3);
    await w.backend.resumeAdminMessageSend({ p_message: m.id, p_actor: CREATOR });
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "finished", sent: 7 });
    expect(w.sentAddresses()).toHaveLength(10);
    expect(new Set(w.sentAddresses()).size).toBe(10); // nobody twice
  });

  it("the cap and ceiling settings change only for a Super Admin, and each change is logged", async () => {
    const w = makeWorld({ people: 1 });
    await expect(w.backend.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 10, p_actor: CREATOR })).rejects.toMatchObject({ info: { code: "permission_denied" } });
    await expect(w.backend.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 10, p_actor: APPROVER })).rejects.toMatchObject({ info: { code: "permission_denied" } });
    expect(w.backend.settingChanges).toHaveLength(0);
    await w.backend.setNotificationSetting({ p_key: "mass_email_cap_24h", p_value: 10, p_actor: SUPER });
    expect(w.backend.settingChanges).toHaveLength(1);
    expect(w.backend.settingChanges[0]).toMatchObject({ key: "mass_email_cap_24h", old_value: 1000, new_value: 10, actor_email: "super.operator@example.test", actor_admin_id: SUPER });
  });
});

describe("an open email claim is never released by the sender, and a retry skips it (Fix 2)", () => {
  it("a stale claim stays open however many times the send is run, and its owner is not mailed again", async () => {
    const w = makeWorld({ people: 3, script: [{ kind: "unknown" }] });
    const m = await w.startedMessage();
    await runEmailSend(w.deps, m.id); // outcome unknown: three open claims
    w.backend.advance(5 * 3600_000);
    const before = w.fake.requests.length;
    for (let i = 0; i < 3; i++) {
      const result = await runEmailSend(w.deps, m.id);
      expect(result).toMatchObject({ status: "held_open_claims", sent: 0, heldByOpenClaim: 3 });
    }
    expect(w.fake.requests.length).toBe(before); // the retries made no request
    expect(w.backend.deliveries).toHaveLength(3);
    expect(w.backend.deliveries.every((d) => d.released_at === null)).toBe(true);
    expect(w.outcomes(m.id)).toEqual([null, null, null]);
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("sending"); // not finished while claims are open
  });
});

describe("the flags are checked before every batch", () => {
  it.each([
    ["admin_email", NOTIFICATION_FLAGS.adminEmail],
    ["admin_messaging", NOTIFICATION_FLAGS.adminMessaging],
    ["the master switch", NOTIFICATION_FLAGS.master],
  ])("with %s off no email goes out and nobody is claimed", async (_name, key) => {
    const w = makeWorld({ people: 3 });
    const m = await w.startedMessage();
    w.setFlag(key, false);
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_flag", sent: 0 });
    expect(w.fake.requests).toHaveLength(0);
    expect(w.backend.deliveries).toHaveLength(0);
  });

  it("a promotion needs admin_promotions as well; an announcement does not", async () => {
    const promo = makeWorld({ people: 2, kind: "promotion" });
    const pm = await promo.startedMessage();
    promo.setFlag(NOTIFICATION_FLAGS.adminPromotions, false);
    expect((await runEmailSend(promo.deps, pm.id)).status).toBe("stopped_flag");
    expect(promo.fake.requests).toHaveLength(0);

    const note = makeWorld({ people: 2 });
    const nm = await note.startedMessage();
    note.setFlag(NOTIFICATION_FLAGS.adminPromotions, false);
    expect((await runEmailSend(note.deps, nm.id)).status).toBe("finished");
  });

  it("a flag switched off after the first batch stops the second, which is never claimed or sent", async () => {
    const w = makeWorld({ people: 150 });
    const m = await w.startedMessage();
    const real = w.fake.provider.sendBatch.bind(w.fake.provider);
    w.deps.provider = { ...w.fake.provider, sendBatch: async (e, o) => { const r = await real(e, o); w.setFlag(NOTIFICATION_FLAGS.adminEmail, false); return r; } };
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ status: "stopped_flag", sent: 100 });
    expect(w.fake.requests).toHaveLength(1);
    expect(w.backend.deliveries).toHaveLength(100);
    expect(w.queuedCount(m.id)).toBe(50);
  });

  it("a flag that cannot be read counts as off", async () => {
    const w = makeWorld({ people: 2 });
    const m = await w.startedMessage();
    w.deps.flags = async () => { throw new Error("database unreachable"); };
    expect((await runEmailSend(w.deps, m.id)).status).toBe("stopped_flag");
    expect(w.fake.requests).toHaveLength(0);
  });
});

describe("what it will not run", () => {
  it("a message that is not sending, an unknown message, and a message without the email channel", async () => {
    const w = makeWorld({ people: 2 });
    const draft = w.backend.addDraftMessage({ createdBy: CREATOR, channels: ["email"] });
    expect((await runEmailSend(w.deps, draft.id)).status).toBe("not_sending");
    expect((await runEmailSend(w.deps, uuid(999))).status).toBe("not_sending");
    const inapp = await w.startedMessage({ channels: ["inapp"] });
    expect((await runEmailSend(w.deps, inapp.id)).status).toBe("no_email_channel");
    expect(w.fake.requests).toHaveLength(0);
  });

  it("a message with other channels is not finished by the email runner unless asked", async () => {
    const w = makeWorld({ people: 2 });
    const m = await w.startedMessage({ channels: ["inapp", "email"] });
    const result = await runEmailSend(w.deps, m.id);
    expect(result.status).toBe("finished");
    expect(w.backend.messages.find((x) => x.id === m.id)!.status).toBe("sending");
  });
});
