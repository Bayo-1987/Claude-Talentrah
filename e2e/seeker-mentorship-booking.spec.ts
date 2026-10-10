/**
 * Seeker > Mentorship booking, up to (not including) the payment provider (QA, 9 Oct). A free mentor: book one slot, then a second in a row (each lands on My sessions as booked, the booked slot leaves the
 * picker), then a slot that someone else books while the page is open: "That slot was just booked by someone else." and NOTHING is created for the person. A paid mentor: "Continue to payment" with no provider
 * configured comes back with "Payments are unavailable right now.", the attempt is recorded FAILED, exactly one pending-payment booking exists (retrying does not create a second), and nothing is confirmed.
 * Local stack only; minted session for the seeker; throwaway mentors and slots removed afterwards. No payment provider is contacted.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";

async function makeMentor(label: string, tag: string, price: number | null, slots: number) {
  const { data: u, error } = await admin.auth.admin.createUser({ email: `qa-${label}-${tag}@talentrah.test`, email_confirm: true });
  if (error || !u) throw new Error(`fixture mentor: ${error?.message}`);
  await admin.from("profiles").update({ first_name: `QA${label}`, last_name: `Mentor${tag}` }).eq("id", u.user.id);
  const { error: mErr } = await admin.from("mentor_profiles").insert({ user_id: u.user.id, status: "approved", bio: "QA throwaway mentor", display_name: `QA ${label} Mentor ${tag}`, base_price_ngn: price, years_experience: 5, expertise_roles: ["engineering"] });
  if (mErr) throw new Error(`fixture mentor profile: ${mErr.message}`);
  const slotIds: string[] = [];
  for (let i = 0; i < slots; i++) {
    const start = new Date(Date.now() + (3 + i) * 86_400_000);
    const { data: s, error: sErr } = await admin.from("mentor_availability_slots").insert({ mentor_id: u.user.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 1_800_000).toISOString(), is_booked: false }).select("id").single();
    if (sErr || !s) throw new Error(`fixture slot: ${sErr?.message}`);
    slotIds.push(s.id);
  }
  return { id: u.user.id, slotIds };
}

test("mentorship booking: free mentor twice in a row, a taken slot, and a paid mentor without a provider", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(180_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const free = await makeMentor("Free", tag, null, 3);
  const paid = await makeMentor("Paid", tag, 10_000, 1);
  const other = (await admin.auth.admin.createUser({ email: `qa-other-${tag}@talentrah.test`, email_confirm: true })).data.user!;
  const mine = async (mentorId?: string) => ((await admin.from("mentorship_sessions").select("id, status, mentor_id, availability_slot_id").eq("mentee_id", testUser.id)).data ?? []).filter((s) => !mentorId || s.mentor_id === mentorId);
  try {
    // Free mentor: first booking.
    await page.goto(`/mentorship/${free.id}`);
    await expect(page.getByRole("heading", { name: "Book a session" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Book this session" })).toBeVisible();
    await shot("1-free-mentor-page");
    await page.locator("#slotId").selectOption(free.slotIds[0]);
    await page.getByRole("button", { name: "Book this session" }).click();
    await page.waitForURL(/\/mentorship\/sessions\?booked=1/, { timeout: 30_000 });
    await shot("2-first-booked");
    expect(await mine(free.id)).toHaveLength(1);

    // Second booking in a row: the booked slot is no longer offered.
    await page.goto(`/mentorship/${free.id}`);
    const options = await page.locator("#slotId option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options, "the slot already booked is no longer in the picker").not.toContain(free.slotIds[0]);
    await page.locator("#slotId").selectOption(free.slotIds[1]);
    await page.getByRole("button", { name: "Book this session" }).click();
    await page.waitForURL(/\/mentorship\/sessions\?booked=1/, { timeout: 30_000 });
    expect(await mine(free.id)).toHaveLength(2);

    // Deliberate error: the last slot is booked by somebody else while the page is open.
    await page.goto(`/mentorship/${free.id}`);
    await expect(page.locator("#slotId")).toBeVisible();
    await admin.rpc("book_mentor_session", { p_availability_slot_id: free.slotIds[2], p_mentee_id: other.id, p_session_type: "quick_question" });
    await page.locator("#slotId").selectOption(free.slotIds[2]);
    await page.getByRole("button", { name: "Book this session" }).click();
    await page.waitForURL(/\/mentorship\?error=/, { timeout: 30_000 });
    await expect(page.getByText("That slot was just booked by someone else.")).toBeVisible();
    await shot("3-slot-taken");
    expect(await mine(free.id), "nothing created for the person").toHaveLength(2);

    // Paid mentor, no provider configured.
    await page.goto(`/mentorship/${paid.id}`);
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/\/mentorship\?error=/, { timeout: 30_000 });
    await expect(page.getByText("Payments are unavailable right now.")).toBeVisible();
    await shot("4-payment-unavailable");
    const paidSessions = await mine(paid.id);
    expect(paidSessions, "exactly one booking held").toHaveLength(1);
    expect(paidSessions[0].status, "held awaiting payment, not confirmed").toBe("pending_payment");
    const txs = (await admin.from("payment_transactions").select("status").eq("user_id", testUser.id).eq("product_type", "mentor_session")).data ?? [];
    expect(txs.map((t) => t.status), "the attempt is recorded failed, never pending").toEqual(["failed"]);
  } finally {
    await admin.from("mentorship_sessions").delete().in("mentor_id", [free.id, paid.id]);
    await admin.from("mentor_availability_slots").delete().in("mentor_id", [free.id, paid.id]);
    await admin.from("mentor_profiles").delete().in("user_id", [free.id, paid.id]);
    for (const id of [free.id, paid.id, other.id]) await admin.auth.admin.deleteUser(id);
  }
});
