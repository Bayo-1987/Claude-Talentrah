/**
 * send-497 / S15 — a mentor's list card must agree with the mentor's own profile about whether there is anything to book.
 *
 * The card quoted "From ₦20,000 / session" while the profile said "No open slots right now": two queries, one of which
 * never looked at slots. This runs the real page against the real database (RLS included, which the unit test's mocked
 * client cannot prove): a mentor with no future unbooked slot says so on the card, and quotes the price once one appears.
 * The signed-in test user is the fixture mentor; browseMentors does not exclude the viewer.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";

async function cleanup(userId: string) {
  const slots = await admin.from("mentor_availability_slots").delete().eq("mentor_id", userId);
  if (slots.error) throw new Error(`fixture slots cleanup: ${slots.error.message}`);
  const mentor = await admin.from("mentor_profiles").delete().eq("user_id", userId);
  if (mentor.error) throw new Error(`fixture mentor cleanup: ${mentor.error.message}`);
}

test("a card says 'No open slots right now' until a future unbooked slot exists, then quotes the price", async ({ authedPage, testUser }) => {
  const name = `E2E Slot Mentor ${randomUUID().slice(0, 6)}`;
  const { error } = await admin.from("mentor_profiles").insert({
    user_id: testUser.id,
    status: "approved",
    display_name: name,
    bio: "fixture mentor",
    base_price_ngn: 12345,
  });
  if (error) throw new Error(`fixture mentor: ${error.message}`);

  try {
    const card = () => authedPage.locator(`a[href="/mentorship/${testUser.id}"]`);

    await authedPage.goto("/mentorship");
    await expect(card()).toContainText(name);
    await expect(card()).toContainText("No open slots right now");
    await expect(card()).not.toContainText("₦12,345");
    await expect(card()).not.toContainText("From");

    const { error: slotError } = await admin.from("mentor_availability_slots").insert({
      mentor_id: testUser.id,
      start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      end_at: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
    });
    if (slotError) throw new Error(`fixture slot: ${slotError.message}`);

    await authedPage.goto("/mentorship");
    await expect(card()).toContainText("From ₦12,345 / session");
    await expect(card()).not.toContainText("No open slots right now");

    // The profile agrees with the card in both states.
    await authedPage.goto(`/mentorship/${testUser.id}`);
    await expect(authedPage.getByText("No open slots right now")).toHaveCount(0);
  } finally {
    await cleanup(testUser.id);
  }
});
