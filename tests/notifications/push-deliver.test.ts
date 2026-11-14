import { describe, expect, it, vi } from "vitest";
import type { ClaimNotificationArgs, ClaimNotificationResult, PushReleaseReason, PushSendOutcome, PushTarget } from "@/lib/notifications/contract";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { deliverPush, type DeliverDeps, type DeliverRequest } from "@/lib/notifications/push/deliver";
import { FakePushSender } from "@/lib/notifications/fakes/fake-push-sender";
import { makeTarget, recordingLog } from "./push-support";

const USER = "00000000-0000-4000-8000-0000000000a1";
const request: DeliverRequest = { userId: USER, kind: "new_applicant", subject: "00000000-0000-4000-8000-0000000000b1", url: "/employer/jobs", badge: 1 };

function harness(over: Partial<DeliverDeps> & { targets?: PushTarget[]; flags?: Record<string, boolean>; claims?: Array<ClaimNotificationResult | Error>; deleting?: boolean | Error } = {}) {
  const writes: string[] = [];
  const claimed: ClaimNotificationArgs[] = [];
  const released: Array<{ id: string; reason: PushReleaseReason }> = [];
  const sentIds: string[] = [];
  const revoked: Array<{ deviceId: string; reason: string }> = [];
  const flagReads: string[] = [];
  const sender = new FakePushSender();
  const log = recordingLog();
  const targets = over.targets ?? [makeTarget()];
  const flags: Record<string, boolean> = over.flags ?? { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: true };
  let n = 0;
  const deps: DeliverDeps = {
    env: { PWA_KILL: undefined },
    flagOn: async (key) => {
      flagReads.push(key);
      return flags[key] === true;
    },
    isDeleting: async () => {
      if (over.deleting instanceof Error) throw over.deleting;
      return over.deleting === true;
    },
    loadTargets: async () => targets,
    claim: async (args) => {
      writes.push("claim");
      claimed.push(args);
      const scripted = over.claims?.[n];
      n += 1;
      if (scripted instanceof Error) throw scripted;
      return scripted ?? { id: `claim-${n}`, refused: null };
    },
    release: async (args) => {
      writes.push("release");
      released.push({ id: args.p_id, reason: args.p_reason });
    },
    markSent: async (args) => {
      writes.push("sent");
      sentIds.push(args.p_id);
    },
    revokeDevice: async (deviceId, reason) => {
      writes.push("revoke");
      revoked.push({ deviceId, reason });
    },
    sender,
    log: log.log,
    ...over,
  };
  return { deps, writes, claimed, released, sentIds, revoked, flagReads, sender, log, targets };
}
const withOutcome = (h: ReturnType<typeof harness>, outcome: PushSendOutcome) => h.sender.answerWith(outcome);

describe("a delivery", () => {
  it("claims per device on the push channel, sends, and marks the claim sent", async () => {
    const h = harness();
    const summary = await deliverPush(h.deps, request);
    expect(h.claimed).toEqual([{ p_user: USER, p_kind: "new_applicant", p_subject: request.subject, p_channel: "push", p_device: h.targets[0].deviceId }]);
    expect(h.sender.sent).toHaveLength(1);
    expect(h.sentIds).toEqual(["claim-1"]);
    expect(summary).toMatchObject({ skipped: null, devices: 1, sent: 1, released: 0, revoked: 0, stopped: false });
  });
  it("a refused claim sends nothing and writes nothing else; quiet hours are suppressed and never retried", async () => {
    const h = harness({ claims: [{ id: null, refused: "quiet_hours" }, { id: null, refused: "quiet_hours" }] });
    const summary = await deliverPush(h.deps, request);
    expect(h.sender.sent).toHaveLength(0);
    expect(h.writes).toEqual(["claim"]);
    expect(summary.suppressed).toBe(1);
    const again = await deliverPush(h.deps, request);
    expect(h.writes.filter((w) => w === "claim")).toHaveLength(2);
    expect(again.sent).toBe(0);
  });
  it("404 and 410 revoke the subscription and release the claim", async () => {
    const h = harness();
    withOutcome(h, "gone");
    const summary = await deliverPush(h.deps, request);
    expect(h.revoked).toEqual([{ deviceId: h.targets[0].deviceId, reason: "gone" }]);
    expect(h.released).toEqual([{ id: "claim-1", reason: "gone" }]);
    expect(h.sentIds).toEqual([]);
    expect(summary).toMatchObject({ revoked: 1, released: 1 });
  });
  it("401/403 do not revoke and stop the batch", async () => {
    const targets = [makeTarget(), makeTarget(), makeTarget()];
    const h = harness({ targets });
    h.sender.answerDeviceWith(targets[0].deviceId, "our_key");
    const summary = await deliverPush(h.deps, request);
    expect(h.revoked).toEqual([]);
    expect(h.released).toEqual([{ id: "claim-1", reason: "our_key" }]);
    expect(h.claimed).toHaveLength(1);
    expect(h.sender.sent).toHaveLength(0);
    expect(summary.stopped).toBe(true);
  });
  it.each([["rejected_413"], ["retries_exhausted"], ["pre_send_failure"]] as const)("%s releases the claim with that reason and does not revoke", async (reason) => {
    const h = harness();
    withOutcome(h, reason);
    await deliverPush(h.deps, request);
    expect(h.released).toEqual([{ id: "claim-1", reason }]);
    expect(h.revoked).toEqual([]);
  });
  it("an outcome the process cannot tell ('unknown') leaves the claim open: no release, no mark", async () => {
    const h = harness();
    withOutcome(h, "unknown");
    await deliverPush(h.deps, request);
    expect(h.writes).toEqual(["claim"]);
  });
  it("a claim that throws skips that device, sends nothing, and the batch goes on", async () => {
    const targets = [makeTarget(), makeTarget()];
    const h = harness({ targets, claims: [new Error("boom")] });
    const summary = await deliverPush(h.deps, request);
    expect(h.sender.sent).toHaveLength(1);
    expect(summary.sent).toBe(1);
  });
  it("a person with deletion_requested_at is skipped: nothing is read for them and nothing is written", async () => {
    const h = harness({ deleting: true });
    const summary = await deliverPush(h.deps, request);
    expect(summary.skipped).toBe("deleting");
    expect(h.writes).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
  });
  it("a deletion check that cannot be read counts as deleting (fails closed)", async () => {
    const h = harness({ deleting: new Error("db down") });
    expect((await deliverPush(h.deps, request)).skipped).toBe("deleting");
    expect(h.writes).toEqual([]);
  });
  it("a person with no devices is a clean no-op", async () => {
    const h = harness({ targets: [] });
    expect(await deliverPush(h.deps, request)).toMatchObject({ skipped: null, devices: 0, sent: 0 });
    expect(h.writes).toEqual([]);
  });
});

describe("the kill switch and the flags", () => {
  it("the sender sends nothing when PWA_KILL is 1 and writes nothing, and does not even read a flag", async () => {
    const h = harness();
    h.deps.env = { PWA_KILL: "1" };
    const summary = await deliverPush(h.deps, request);
    expect(summary.skipped).toBe("kill");
    expect(h.writes).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
    expect(h.flagReads).toEqual([]);
  });
  it("PWA_KILL is read at call time: flipping it takes effect on the next call without a new harness", async () => {
    const h = harness();
    h.deps.env = { PWA_KILL: "1" };
    expect((await deliverPush(h.deps, request)).skipped).toBe("kill");
    h.deps.env = { PWA_KILL: "0" };
    expect((await deliverPush(h.deps, request)).skipped).toBeNull();
  });
  it("with notifications_master off nothing is written and nothing is sent", async () => {
    const h = harness({ flags: { [NOTIFICATION_FLAGS.master]: false, [NOTIFICATION_FLAGS.pushSender]: true } });
    expect((await deliverPush(h.deps, request)).skipped).toBe("flag_off");
    expect(h.writes).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
  });
  it("with push_sender off no push is sent and no claim is written", async () => {
    const h = harness({ flags: { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: false } });
    expect((await deliverPush(h.deps, request)).skipped).toBe("flag_off");
    expect(h.writes).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
  });
  it("a missing flag row means off", async () => {
    const h = harness({ flags: {} });
    expect((await deliverPush(h.deps, request)).skipped).toBe("flag_off");
    expect(h.writes).toEqual([]);
  });
  it("an unreadable flag row means off: the read throws and nothing is sent or written", async () => {
    const h = harness();
    h.deps.flagOn = async () => {
      throw new Error("flag store unreachable");
    };
    const summary = await deliverPush(h.deps, request);
    expect(summary.skipped).toBe("flag_off");
    expect(h.writes).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
  });
  it("with every flag off nothing observable changes: no read of devices or the person, no write, no send, no log of device data", async () => {
    const loadTargets = vi.fn(async () => [makeTarget()]);
    const isDeleting = vi.fn(async () => false);
    const h = harness({ flags: {}, loadTargets, isDeleting });
    for (const killValue of [undefined, "1", "0"]) {
      h.deps.env = { PWA_KILL: killValue };
      await deliverPush(h.deps, request);
    }
    expect(loadTargets).not.toHaveBeenCalled();
    expect(isDeleting).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
    expect(h.sender.sent).toHaveLength(0);
    expect(h.log.events.every((e) => e.endpointHash === undefined)).toBe(true);
  });
});

describe("the delivery logs", () => {
  it("carry counts, status class, the notification id and the endpoint hash, and never the endpoint, keys or person", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const h = harness();
    withOutcome(h, "gone");
    await deliverPush(h.deps, request);
    const seen = JSON.stringify(h.log.events) + spies.map((s) => JSON.stringify(s.mock.calls)).join("");
    for (const secret of [h.targets[0].endpoint, h.targets[0].p256dh, h.targets[0].auth, USER]) expect(seen).not.toContain(secret);
    expect(h.log.events.some((e) => e.notificationId === "claim-1")).toBe(true);
    expect(h.log.events.some((e) => e.counts !== undefined)).toBe(true);
    vi.restoreAllMocks();
  });
});
