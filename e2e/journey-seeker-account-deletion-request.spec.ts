/**
 * QA journey (UNRUN when written: authored on a machine with no local stack, CI is its first run).
 *
 * A seeker looking for how to delete their account: Settings shows the whole request screen, and the confirm link route refuses a bad link.
 * READ-ONLY by construction: it never types the confirmation phrase, never submits the form, and never opens a real confirm link, so no email is
 * sent and nothing is scheduled. Its job is to prove the surface a person must be able to reach and read before deciding.
 *
 * Copy under test is read from src/components/account-deletion/delete-account-section.tsx and src/app/(app)/settings/delete-account/confirm/page.tsx
 * (main 347a755): the "Delete account" eyebrow, the 30-day restore sentence, the typed-phrase field, the "Email me a confirmation link" button, and
 * "This link isn't valid." with a way back to Settings.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";

test.use({ viewport: { width: 1280, height: 900 } });

test("Settings shows the delete-account request screen, read-only", async ({ authedPage: page, testUser }) => {
  await seedBaseResume(testUser.id);
  await page.goto("/settings");

  const section = page.getByRole("region", { name: "Delete account" });
  await expect(section).toBeVisible();
  await expect(section.getByText(/Your personal data is deleted after \d+ days/)).toBeVisible();
  await expect(section.getByText(/restore the account/)).toBeVisible();

  const phrase = section.getByLabel(/^Type ".+" to confirm$/);
  await expect(phrase).toBeVisible();
  await expect(phrase).toBeEmpty();
  await expect(section.getByRole("button", { name: "Email me a confirmation link" })).toBeVisible();

  // Nothing was requested just by looking.
  const { data } = await admin.from("profiles").select("deletion_requested_at").eq("id", testUser.id).single();
  expect(data?.deletion_requested_at).toBeNull();
});

test("a malformed confirm link says so and offers a way back to Settings, and changes nothing", async ({ authedPage: page, testUser }) => {
  await seedBaseResume(testUser.id);
  await page.goto("/settings/delete-account/confirm?token=not-a-real-token");

  await expect(page.getByText(/This link isn.t valid\./)).toBeVisible();
  const back = page.getByRole("link", { name: "Ask for a new confirmation email from Settings" });
  await expect(back).toHaveAttribute("href", "/settings");
  await back.click();
  await expect(page).toHaveURL(/\/settings$/);

  const { data } = await admin.from("profiles").select("deletion_requested_at").eq("id", testUser.id).single();
  expect(data?.deletion_requested_at).toBeNull();
});
