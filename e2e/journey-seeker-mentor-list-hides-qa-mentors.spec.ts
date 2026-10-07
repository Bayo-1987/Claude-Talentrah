/**
 * QA journey (#801, QA-EXCL): the signed-in mentor list hides QA mentors, the direct link to one still works.
 *
 * Two approved mentors on throwaway users, made as the service role on the CI/local stack: an ordinary one and one named "QA Mentor <tag>" (a name starting
 * "QA ", which #801 treats as a QA account). A signed-in seeker opens /mentorship through the page and must see the ordinary mentor's card and no card for the
 * QA mentor; then opens the QA mentor's profile by its direct link, which #801 deliberately leaves unfiltered, and sees the profile. Screenshots at each step.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";

test.use({ viewport: { width: 1280, height: 900 } });
const ids: string[] = [];

async function mentor(name: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email: `mentor-${randomUUID()}@${randomUUID().slice(0, 10)}.talentrah.test`, email_confirm: true });
  if (error) throw error;
  ids.push(data.user.id);
  const { error: mErr } = await admin.from("mentor_profiles").insert({ user_id: data.user.id, status: "approved", display_name: name, bio: "fixture mentor", base_price_ngn: 15000 });
  if (mErr) throw new Error(`fixture mentor: ${mErr.message}`);
  return data.user.id;
}

test.afterEach(async () => {
  for (const id of ids.splice(0)) {
    await admin.from("mentor_availability_slots").delete().eq("mentor_id", id);
    await admin.from("mentor_profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

test("the list shows the ordinary mentor and not the QA mentor; the QA mentor's direct link still opens", async ({ authedPage: page }, info) => {
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const ordinaryName = `E2E Ordinary Mentor ${tag}`;
  const qaName = `QA Mentor ${tag}`;
  const ordinaryId = await mentor(ordinaryName);
  const qaId = await mentor(qaName);

  await page.goto("/mentorship");
  await expect(page.locator(`a[href="/mentorship/${ordinaryId}"]`), "the ordinary mentor must be listed (fixture sanity)").toContainText(ordinaryName);
  await expect(page.locator(`a[href="/mentorship/${qaId}"]`), "a mentor named QA ... must not be listed").toHaveCount(0);
  await expect(page.getByText(qaName)).toHaveCount(0);
  await shot("1-list-without-the-qa-mentor");

  await page.goto(`/mentorship/${qaId}`);
  await expect(page.getByText(qaName).first(), "the direct link still shows the QA mentor's profile").toBeVisible();
  await shot("2-qa-mentor-direct-link");
});
