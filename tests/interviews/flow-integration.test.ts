/**
 * Schedule interview on a REAL database (0253 + 0256): the offer, the booking race, closed offers, the shared 20/day counter, "none of these work", and a candidate archiving their own card. Only the mail
 * provider is a recorder. Needs 0253 and 0256 applied (the migrations are the source of truth for every rule asserted here).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { createInterviewOffer } from "@/lib/interviews/offer";
import { bookInterviewSlot, reportNoneWork } from "@/lib/interviews/booking";
import { defaultBookDeps, defaultNoneWorkDeps, defaultOfferDeps } from "@/lib/interviews/deps";
import { loadBookedInterviewsFor } from "@/lib/interviews/read";
import { runInterviewNotices } from "@/lib/interviews/notices";
import { defaultNoticeDeps } from "@/lib/interviews/deps";

const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string; attachments?: Array<{ filename: string; content: string }> }>, fail: false }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({
    emails: {
      send: async (p: { to: string; subject: string; text: string; attachments?: Array<{ filename: string; content: string }> }) => {
        if (mail.fail) return { data: null, error: { message: "down" } };
        mail.sent.push(p);
        return { data: { id: "x" }, error: null };
      },
    },
  }),
}));

let employer: TestUser;
let other: TestUser;
let candA: TestUser;
let candB: TestUser;
let orgId: string;
let otherOrgId: string;
let jobId: string;
let otherJobId: string;
let appA: string;
let appB: string;
let otherApp: string;
const orgIds: string[] = [];

const day = (n: number, hour = 9) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function org(owner: TestUser, label: string) {
  const { data, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg iv ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true }).select("id").single();
  if (error || !data) throw new Error(`org: ${error?.message}`);
  orgIds.push(data.id);
  await admin.from("organization_members").insert({ organization_id: data.id, user_id: owner.id, role: "owner" });
  return data.id;
}
async function job(organizationId: string, title: string) {
  const { data, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: organizationId, company_name: "EMPLOYER-TEST Co", title, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() }).select("id").single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}
async function apply(user: TestUser, jobPostingId: string) {
  const { data, error } = await admin.from("applications").insert({ user_id: user.id, job_posting_id: jobPostingId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
  if (error || !data) throw new Error(`application: ${error?.message}`);
  return data.id;
}

const offerInput = (applicationId: string, times: string[], over: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  jobId,
  applicationId,
  userId: employer.id,
  senderEmail: employer.email,
  kind: "video",
  note: "Bring a laptop.",
  times,
  durationMinutes: 45,
  ...over,
});
const offerDeps = () => defaultOfferDeps();
const loadBookedInterviewsForIds = loadBookedInterviewsFor;

async function slotsOf(offerId: string) {
  const { data } = await admin.from("interview_slots").select("id, starts_at").eq("offer_id", offerId).order("starts_at");
  return data ?? [];
}
async function reset() {
  mail.sent.length = 0;
  mail.fail = false;
  await admin.from("interview_offers").delete().in("organization_id", [orgId, otherOrgId]);
  await admin.from("applicant_messages").delete().in("organization_id", [orgId, otherOrgId]);
  await admin.from("employer_applicant_status").delete().in("application_id", [appA, appB, otherApp]);
  await admin.from("applications").update({ stage: "applied" }).in("id", [appA, appB, otherApp]);
  await admin.from("user_notifications").delete().eq("user_id", employer.id).eq("type", "interview_none_work");
}

beforeAll(async () => {
  [employer, other, candA, candB] = await Promise.all(["iv-emp", "iv-other", "iv-cand-a", "iv-cand-b"].map((p) => createTestUser(p)));
  await admin.from("profiles").update({ first_name: "Joy", last_name: "Akindele" }).eq("id", candA.id);
  await admin.from("profiles").update({ first_name: "Tunde", last_name: "Bello" }).eq("id", candB.id);
  orgId = await org(employer, "A");
  otherOrgId = await org(other, "B");
  jobId = await job(orgId, "Growth Marketer");
  otherJobId = await job(otherOrgId, "Other role");
  appA = await apply(candA, jobId);
  appB = await apply(candB, jobId);
  otherApp = await apply(candA, otherJobId);
}, 120_000);

beforeEach(reset);

afterAll(async () => {
  await admin.from("applications").delete().in("id", [appA, appB, otherApp].filter(Boolean));
  await deleteOrgsCascade(admin, orgIds);
  await deleteTestUsers([employer, other, candA, candB].map((u) => u?.id).filter(Boolean) as string[]);
});

describe("an employer offers times", () => {
  it("creates ONE open offer with its slots, emails the candidate ONE invitation, and counts ONE unit of the shared allowance", async () => {
    const result = await createInterviewOffer(offerInput(appA, [day(5), day(6)]), offerDeps());
    expect(result).toMatchObject({ ok: true });
    const offerId = (result as { offerId: string }).offerId;
    expect(await slotsOf(offerId)).toHaveLength(2);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(candA.email);
    expect(mail.sent[0].text).toContain(`/interviews/${offerId}`);
    const { data: units } = await admin.from("applicant_messages").select("kind, status").eq("organization_id", orgId);
    expect(units).toEqual([{ kind: "interview_invite", status: "claimed" }]);
  });

  it("a second open offer for the same application is refused and spends nothing", async () => {
    await createInterviewOffer(offerInput(appA, [day(5), day(6)]), offerDeps());
    mail.sent.length = 0;
    const second = await createInterviewOffer(offerInput(appA, [day(7), day(8)]), offerDeps());
    expect(second).toMatchObject({ ok: false, reason: "already_open" });
    expect(mail.sent).toHaveLength(0);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "failed");
    expect(count).toBe(1);
  });

  it("an applicant on ANOTHER organisation's job cannot be invited by this one", async () => {
    const result = await createInterviewOffer(offerInput(otherApp, [day(5), day(6)]), offerDeps());
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const viaMyJob = await createInterviewOffer({ ...offerInput(otherApp, [day(5), day(6)]), jobId }, offerDeps());
    expect(viaMyJob).toMatchObject({ ok: false });
    expect(mail.sent).toHaveLength(0);
  });

  it("if the invitation email cannot be sent the unit is freed (the day's count is unchanged) and the offer stays", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mail.fail = true;
    const result = await createInterviewOffer(offerInput(appA, [day(5), day(6)]), offerDeps());
    expect(result).toMatchObject({ ok: false, reason: "send_failed" });
    const { data: units } = await admin.from("applicant_messages").select("status").eq("organization_id", orgId);
    expect(units).toEqual([{ status: "failed" }]);
    const { count } = await admin.from("interview_offers").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    expect(count).toBe(1);
    vi.restoreAllMocks();
  });

  it("handing a unit back only ever touches a CLAIMED row: a message already sent keeps its slot", async () => {
    const { data: row } = await admin.from("applicant_messages").insert({ organization_id: orgId, sender_user_id: employer.id, kind: "custom", subject: "s", body: "b", status: "sent" }).select("id").single();
    await defaultOfferDeps().freeUnit(row!.id);
    const { data } = await admin.from("applicant_messages").select("status").eq("id", row!.id).single();
    expect(data?.status).toBe("sent");
  });

  it("the 21st invitation of the day is refused and creates nothing (the 20 are shared with messages)", async () => {
    const rows = Array.from({ length: 19 }, () => ({ organization_id: orgId, sender_user_id: employer.id, kind: "custom", subject: "s", body: "b", status: "sent" }));
    await admin.from("applicant_messages").insert(rows);
    expect(await createInterviewOffer(offerInput(appA, [day(5), day(6)]), offerDeps())).toMatchObject({ ok: true });
    const refused = await createInterviewOffer(offerInput(appB, [day(5), day(6)]), offerDeps());
    expect(refused).toMatchObject({ ok: false, reason: "limit" });
    const { count } = await admin.from("interview_offers").select("id", { count: "exact", head: true }).eq("application_id", appB);
    expect(count ?? 0).toBe(0);
  });
});

describe("the candidate books", () => {
  async function offerFor(app: string, times: string[]) {
    const result = await createInterviewOffer(offerInput(app, times), offerDeps());
    const offerId = (result as { offerId: string }).offerId;
    return { offerId, slots: await slotsOf(offerId) };
  }

  it("books one time: the application moves to 'interviewing', the employer's status to 'interviewing', and BOTH people get a confirmation with a calendar file", async () => {
    const { slots } = await offerFor(appA, [day(5), day(6)]);
    mail.sent.length = 0;
    const result = await bookInterviewSlot({ userId: candA.id, slotId: slots[0].id, timeZone: "Europe/London" }, defaultBookDeps());
    expect(result).toMatchObject({ ok: true });
    const { data: application } = await admin.from("applications").select("stage").eq("id", appA).single();
    expect(application?.stage).toBe("interviewing");
    const { data: status } = await admin.from("employer_applicant_status").select("status").eq("application_id", appA).single();
    expect(status?.status).toBe("interviewing");
    expect(mail.sent.map((m) => m.to).sort()).toEqual([candA.email, employer.email].sort());
    for (const m of mail.sent) expect(m.attachments?.[0].filename).toBe("interview.ics");
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "failed");
    expect(count, "booking and confirmations use no allowance").toBe(1);
  });

  it("TWO-TAB RACE: two applicants offered the SAME time for one job, both pressing at once: exactly ONE booking, the other is told 'That time was just taken'", async () => {
    const shared = day(5);
    const a = await offerFor(appA, [shared, day(6)]);
    const b = await offerFor(appB, [shared, day(7)]);
    mail.sent.length = 0;
    const [one, two] = await Promise.all([
      bookInterviewSlot({ userId: candA.id, slotId: a.slots.find((s) => new Date(s.starts_at).toISOString() === shared)!.id, timeZone: "Africa/Lagos" }, defaultBookDeps()),
      bookInterviewSlot({ userId: candB.id, slotId: b.slots.find((s) => new Date(s.starts_at).toISOString() === shared)!.id, timeZone: "Africa/Lagos" }, defaultBookDeps()),
    ]);
    const results = [one, two];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok)!;
    expect(loser).toMatchObject({ ok: false, reason: "slot_taken" });
    expect((loser as { message: string }).message).toContain("That time was just taken");
    const { count } = await admin.from("interview_bookings").select("id", { count: "exact", head: true }).eq("job_posting_id", jobId).eq("status", "booked");
    expect(count).toBe(1);
    expect(mail.sent, "only the winner's two confirmations go out").toHaveLength(2);
  });

  it("the same applicant pressing two DIFFERENT times of one offer at once: one booking", async () => {
    const { slots } = await offerFor(appA, [day(5), day(6)]);
    const results = await Promise.all(slots.map((s) => bookInterviewSlot({ userId: candA.id, slotId: s.id, timeZone: "Africa/Lagos" }, defaultBookDeps())));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { count } = await admin.from("interview_bookings").select("id", { count: "exact", head: true }).eq("application_id", appA).eq("status", "booked");
    expect(count).toBe(1);
  });

  it("nobody can book a slot on someone else's invitation, and an id that is not a slot of any offer books nothing", async () => {
    const { slots } = await offerFor(appA, [day(5), day(6)]);
    expect(await bookInterviewSlot({ userId: candB.id, slotId: slots[0].id, timeZone: "Africa/Lagos" }, defaultBookDeps())).toMatchObject({ ok: false, reason: "not_found" });
    expect(await bookInterviewSlot({ userId: candA.id, slotId: randomUUID(), timeZone: "Africa/Lagos" }, defaultBookDeps())).toMatchObject({ ok: false, reason: "not_found" });
    const { count } = await admin.from("interview_bookings").select("id", { count: "exact", head: true }).in("application_id", [appA, appB]);
    expect(count ?? 0).toBe(0);
  });

  it("once the employer marks the applicant 'not a fit' (or 'hired') the offer is closed: booking is refused", async () => {
    const { slots } = await offerFor(appA, [day(5), day(6)]);
    await admin.from("employer_applicant_status").upsert({ application_id: appA, status: "not_a_fit" });
    expect(await bookInterviewSlot({ userId: candA.id, slotId: slots[0].id, timeZone: "Africa/Lagos" }, defaultBookDeps())).toMatchObject({ ok: false, reason: "closed" });
    await admin.from("employer_applicant_status").upsert({ application_id: appA, status: "hired" });
    expect(await bookInterviewSlot({ userId: candA.id, slotId: slots[1].id, timeZone: "Africa/Lagos" }, defaultBookDeps())).toMatchObject({ ok: false, reason: "closed" });
  });

  it("the Job Tracker line comes from the BOOKING: only the candidate's own booked interview appears, a cancelled one does not, and another person's ids return nothing", async () => {
    const { offerId, slots } = await offerFor(appA, [day(5), day(6)]);
    expect((await loadBookedInterviewsForIds(candA.id, [appA])).size, "an offer alone is not a booking").toBe(0);
    await bookInterviewSlot({ userId: candA.id, slotId: slots[0].id, timeZone: "Africa/Lagos" }, defaultBookDeps());
    const own = await loadBookedInterviewsForIds(candA.id, [appA, appB]);
    expect([...own.keys()]).toEqual([appA]);
    expect(own.get(appA)).toEqual({ startsAt: new Date(slots[0].starts_at).toISOString(), offerId });
    expect((await loadBookedInterviewsForIds(candB.id, [appA])).size, "someone else's application id returns nothing").toBe(0);
    await admin.from("employer_applicant_status").upsert({ application_id: appA, status: "not_a_fit" });
    expect((await loadBookedInterviewsForIds(candA.id, [appA])).size, "a cancelled interview is not shown").toBe(0);
  });

  it("a BOOKED interview survives the candidate archiving their own tracker card: nothing is cancelled", async () => {
    const { slots } = await offerFor(appA, [day(5), day(6)]);
    await bookInterviewSlot({ userId: candA.id, slotId: slots[0].id, timeZone: "Africa/Lagos" }, defaultBookDeps());
    await admin.from("applications").update({ stage: "archived" }).eq("id", appA);
    const { data } = await admin.from("interview_bookings").select("status").eq("application_id", appA);
    expect(data).toEqual([{ status: "booked" }]);
  });

  it("when the employer marks a booked applicant 'not a fit', the booking is cancelled and the time is free for others", async () => {
    const shared = day(5);
    const a = await offerFor(appA, [shared, day(6)]);
    await bookInterviewSlot({ userId: candA.id, slotId: a.slots.find((s) => new Date(s.starts_at).toISOString() === shared)!.id, timeZone: "Africa/Lagos" }, defaultBookDeps());
    await admin.from("employer_applicant_status").upsert({ application_id: appA, status: "not_a_fit" });
    const { data } = await admin.from("interview_bookings").select("status, cancel_reason").eq("application_id", appA);
    expect(data).toEqual([{ status: "cancelled", cancel_reason: "not_a_fit" }]);
    const b = await offerFor(appB, [shared, day(7)]);
    expect(await bookInterviewSlot({ userId: candB.id, slotId: b.slots.find((s) => new Date(s.starts_at).toISOString() === shared)!.id, timeZone: "Africa/Lagos" }, defaultBookDeps())).toMatchObject({ ok: true });
  });
});

describe("'None of these times work'", () => {
  it("notes it for the employer who made the offer and emails them ONCE, however often it is pressed; it uses no allowance and leaves the offer open", async () => {
    const result = await createInterviewOffer(offerInput(appA, [day(5), day(6)]), offerDeps());
    const offerId = (result as { offerId: string }).offerId;
    mail.sent.length = 0;
    expect(await reportNoneWork({ userId: candA.id, offerId }, defaultNoneWorkDeps())).toEqual({ ok: true });
    expect(await reportNoneWork({ userId: candA.id, offerId }, defaultNoneWorkDeps())).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(employer.email);
    const { count } = await admin.from("user_notifications").select("id", { count: "exact", head: true }).eq("user_id", employer.id).eq("type", "interview_none_work");
    expect(count).toBe(1);
    const { count: units } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "failed");
    expect(units, "still only the one invitation counted").toBe(1);
    const { data: offer } = await admin.from("interview_offers").select("status").eq("id", offerId).single();
    expect(offer?.status).toBe("open");
  });

  it("another candidate cannot say it on someone else's offer", async () => {
    const result = await createInterviewOffer(offerInput(appA, [day(5), day(6)]), offerDeps());
    mail.sent.length = 0;
    expect(await reportNoneWork({ userId: candB.id, offerId: (result as { offerId: string }).offerId }, defaultNoneWorkDeps())).toMatchObject({ ok: false, reason: "not_found" });
    expect(mail.sent).toHaveLength(0);
  });
});

describe("the scheduled emails (reminder 24h before, ONE neutral cancellation notice)", () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  async function bookedIn(app: string, candidate: TestUser, hours: number) {
    const created = await createInterviewOffer(offerInput(app, [inHours(hours), inHours(hours + 24)]), offerDeps());
    const offerId = (created as { offerId: string }).offerId;
    const slots = await slotsOf(offerId);
    await bookInterviewSlot({ userId: candidate.id, slotId: slots[0].id, timeZone: "Africa/Lagos" }, defaultBookDeps());
    mail.sent.length = 0;
    return offerId;
  }

  it("sends the reminder to BOTH people exactly once, however many runs, and uses no allowance", async () => {
    await bookedIn(appA, candA, 24);
    const first = await runInterviewNotices(defaultNoticeDeps());
    expect(first).toMatchObject({ ok: true, remindersClaimed: 1, remindersSent: 2 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual([candA.email, employer.email].sort());
    expect(mail.sent.every((m) => /Reminder: your interview/.test(m.subject))).toBe(true);
    mail.sent.length = 0;
    expect(await runInterviewNotices(defaultNoticeDeps())).toMatchObject({ remindersClaimed: 0, remindersSent: 0 });
    expect(mail.sent).toHaveLength(0);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).neq("status", "failed");
    expect(count, "only the invitation counted").toBe(1);
  });

  it("two overlapping runs send the reminder once between them", async () => {
    await bookedIn(appA, candA, 24);
    const [one, two] = await Promise.all([runInterviewNotices(defaultNoticeDeps()), runInterviewNotices(defaultNoticeDeps())]);
    expect(one.remindersClaimed + two.remindersClaimed).toBe(1);
    expect(mail.sent).toHaveLength(2);
  });

  it("a booking outside the 23 to 25 hour window gets no reminder yet", async () => {
    await bookedIn(appA, candA, 48);
    expect(await runInterviewNotices(defaultNoticeDeps())).toMatchObject({ remindersClaimed: 0 });
    expect(mail.sent).toHaveLength(0);
  });

  it("a failed reminder send is retried by the next run (the mark is released)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await bookedIn(appA, candA, 24);
    mail.fail = true;
    expect(await runInterviewNotices(defaultNoticeDeps())).toMatchObject({ ok: false, remindersReleased: 1 });
    mail.fail = false;
    expect(await runInterviewNotices(defaultNoticeDeps())).toMatchObject({ remindersSent: 2 });
    vi.restoreAllMocks();
  });

  it("the employer marking the applicant 'not a fit' cancels the booking and the CANDIDATE gets exactly ONE neutral email, no reminder follows, and the employer is told nothing", async () => {
    await bookedIn(appA, candA, 24);
    await admin.from("employer_applicant_status").upsert({ application_id: appA, status: "not_a_fit" });
    const first = await runInterviewNotices(defaultNoticeDeps());
    expect(first).toMatchObject({ cancellationsClaimed: 1, cancellationsSent: 1, remindersClaimed: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(candA.email);
    expect(mail.sent[0].subject).toContain("has been cancelled");
    expect(mail.sent[0].text).not.toMatch(/fit|reject|unfortunately/i);
    mail.sent.length = 0;
    expect(await runInterviewNotices(defaultNoticeDeps())).toMatchObject({ cancellationsClaimed: 0 });
    expect(mail.sent).toHaveLength(0);
  });

  it("two overlapping runs send the cancellation notice once", async () => {
    await bookedIn(appA, candA, 24);
    await admin.from("employer_applicant_status").upsert({ application_id: appA, status: "not_a_fit" });
    const runs = await Promise.all([runInterviewNotices(defaultNoticeDeps()), runInterviewNotices(defaultNoticeDeps())]);
    expect(runs.reduce((n, r) => n + r.cancellationsClaimed, 0)).toBe(1);
    expect(mail.sent.filter((m) => m.to === candA.email)).toHaveLength(1);
  });
});
