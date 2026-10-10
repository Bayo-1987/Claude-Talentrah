/**
 * Mentor side (QA, 9 Oct): the person is an approved mentor. The "Pause your mentor listing" switch on/off/on in a row (the database follows each time); while paused a booking attempt is refused by the
 * database ("MENTOR_PAUSED"); "Your mentees": a booked free session appears under "Needs your confirmation" with the mentee's name, Confirm moves it to Upcoming with a meeting link recorded, and a
 * second session confirmed from two tabs at the same instant is confirmed once. Local stack only, minted session for the mentor; a throwaway mentee; nothing emailed (no provider).
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { settle } from "./support/settle";

test("mentor dashboard: pause on/off/on, paused is unbookable, confirm one session, two-tab confirm is once", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(150_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  await admin.from("profiles").update({ first_name: "QADash", last_name: `Mentor${tag}` }).eq("id", testUser.id);
  const { error } = await admin.from("mentor_profiles").insert({ user_id: testUser.id, status: "approved", bio: "QA mentor", display_name: `QA Dash Mentor ${tag}`, base_price_ngn: null, years_experience: 5, expertise_roles: ["engineering"] });
  if (error) throw new Error(`fixture mentor: ${error.message}`);
  const mentee = (await admin.auth.admin.createUser({ email: `qa-mentee-${tag}@talentrah.test`, email_confirm: true })).data.user!;
  await admin.from("profiles").update({ first_name: "QAMentee", last_name: tag }).eq("id", mentee.id);
  const slot = async (i: number) => { const start = new Date(Date.now() + (4 + i) * 86_400_000); const { data } = await admin.from("mentor_availability_slots").insert({ mentor_id: testUser.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 1_800_000).toISOString(), is_booked: false }).select("id").single(); return data!.id; };
  const paused = async () => (await admin.from("mentor_profiles").select("self_paused").eq("user_id", testUser.id).single()).data!.self_paused;
  try {
    await page.goto("/mentorship/apply");
    const sw = page.getByRole("switch", { name: "Pause your mentor listing" });
    await expect(sw).toBeVisible({ timeout: 30_000 });
    for (const want of [true, false, true]) {
      await sw.click();
      await expect.poll(paused, { timeout: 30_000 }).toBe(want);
      await expect(sw).toHaveAttribute("aria-checked", String(want));
      await settle(page);
    }
    await shot("1-paused");
    const s0 = await slot(0);
    const refused = await admin.rpc("book_mentor_session", { p_availability_slot_id: s0, p_mentee_id: mentee.id, p_session_type: "quick_question" });
    expect(refused.error?.message ?? "", "a paused mentor cannot be booked").toContain("MENTOR_PAUSED");
    await sw.click();
    await expect.poll(paused, { timeout: 30_000 }).toBe(false);

    // Two bookings, then confirmations.
    const s1 = await slot(1), s2 = await slot(2);
    for (const s of [s1, s2]) { const r = await admin.rpc("book_mentor_session", { p_availability_slot_id: s, p_mentee_id: mentee.id, p_session_type: "quick_question" }); expect(r.error, "booking after unpausing works").toBeNull(); }
    await page.goto("/mentorship/sessions/mentor");
    await expect(page.getByRole("heading", { name: "Needs your confirmation" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/QAMentee/).first()).toBeVisible();
    await shot("2-needs-confirmation");
    const status = async (slotId: string) => (await admin.from("mentorship_sessions").select("status, meeting_link").eq("availability_slot_id", slotId).single()).data!;
    // First: one click.
    await page.getByRole("button", { name: "Confirm" }).first().click();
    await expect.poll(async () => { const a = await status(s1), b = await status(s2); return [a.status, b.status].filter((x) => x === "confirmed").length; }, { timeout: 30_000 }).toBe(1);
    const done = [(await status(s1)), (await status(s2))].find((x) => x.status === "confirmed")!;
    expect(done.meeting_link, "a meeting link is recorded").toBeTruthy();
    await shot("3-first-confirmed");

    // Second: the same Confirm in two tabs at once.
    const page2 = await page.context().newPage();
    await page.goto("/mentorship/sessions/mentor");
    await page2.goto("/mentorship/sessions/mentor");
    await Promise.all([page.getByRole("button", { name: "Confirm" }).first().click(), page2.getByRole("button", { name: "Confirm" }).first().click()]);
    await settle(page);
    const rows = (await admin.from("mentorship_sessions").select("status, meeting_link").eq("mentor_id", testUser.id)).data ?? [];
    expect(rows.filter((r) => r.status === "confirmed"), "both sessions confirmed, each with one meeting link").toHaveLength(2);
    const crashed = await page2.getByText(/This page couldn.t load/i).count() + await page.getByText(/This page couldn.t load/i).count();
    expect(crashed, "the loser of a two-tab Confirm is told, not crashed (#904)").toBe(0);
  } finally {
    await admin.from("mentorship_sessions").delete().eq("mentor_id", testUser.id);
    await admin.from("mentor_availability_slots").delete().eq("mentor_id", testUser.id);
    await admin.from("mentor_profiles").delete().eq("user_id", testUser.id);
    await admin.auth.admin.deleteUser(mentee.id);
  }
});
