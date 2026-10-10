/**
 * Seeker email preferences, the /unsubscribe link (QA, 9 Oct): for each of the four email kinds, opening the emailed link unsubscribes THAT kind only (the other three stay on), says so, and "Actually, keep sending
 * them" undoes it and says so; the second unsubscribe/resubscribe round in a row behaves the same; a bad token claims nothing ("That link didn't work") and changes nothing. Signed out, as a person following the
 * link from their inbox would be. Local stack only, throwaway user (the preferences row and its token are created with the account).
 */
import { test, expect, admin } from "./fixtures/authed";

const KINDS = [
  { pref: undefined, column: "job_match_digest" },
  { pref: "proactive_match_alert", column: "proactive_match_alert" },
  { pref: "scholarship_deadline_alert", column: "scholarship_deadline_alert" },
  { pref: "win_back_email", column: "win_back_email" },
] as const;
const COLUMNS = KINDS.map((k) => k.column);

test("each email kind unsubscribes and resubscribes on its own, twice; a bad token changes nothing", async ({ browser, testUser }, info) => {
  test.setTimeout(150_000);
  const { data: prefs } = await admin.from("email_preferences").select("*").eq("user_id", testUser.id).single();
  const token = prefs!.unsubscribe_token as string;
  const flags = async () => (await admin.from("email_preferences").select(COLUMNS.join(",")).eq("user_id", testUser.id).single()).data as unknown as Record<string, boolean>;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // Start with all four on.
  await admin.from("email_preferences").update({ job_match_digest: true, proactive_match_alert: true, scholarship_deadline_alert: true, win_back_email: true }).eq("user_id", testUser.id);

  for (const round of [1, 2]) {
    for (const kind of KINDS) {
      const url = `/unsubscribe?token=${token}${kind.pref ? `&pref=${kind.pref}` : ""}`;
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "You're unsubscribed." }), `${kind.column} round ${round}`).toBeVisible();
      const after = await flags();
      for (const c of COLUMNS) expect(after[c], `round ${round}: ${kind.column} off, ${c} ${c === kind.column ? "off" : "untouched (on)"}`).toBe(c === kind.column ? false : true);
      if (round === 1 && kind.column === "job_match_digest") await shot("1-unsubscribed");
      await page.getByRole("button", { name: "Actually, keep sending them" }).click();
      await expect(page.getByText(/You're subscribed again/)).toBeVisible({ timeout: 15_000 });
      expect((await flags())[kind.column], `round ${round}: ${kind.column} back on`).toBe(true);
    }
  }

  // A bad token changes nothing and claims nothing.
  await page.goto(`/unsubscribe?token=not-a-real-token-${Date.now()}`);
  await expect(page.getByRole("heading", { name: "That link didn't work." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You're unsubscribed." })).toHaveCount(0);
  expect(Object.values(await flags()).every(Boolean), "a bad token altered nothing").toBe(true);
  await ctx.close();
});
