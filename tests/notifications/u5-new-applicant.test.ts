import { describe, expect, it } from "vitest";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { notifyNewApplicantWith, type NewApplicantDeps } from "@/lib/notifications/new-applicant/notify";
import { makeDeliverHarness } from "./u5-support";

const JOB = "00000000-0000-4000-8000-0000000000c1";
const ORG = "00000000-0000-4000-8000-0000000000c2";
const A1 = "00000000-0000-4000-8000-0000000000d1";
const A2 = "00000000-0000-4000-8000-0000000000d2";
const M_INSTANT_ON = "00000000-0000-4000-8000-0000000000e1";
const M_INSTANT_OFF = "00000000-0000-4000-8000-0000000000e2";
const M_DIGEST = "00000000-0000-4000-8000-0000000000e3";

type Prefs = Record<string, boolean>;
const ALL_ON: Prefs = { push_enabled: true, push_new_applicant: true, push_application_viewed: false, push_match_alert: false };

function world(over: { flags?: Record<string, boolean>; isFirst?: boolean; notice?: "none" | "row"; prefs?: Record<string, Prefs | null> } = {}) {
  const h = makeDeliverHarness();
  const inbox: Array<{ userId: string; jobId: string; applicationId: string }> = [];
  const inboxClaims = new Set<string>();
  const log: string[] = [];
  const flags = over.flags ?? { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: true };
  let isFirst = over.isFirst ?? true;
  const prefs: Record<string, Prefs | null> = over.prefs ?? { [M_INSTANT_ON]: ALL_ON, [M_INSTANT_OFF]: { ...ALL_ON, push_new_applicant: false }, [M_DIGEST]: ALL_ON };
  const deps: NewApplicantDeps = {
    flagOn: async (key) => (log.push(`flag:${key}`), flags[key] === true),
    prefs: async (userId) => (log.push("prefs"), prefs[userId] ?? null),
    deliver: async (request) => (log.push("deliver"), h.deliver(request)),
    notice: async () => (log.push("notice"), over.notice === "none" ? null : { jobId: JOB, organizationId: ORG, isFirst }),
    recipients: async () => (log.push("recipients"), [{ userId: M_INSTANT_ON, mode: "instant" }, { userId: M_INSTANT_OFF, mode: "instant" }, { userId: M_DIGEST, mode: "digest" }]),
    claimInbox: async (userId, applicationId) => {
      const key = `${userId}|${applicationId}`;
      if (inboxClaims.has(key)) return null;
      inboxClaims.add(key);
      return `inbox-${inboxClaims.size}`;
    },
    writeInbox: async (userId, jobId, applicationId) => (inbox.push({ userId, jobId, applicationId }), true),
    releaseInbox: async () => undefined,
  };
  return { deps, h, inbox, log, setFirst: (v: boolean) => void (isFirst = v) };
}

describe("a new applicant", () => {
  it("creates one inbox row per eligible recipient and a push only for the first applicant to instant recipients with the switch on", async () => {
    const w = world();
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.inbox.map((r) => r.userId).sort()).toEqual([M_INSTANT_ON, M_INSTANT_OFF, M_DIGEST].sort());
    expect(w.h.sender.sent.map((s) => s.deviceId)).toHaveLength(1);
    expect(w.h.requests).toEqual([{ userId: M_INSTANT_ON, kind: "new_applicant", subject: JOB, url: `/employer/jobs/${JOB}/applicants`, badge: null }]);
  });
  it("the same applicant announced twice still makes exactly one inbox row per recipient", async () => {
    const w = world();
    await notifyNewApplicantWith(A1, w.deps);
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.inbox).toHaveLength(3);
  });
  it("a second applicant gets inbox rows but no second push, even when the database calls it first too (the claim keyed on the job is what stops it)", async () => {
    const w = world();
    await notifyNewApplicantWith(A1, w.deps);
    await notifyNewApplicantWith(A2, w.deps); // isFirst is still true on purpose
    expect(w.inbox).toHaveLength(6);
    expect(w.h.sender.sent).toHaveLength(1);
    expect(w.h.claims.every((c) => c.p_subject === JOB)).toBe(true);
  });
  it("an applicant the database does not call first gets inbox rows and no push", async () => {
    const w = world({ isFirst: false });
    await notifyNewApplicantWith(A2, w.deps);
    expect(w.inbox).toHaveLength(3);
    expect(w.h.requests).toHaveLength(0);
  });
  it("a recipient with push_new_applicant off is not pushed, and no claim is made for them", async () => {
    const w = world({ prefs: { [M_INSTANT_ON]: { ...ALL_ON, push_new_applicant: false }, [M_INSTANT_OFF]: { ...ALL_ON, push_new_applicant: false }, [M_DIGEST]: ALL_ON } });
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.h.requests).toHaveLength(0);
    expect(w.h.claims).toHaveLength(0);
  });
  it("a recipient on 'digest' is never pushed, whatever their switches say", async () => {
    const w = world();
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.h.requests.map((r) => r.userId)).not.toContain(M_DIGEST);
  });
  it("no claim is taken before every gate has passed: with push_sender off the delivery step is never reached", async () => {
    const w = world({ flags: { [NOTIFICATION_FLAGS.master]: true, [NOTIFICATION_FLAGS.pushSender]: false } });
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.log).not.toContain("deliver");
    expect(w.h.claims).toHaveLength(0);
    expect(w.inbox).toHaveLength(3); // the inbox row does not depend on the push switch
  });
  it("an applicant with no notice row (external job, QA applicant, suppressed) notifies nobody", async () => {
    const w = world({ notice: "none" });
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.inbox).toHaveLength(0);
    expect(w.h.requests).toHaveLength(0);
  });
  it("with every flag OFF nothing is read but the flag, and nothing is written or sent", async () => {
    const w = world({ flags: {} });
    await notifyNewApplicantWith(A1, w.deps);
    expect(w.log).toEqual([`flag:${NOTIFICATION_FLAGS.master}`]);
    expect(w.inbox).toHaveLength(0);
    expect(w.h.claims).toHaveLength(0);
    expect(w.h.sender.sent).toHaveLength(0);
  });
  it("an unreadable flag means off", async () => {
    const w = world();
    w.deps.flagOn = async () => {
      throw new Error("flag store down");
    };
    await expect(notifyNewApplicantWith(A1, w.deps)).resolves.toBeUndefined();
    expect(w.inbox).toHaveLength(0);
  });
  it("it never throws: a sender that throws, a failing inbox write and a failing recipient read change nothing for the caller", async () => {
    const a = world();
    a.deps.deliver = async () => {
      throw new Error("sender exploded");
    };
    await expect(notifyNewApplicantWith(A1, a.deps)).resolves.toBeUndefined();
    const b = world();
    b.deps.writeInbox = async () => {
      throw new Error("insert failed");
    };
    await expect(notifyNewApplicantWith(A1, b.deps)).resolves.toBeUndefined();
    const c = world();
    c.deps.recipients = async () => {
      throw new Error("rpc failed");
    };
    await expect(notifyNewApplicantWith(A1, c.deps)).resolves.toBeUndefined();
  });
  it("a failed inbox write hands the inbox claim back, so a retry can write the row", async () => {
    const w = world();
    const released: string[] = [];
    w.deps.writeInbox = async () => false;
    w.deps.releaseInbox = async (id) => void released.push(id);
    await notifyNewApplicantWith(A1, w.deps);
    expect(released).toHaveLength(3);
  });
});
