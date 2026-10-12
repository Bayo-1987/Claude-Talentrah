/**
 * Schedule interview (0253) through the real UI: the candidate's page in two time zones either side of the UK clock change (Sunday 25 Oct 2026), booking, the loser of a race, someone else's invitation,
 * and the employer's form with its overlap warning. Offers are created through the database function (the invitation EMAIL is covered on a real database in tests/interviews; the test app has no mail key).
 */
import { test, expect, admin, mintSecondSession } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

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

  test("the same stored time reads 10:00 in Lagos and London BEFORE the UK clocks go back, and 10:00 in Lagos but 09:00 in London AFTER", async ({ browser, baseURL, testUser }) => {
    const mine = await org(testUser.id, "tz");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("tz", "Joy", "Akindele");
    const applicationId = await apply(joy.id, jobId);
    const { offerId } = await offer(testUser.id, applicationId, ["2026-10-24T09:00:00Z", "2026-10-26T09:00:00Z"]);

    const lagos = await candidatePage(browser, baseURL, joy, "Africa/Lagos");
    await lagos.page.goto(`/interviews/${offerId}`);
    await expect(lagos.page.getByText(/Sat, 24 Oct 2026, 10:00 to 10:45/)).toBeVisible();
    await expect(lagos.page.getByText(/Mon, 26 Oct 2026, 10:00 to 10:45/)).toBeVisible();
    await lagos.context.close();

    const london = await candidatePage(browser, baseURL, joy, "Europe/London");
    await london.page.goto(`/interviews/${offerId}`);
    await expect(london.page.getByText(/Sat, 24 Oct 2026, 10:00 to 10:45 BST/)).toBeVisible();
    await expect(london.page.getByText(/Mon, 26 Oct 2026, 09:00 to 09:45 GMT/)).toBeVisible();
    await london.context.close();
  });

  test("a candidate books a time and sees it scheduled; the application moves to interviewing", async ({ browser, baseURL, testUser }) => {
    const mine = await org(testUser.id, "book");
    const jobId = await job(mine.id, "Growth Marketer");
    const joy = await user("book", "Joy", "Akindele");
    const applicationId = await apply(joy.id, jobId);
    const { slots } = await offer(testUser.id, applicationId, ["2026-10-24T09:00:00Z", "2026-10-26T09:00:00Z"]);
    const { context, page } = await candidatePage(browser, baseURL, joy, "Europe/London");
    await page.goto(`/interviews/${(await admin.from("interview_slots").select("offer_id").eq("id", slots[0].id).single()).data!.offer_id}`);
    await page.getByRole("button", { name: "Book this time" }).first().click();
    await expect(page.getByText("Interview scheduled")).toBeVisible({ timeout: 15_000 });
    const { data: booking } = await admin.from("interview_bookings").select("status, starts_at").eq("application_id", applicationId).single();
    expect(booking?.status).toBe("booked");
    expect(new Date(booking!.starts_at).toISOString()).toBe("2026-10-24T09:00:00.000Z");
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
    const shared = "2026-10-20T09:00:00Z";
    const a = await offer(testUser.id, appJoy, [shared, "2026-10-21T09:00:00Z"]);
    const b = await offer(testUser.id, appTunde, [shared, "2026-10-22T09:00:00Z"]);

    const { context, page } = await candidatePage(browser, baseURL, joy, "Africa/Lagos");
    await page.goto(`/interviews/${a.offerId}`);
    await expect(page.getByRole("button", { name: "Book this time" })).toHaveCount(2);
    // Tunde takes the shared time while Joy's page is still open.
    const tundeShared = b.slots.find((s) => new Date(s.starts_at).toISOString() === "2026-10-20T09:00:00.000Z")!;
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
    const { offerId } = await offer(testUser.id, applicationId, ["2026-10-24T09:00:00Z", "2026-10-26T09:00:00Z"]);
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
    const booked = await offer(testUser.id, appTunde, ["2026-10-20T09:00:00Z", "2026-10-21T09:00:00Z"]);
    const slot = booked.slots.find((s) => new Date(s.starts_at).toISOString() === "2026-10-20T09:00:00.000Z")!;
    expect((await admin.rpc("book_interview_slot", { p_user: tunde.id, p_slot: slot.id })).data?.[0]?.ok).toBe(true);

    await page.goto(`/employer/jobs/${job1}/applicants/${appJoy}/schedule`);
    await expect(page.getByRole("heading", { name: "Offer interview times to Joy Akindele" })).toBeVisible();
    // 09:30 UTC the same day, entered in the browser's own zone, overlaps the booked 09:00-09:45 UTC interview.
    const local = (iso: string) => page.evaluate((v) => { const d = new Date(v); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }, iso);
    await page.getByLabel("Time 1").fill(await local("2026-10-20T09:30:00Z"));
    await page.getByLabel("Time 2").fill(await local("2026-10-23T09:00:00Z"));
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
    await page.getByLabel("Time 1").fill("2026-10-20T09:00");
    await page.getByLabel("Time 2").fill("2026-10-21T09:00");
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
