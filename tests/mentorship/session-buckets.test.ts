/**
 * send-497 / S15 — "Upcoming" must mean upcoming AND paid.
 *
 * The owner's sessions page listed a 17 Sep mock interview, two weeks in the past and never paid for, as
 * "Upcoming · Awaiting payment", with no way to pay or cancel. The page's rule was "anything that is not completed,
 * cancelled or refunded is upcoming", so an unpaid booking whose slot had already started stayed there forever.
 *
 * Founder call: Upcoming shows only paid or confirmed future sessions. An unpaid booking that can still be paid sits in
 * its own "Awaiting payment" section; one whose slot has started is past. The expiry itself (a real status, the slot
 * released) and Pay / Cancel actions are the next PR, so until then the row is still `pending_payment` and its slot is
 * still held: NOTHING here may say the booking expired or the slot was released. The label is the plain fact, "Not paid —
 * the slot has passed". Pure rules, reached through loadModule so this compiles first.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

type Bucket = "upcoming" | "awaiting_payment" | "past";
interface Mod {
  bucketSession?: (s: { status: string; scheduledStart: string; scheduledEnd: string }, now: Date) => Bucket;
  sessionStatusLabel?: (status: string, scheduledStart: string, now: Date, side?: "mentee" | "mentor") => string;
}
const mod = () => loadModule<Mod>("@/lib/mentorship/session-buckets");
const need = <T>(fn: T | undefined, name: string): T => {
  expect(fn, `${name} must be exported from src/lib/mentorship/session-buckets.ts`).toBeTypeOf("function");
  return fn as T;
};

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (iso: string) => iso;
const session = (status: string, start: string, end: string) => ({ status, scheduledStart: at(start), scheduledEnd: at(end) });
const FUTURE = ["2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z"] as const;
const PAST = ["2026-09-17T10:00:00.000Z", "2026-09-17T11:00:00.000Z"] as const;

describe("bucketSession", () => {
  it("a paid session waiting on the mentor, in the future, is upcoming", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("awaiting_confirmation", ...FUTURE), NOW)).toBe("upcoming");
  });

  it("a confirmed future session is upcoming", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("confirmed", ...FUTURE), NOW)).toBe("upcoming");
  });

  it("a confirmed session that has started but not ended is still upcoming (the meeting link is still needed)", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("confirmed", "2026-10-01T11:30:00.000Z", "2026-10-01T12:30:00.000Z"), NOW)).toBe("upcoming");
  });

  it("a confirmed session that has ended is past", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("confirmed", ...PAST), NOW)).toBe("past");
  });

  it("an UNPAID booking whose slot is still ahead is awaiting payment, never upcoming", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("pending_payment", ...FUTURE), NOW)).toBe("awaiting_payment");
  });

  it("the owner's case: an unpaid booking two weeks in the past is PAST, not upcoming", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("pending_payment", ...PAST), NOW)).toBe("past");
  });

  it("an unpaid booking is payable only until its slot starts: at the start instant it is past", async () => {
    const { bucketSession } = await mod();
    const b = need(bucketSession, "bucketSession");
    expect(b(session("pending_payment", "2026-10-01T12:00:01.000Z", "2026-10-01T13:00:00.000Z"), NOW)).toBe("awaiting_payment");
    expect(b(session("pending_payment", "2026-10-01T12:00:00.000Z", "2026-10-01T13:00:00.000Z"), NOW)).toBe("past");
  });

  it("completed, cancelled and refunded are past whatever their dates say", async () => {
    const { bucketSession } = await mod();
    const b = need(bucketSession, "bucketSession");
    for (const status of ["completed", "cancelled_mentor_no_confirm", "refunded"]) {
      expect(b(session(status, ...FUTURE), NOW), status).toBe("past");
    }
  });

  it("a paid session still waiting on the mentor whose slot has passed is past (never a ghost in Upcoming)", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("awaiting_confirmation", ...PAST), NOW)).toBe("past");
  });

  it("an unknown status is treated as past rather than promoted to Upcoming", async () => {
    const { bucketSession } = await mod();
    expect(need(bucketSession, "bucketSession")(session("something_new", ...FUTURE), NOW)).toBe("past");
  });
});

describe("sessionStatusLabel", () => {
  it("keeps the existing wording for every state that is not an expired unpaid booking", async () => {
    const { sessionStatusLabel } = await mod();
    const l = need(sessionStatusLabel, "sessionStatusLabel");
    expect(l("pending_payment", FUTURE[0], NOW)).toBe("Awaiting payment");
    expect(l("awaiting_confirmation", FUTURE[0], NOW)).toBe("Waiting on the mentor to confirm");
    expect(l("confirmed", FUTURE[0], NOW)).toBe("Confirmed");
    expect(l("completed", PAST[0], NOW)).toBe("Completed");
    expect(l("cancelled_mentor_no_confirm", PAST[0], NOW)).toBe("Cancelled — mentor didn't confirm in time");
    expect(l("refunded", PAST[0], NOW)).toBe("Refunded");
  });

  it("an unpaid booking whose slot has started says so plainly, and never claims it expired or the slot was released", async () => {
    const { sessionStatusLabel } = await mod();
    const label = need(sessionStatusLabel, "sessionStatusLabel")("pending_payment", PAST[0], NOW);
    expect(label).toBe("Not paid — the slot has passed");
    expect(label).not.toMatch(/expire|releas|cancel/i);
  });

  it("the mentor's side words the same states from the mentor's point of view", async () => {
    const { sessionStatusLabel } = await mod();
    const l = need(sessionStatusLabel, "sessionStatusLabel");
    expect(l("pending_payment", FUTURE[0], NOW, "mentor")).toBe("Awaiting the mentee's payment");
    expect(l("awaiting_confirmation", FUTURE[0], NOW, "mentor")).toBe("Awaiting your confirmation");
    expect(l("cancelled_mentor_no_confirm", PAST[0], NOW, "mentor")).toBe("Auto-cancelled — you didn't confirm in time");
    expect(l("pending_payment", PAST[0], NOW, "mentor")).toBe("Not paid — the slot has passed");
    expect(l("confirmed", FUTURE[0], NOW, "mentor")).toBe("Confirmed");
  });

  it("an unknown status falls back to the raw status rather than blank", async () => {
    const { sessionStatusLabel } = await mod();
    expect(need(sessionStatusLabel, "sessionStatusLabel")("something_new", FUTURE[0], NOW)).toBe("something_new");
  });
});
