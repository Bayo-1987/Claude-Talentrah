/**
 * Schedule interview (0253) through the real UI: the candidate's page in two time zones, booking, the loser of a race, someone else's invitation, and the employer's form with its overlap warning. Offers are
 * created through the database function (the invitation EMAIL is covered on a real database in tests/interviews; the test app has no mail key).
 *
 * EVERY TIME IN THIS FILE IS COMPUTED FROM THE CLOCK, by `at()` below. create_interview_offer (migration 0253) refuses a time earlier than now + 1 hour or later than now + 60 days, so a hard-coded date turns
 * this spec red the day it passes (it did, on 20 Oct 2026). The deterministic check of the UK clock change (BST before Sunday 25 Oct 2026, GMT after, against Lagos) used to live in the first test here with fixed
 * dates; it cannot live in a flow that must offer times within 60 days of "now", so it is tests/interviews/format-clock-change.test.ts (fixed dates, explicit zones, no database).
 *
 * E2E_DATE_SHIFT_DAYS=30 moves every time 30 days later: the proof that nothing in here depends on today's date.
 */
import { test, expect, admin, mintSecondSession } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const SHIFT_DAYS = Number(process.env.E2E_DATE_SHIFT_DAYS ?? 0);

/** The one place dates are made: `daysFromToday` days after today (UTC) at hh:mm UTC, plus E2E_DATE_SHIFT_DAYS. Refuses a result outside the window the offer function accepts, with room to spare. */
function at(daysFromToday: number, hourUtc = 9, minuteUtc = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday + SHIFT_DAYS);
  d.setUTCHours(hourUtc, minuteUtc, 0, 0);
  const ahead = d.getTime() - Date.now();
  if (ahead < 2 * 3_600_000 || ahead > 55 * 86_400_000) throw new Error(`test time ${d.toISOString()} is outside the offer window (now + 1 hour to now + 60 days); lower E2E_DATE_SHIFT_DAYS or the day offset`);
  return d;
}
/** "YYYY-MM-DDTHH:MM:SSZ": the form the offer function and the assertions use. */
const iso = (d: Date): string => d.toISOString().replace(".000Z", "Z");
/** "YYYY-MM-DDTHH:MM:SS.000Z": what the database hands back. */
const isoMs = (d: Date): string => d.toISOString();
/** What a datetime-local input takes. */
const inputValue = (d: Date): string => d.toISOString().slice(0, 16);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * What the candidate's page should say for a stored time in a zone, worked out here from Intl, not from the app's own formatter: "Sat 24 Oct at 10:00 to 10:45 WAT". Lagos is UTC+1 all year (WAT); London is BST
 * (UTC+1) or GMT (UTC+0) depending on the date, so the same stored time reads 10:00 in both on one side of the UK clock change and 10:00 in Lagos but 09:00 in London on the other.
 */
function expectedRange(start: Date, minutes: number, timeZone: "Africa/Lagos" | "Europe/London"): RegExp {
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
    const n = (t: string) => Number(f.find((p) => p.type === t)!.value);
    return { y: n("year"), m: n("month"), d: n("day"), hh: String(n("hour")).padStart(2, "0"), mm: String(n("minute")).padStart(2, "0") };
  };
  const a = parts(start);
  const b = parts(new Date(start.getTime() + minutes * 60_000));
  const weekday = WEEKDAYS[new Date(Date.UTC(a.y, a.m - 1, a.d)).getUTCDay()];
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(start).find((p) => p.type === "timeZoneName")!.value;
  const abbreviation = timeZone === "Africa/Lagos" ? "WAT" : offset === "GMT+1" ? "BST" : "GMT";
  return new RegExp(`${weekday} ${a.d} ${MONTHS[a.m - 1]} at ${a.hh}:${a.mm} to ${b.hh}:${b.mm} ${abbreviation}`);
}

test.describe("schedule interview", () => {
  const orgIds: string[] = [];
  const users: string[] = [];

  test.afterEach(async () => {
    if (orgIds.length) await deleteOrgsCascade(admin, orgIds.splice(0));
    for (const id of users.splice(0)) await admin.auth.admin.deleteUser(id);
  });

  async function user(label: string, first: string, last: string) {
    const email = `e2e-iv-${label}-${randomUUID().slice(0, 8)}@talentrah.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`user: ${error?.message}`);
    users.push(data.user.id);
    await admin.from("profiles").update({ first_name: first, last_name: last }).eq("id", data.user.id);
    return { id: data.user.id, email };
  }

  async function org(ownerId: string, label: string) {
    const { data, error } = await admin.from("organizations").insert({ name: `E2E Employer Co iv ${label} ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true }).select("id, name").single();
    if (error || !data) throw new Error(`org: ${error?.message}`);
    orgIds.push(data.id);
    await admin.from("organization_members").insert({ organization_id: data.id, user_id: ownerId, role: "owner" });
    return data;
  }

  async function job(organizationId: string, title: string) {
    const { data, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: organizationId, company_name: "E2E Co", title, description: "E2E fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() }).select("id").single();
    if (error || !data) throw new Error(`job: ${error?.message}`);
    return data.id;
  }

  async function apply(userId: string, jobId: string) {
    const { data, error } = await admin.from("applications").insert({ user_id: userId, job_posting_id: jobId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
    if (error || !data) throw new Error(`application: ${error?.message}`);
    return data.id;
  }

  async function offer(employerId: string, applicationId: string, slots: string[]) {
    const { data, error } = await admin.rpc("create_interview_offer", { p_user: employerId, p_application: applicationId, p_kind: "video", p_note: "Bring a laptop.", p_slots: slots.map((s) => ({ starts_at: s, duration_minutes: 45 })) });
    if (error || !data?.[0]?.ok) throw new Error(`offer: ${error?.message ?? data?.[0]?.outcome}`);
    const { data: slotRows } = await admin.from("interview_slots").select("id, starts_at").eq("offer_id", data[0].offer_id).order("starts_at");
    return { offerId: data[0].offer_id as string, slots: slotRows ?? [] };
  }

  async function candidatePage(browser: import("@playwright/test").Browser, baseURL: string | undefined, candidate: { id: string; email: string }, timezoneId: string) {
    const cookie = await mintSecondSession(candidate);
    const url = new URL(baseURL ?? "http://localhost:3000");
    const context = await browser.newContext({ timezoneId, locale: "en-GB" });
    await context.addCookies([{ name: cookie.name, value: cookie.value, domain: url.hostname, path: "/", httpOnly: false, secure: url.protocol === "https:", sameSite: "Lax" }]);
    return { context, page: await context.newPage() };
  }

  test("the candidate's page shows each offered time in the browser's own zone: Lagos (UTC+1 all year) and London (BST or GMT, whichever applies on that date)", async ({ browser, baseURL, testUser }) => {
    const mine = await org(testUser.id, "tz");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("tz", "Joy", "Akindele");
    const applicationId = await apply(joy.id, jobId);
    const first = at(3);
    const second = at(5);
    const { offerId } = await offer(testUser.id, applicationId, [iso(first), iso(second)]);

    const lagos = await candidatePage(browser, baseURL, joy, "Africa/Lagos");
    await lagos.page.goto(`/interviews/${offerId}`);
    await expect(lagos.page.getByText(expectedRange(first, 45, "Africa/Lagos"))).toBeVisible();
    await expect(lagos.page.getByText(expectedRange(second, 45, "Africa/Lagos"))).toBeVisible();
    await lagos.context.close();

    const london = await candidatePage(browser, baseURL, joy, "Europe/London");
    await london.page.goto(`/interviews/${offerId}`);
    await expect(london.page.getByText(expectedRange(first, 45, "Europe/London"))).toBeVisible();
    await expect(london.page.getByText(expectedRange(second, 45, "Europe/London"))).toBeVisible();
    await london.context.close();
  });

  test("a candidate books a time and sees it scheduled; the application moves to interviewing", async ({ browser, baseURL, testUser }) => {
    const mine = await org(testUser.id, "book");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("book", "Joy", "Akindele");
    const applicationId = await apply(joy.id, jobId);
    const first = at(3);
    const { slots } = await offer(testUser.id, applicationId, [iso(first), iso(at(5))]);
    const { context, page } = await candidatePage(browser, baseURL, joy, "Europe/London");
    await page.goto(`/interviews/${(await admin.from("interview_slots").select("offer_id").eq("id", slots[0].id).single()).data!.offer_id}`);
    await page.getByRole("button", { name: "Book this time" }).first().click();
    await expect(page.getByText("Interview scheduled")).toBeVisible({ timeout: 15_000 });
    const { data: booking } = await admin.from("interview_bookings").select("status, starts_at").eq("application_id", applicationId).single();
    expect(booking?.status).toBe("booked");
    expect(new Date(booking!.starts_at).toISOString()).toBe(isoMs(first));
    const { data: app } = await admin.from("applications").select("stage").eq("id", applicationId).single();
    expect(app?.stage).toBe("interviewing");
    await context.close();
  });

  test("the loser of a race is told 'That time was just taken' and sees the times that remain", async ({ browser, baseURL, testUser }) => {
    const mine = await org(testUser.id, "race");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("race-a", "Joy", "Akindele");
    const tunde = await user("race-b", "Tunde", "Bello");
    const appJoy = await apply(joy.id, jobId);
    const appTunde = await apply(tunde.id, jobId);
    const sharedTime = at(3);
    const shared = iso(sharedTime);
    const a = await offer(testUser.id, appJoy, [shared, iso(at(4))]);
    const b = await offer(testUser.id, appTunde, [shared, iso(at(5))]);

    const { context, page } = await candidatePage(browser, baseURL, joy, "Africa/Lagos");
    await page.goto(`/interviews/${a.offerId}`);
    await expect(page.getByRole("button", { name: "Book this time" })).toHaveCount(2);
    // Tunde takes the shared time while Joy's page is still open.
    const tundeShared = b.slots.find((s) => new Date(s.starts_at).toISOString() === isoMs(sharedTime))!;
    const taken = await admin.rpc("book_interview_slot", { p_user: tunde.id, p_slot: tundeShared.id });
    expect(taken.data?.[0]?.ok).toBe(true);

    await page.getByRole("button", { name: "Book this time" }).first().click();
    await expect(page.getByText("That time was just taken")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Book this time" }), "the page refreshes to the times Joy can still pick").toHaveCount(2);
    const { count } = await admin.from("interview_bookings").select("id", { count: "exact", head: true }).eq("job_posting_id", jobId).eq("status", "booked");
    expect(count).toBe(1);
    await context.close();
  });

  test("someone else's invitation is the not-found page", async ({ browser, baseURL, testUser }) => {
    const mine = await org(testUser.id, "own");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("own", "Joy", "Akindele");
    const intruder = await user("intruder", "Ike", "Nwosu");
    const applicationId = await apply(joy.id, jobId);
    const { offerId } = await offer(testUser.id, applicationId, [iso(at(3)), iso(at(5))]);
    const { context, page } = await candidatePage(browser, baseURL, intruder, "Africa/Lagos");
    await page.goto(`/interviews/${offerId}`);
    await expect(page.getByRole("heading", { name: "This page doesn't exist." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Book this time" })).toHaveCount(0);
    await context.close();
  });

  test("the employer's form warns about a time that overlaps a booked interview, never blocks, and an offer with the email failing still shows the waiting page", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "form");
    const job1 = await job(mine.id, "Growth Marketer");
    const job2 = await job(mine.id, "Designer");
    const joy = await user("form-a", "Joy", "Akindele");
    const tunde = await user("form-b", "Tunde", "Bello");
    const appJoy = await apply(joy.id, job1);
    const appTunde = await apply(tunde.id, job2);
    const bookedTime = at(3);
    const booked = await offer(testUser.id, appTunde, [iso(bookedTime), iso(at(4))]);
    const slot = booked.slots.find((s) => new Date(s.starts_at).toISOString() === isoMs(bookedTime))!;
    expect((await admin.rpc("book_interview_slot", { p_user: tunde.id, p_slot: slot.id })).data?.[0]?.ok).toBe(true);

    await page.goto(`/employer/jobs/${job1}/applicants/${appJoy}/schedule`);
    await expect(page.getByRole("heading", { name: "Offer interview times to Joy Akindele" })).toBeVisible();
    // 30 minutes after the booked time (09:00 UTC, 45 minutes long), entered in the browser's own zone, overlaps the booked interview.
    const local = (iso: string) => page.evaluate((v) => { const d = new Date(v); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }, iso);
    await page.getByLabel("Time 1").fill(await local(iso(at(3, 9, 30))));
    await page.getByLabel("Time 2").fill(await local(iso(at(6))));
    await expect(page.getByText("This time overlaps a booked interview for Designer. You can still offer it.")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Send invitation" }).click();
    // The test app has no mail key: the offer is created, the email cannot be sent, the employer is told, and the page now shows the open offer with a Resend button.
    await expect(page.getByText("Waiting for Joy Akindele to choose")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Send the invitation again" })).toBeVisible();
    const { count } = await admin.from("interview_offers").select("id", { count: "exact", head: true }).eq("application_id", appJoy).eq("status", "open");
    expect(count).toBe(1);
    const { data: units } = await admin.from("applicant_messages").select("status").eq("organization_id", mine.id).eq("kind", "interview_invite");
    expect(units?.filter((u) => u.status !== "failed").length, "the failed email gave its unit back; only Tunde's invitation counts").toBe(1);
  });

  test("an unverified company is told to verify first and cannot send an invitation", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "unverified");
    await admin.from("organizations").update({ verified: false }).eq("id", mine.id);
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("unverified", "Joy", "Akindele");
    const applicationId = await apply(joy.id, jobId);
    await page.goto(`/employer/jobs/${jobId}/applicants/${applicationId}/schedule`);
    await expect(page.getByText("Verify your company first.")).toBeVisible();
    await page.getByLabel("Time 1").fill(inputValue(at(3)));
    await page.getByLabel("Time 2").fill(inputValue(at(4)));
    await expect(page.getByRole("button", { name: "Send invitation" })).toBeDisabled();
  });

  test("from the applicants list, clicking 'Offer interview times' opens that applicant's schedule page", async ({ authedPage: page, testUser }) => {
    const mine = await org(testUser.id, "entry");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("entry", "Joy", "Akindele");
    const applicationId = await apply(joy.id, jobId);
    await page.goto(`/employer/jobs/${jobId}/applicants`);
    await page.getByRole("link", { name: "Offer interview times" }).click();
    await expect(page).toHaveURL(new RegExp(`/employer/jobs/${jobId}/applicants/${applicationId}/schedule$`));
    await expect(page.getByRole("heading", { name: "Offer interview times to Joy Akindele" })).toBeVisible();
  });
});
