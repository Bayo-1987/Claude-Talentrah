/**
 * send-493 (PR B) — every credit-spending control shows its price BEFORE the click, and what happens next
 * matches it. One group per spender from the #615 audit.
 *
 * For each spender the same four statements are made:
 *   1. the label at the control says the price, built from CREDIT_COSTS (never typed here);
 *   2. the action charges EXACTLY that price (a positive control: a test for an action that silently did
 *      nothing cannot pass by "the balance is unchanged");
 *   3. the masthead pill shows exactly the database balance afterwards (compared to the DB, not to a number
 *      computed here, so a UI that invented one fails);
 *   4. the result and its charge are announced in a polite live region.
 *
 * WHERE THE CHARGE HAPPENS, which the bullet-rewrite tests below are written around. `rewriteBulletAction` calls
 * the model, and only after it succeeds spends the credits (src/lib/resume-builder/actions.ts). So the charge is
 * taken when the rewrite is GENERATED, not when the user presses Keep. This PR does not move it. What it
 * changes is that the user sees the price before pressing, sees the rewrite as a preview, and chooses Keep or
 * Discard; and the preview says plainly that the credits are already used, because Discard cannot give them
 * back. The tests assert exactly that: one charge at generation, no second charge on Keep, no second charge and
 * no refund on Discard.
 *
 * Runs against the stub LLM (LLM_PROVIDER=stub), like the golden path.
 */
import type { Page } from "@playwright/test";
import { test, expect, admin, grantTestCredits, requireStubbedLlm, seedBaseResume } from "./fixtures/authed";
import { CREDIT_COSTS } from "../src/lib/credits/costs";

const START = 200;
const JD = `We are looking for an engineer to build and operate payment APIs at scale. You will work with Node.js,
Postgres and distributed systems, and own services end to end.`;

const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
const pill = (page: Page, n: number) => page.getByRole("link", { name: `${n} credits · Top up` });

async function dbBalance(userId: string): Promise<number> {
  const { data, error } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
  if (error || !data) throw new Error(`reading balance: ${error?.message}`);
  return data.credits_balance;
}

async function useUpFreeTrials(userId: string) {
  await admin.from("profiles").update({ free_trial_tailoring_used: true, free_trial_cover_letter_used: true }).eq("id", userId);
}

async function useUpFreeFarahMessages(userId: string, balance: number) {
  const { error } = await admin.from("credit_gate_events").insert(
    Array.from({ length: 3 }, () => ({
      user_id: userId,
      reason: "farah_chat_message" as const,
      credits_required: 0,
      credits_available: balance,
      outcome: "covered_by_free_allowance" as const,
    })),
  );
  if (error) throw new Error(`could not use up the free Farah allowance: ${error.message}`);
}

async function farahMessageCount(userId: string): Promise<number> {
  const { count, error } = await admin.from("farah_messages").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw new Error(`counting farah messages: ${error.message}`);
  return count ?? 0;
}

async function baseResumeId(userId: string): Promise<string> {
  const { data } = await admin.from("resumes").select("id").eq("user_id", userId).eq("is_base", true).single();
  return data!.id;
}

/** The pill matches the database and the database moved by exactly `charge` from `before`. */
async function expectCharged(page: Page, userId: string, before: number, charge: number) {
  await expect.poll(() => dbBalance(userId), { message: "the action never charged", timeout: 30_000 }).toBe(before - charge);
  await expect(pill(page, before - charge), "the masthead must show the database balance").toBeVisible();
}

test.describe("tailoring and cover letter", () => {
  test("a free run says so, runs without a confirmation, and charges nothing", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);
    await grantTestCredits(testUser.id, START);

    await page.goto("/tailor");
    await expect(page.getByRole("button", { name: /^Tailor my resume · free/ })).toBeVisible();
    await expect(page.getByText(/first tailoring run/i), "the free-run copy is true for this account").toBeVisible();
    await page.getByPlaceholder("Paste the full job description here…").fill(JD);
    await page.getByRole("button", { name: /^Tailor my resume · free/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "no credits used" })).toBeVisible({ timeout: 30_000 });
    expect(await dbBalance(testUser.id)).toBe(START);
  });

  test("once the free run is used: the button names the price and balance, the 'first run free' copy is gone, and Cancel charges nothing", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);
    await grantTestCredits(testUser.id, START);
    await useUpFreeTrials(testUser.id);

    await page.goto("/tailor");
    const label = `Tailor my resume · ${credits(CREDIT_COSTS.tailoringRun)} (you have ${START})`;
    await expect(page.getByRole("button", { name: label })).toBeVisible();
    await expect(page.getByText(/first tailoring run|first cover letter/i), "stale 'first run free' copy").toHaveCount(0);
    await expect(page.getByText(`Also write a cover letter · ${credits(CREDIT_COSTS.coverLetterRun)}`)).toBeVisible();

    let apiCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/tailoring") && r.method() === "POST") apiCalls++;
    });
    await page.getByPlaceholder("Paste the full job description here…").fill(JD);
    await page.getByRole("button", { name: label }).click();

    // A confirmation, before anything is charged or even requested.
    const confirm = page.getByTestId("tailor-confirm");
    await expect(confirm).toContainText(credits(CREDIT_COSTS.tailoringRun));
    await expect(confirm).toContainText(`${START - CREDIT_COSTS.tailoringRun} left`);
    expect(await dbBalance(testUser.id)).toBe(START);

    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("button", { name: label })).toBeVisible();
    expect(apiCalls, "Cancel must not call the API").toBe(0);
    expect(await dbBalance(testUser.id)).toBe(START);
  });

  test("Confirm charges exactly the price shown, the pill matches the database, and the result is announced", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);
    await grantTestCredits(testUser.id, START);
    await useUpFreeTrials(testUser.id);

    await page.goto("/tailor");
    await page.getByPlaceholder("Paste the full job description here…").fill(JD);
    await page.getByRole("button", { name: /^Tailor my resume · / }).click();
    await page.getByTestId("tailor-confirm").getByRole("button", { name: "Confirm and tailor" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: `Tailored — ${credits(CREDIT_COSTS.tailoringRun)} used` }),
    ).toBeVisible({ timeout: 30_000 });
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.tailoringRun);
  });

  test("with the cover letter ticked the button shows both prices, and Confirm charges both", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);
    await grantTestCredits(testUser.id, START);
    await useUpFreeTrials(testUser.id);

    await page.goto("/tailor");
    await page.getByPlaceholder("Paste the full job description here…").fill(JD);
    await page.getByLabel(/Also write a cover letter/).check();
    const total = CREDIT_COSTS.tailoringRun + CREDIT_COSTS.coverLetterRun;
    await page.getByRole("button", { name: `Tailor my resume · ${credits(total)} (you have ${START})` }).click();
    await page.getByTestId("tailor-confirm").getByRole("button", { name: "Confirm and tailor" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${credits(total)} used` })).toBeVisible({ timeout: 30_000 });
    await expectCharged(page, testUser.id, START, total);
  });
});

test.describe("bullet rewrite", () => {
  async function openEditor(page: Page, userId: string) {
    await requireStubbedLlm(page);
    await seedBaseResume(userId);
    await grantTestCredits(userId, START);
    // Wide, so the masthead's own nav links are on screen: below the nav's breakpoint they collapse into a menu
    // and "Resume Builder" is not a visible link, which is what the leave-the-page tests click.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/resume-builder/edit?resumeId=${await baseResumeId(userId)}`);
    await expect(pill(page, START)).toBeVisible();
  }

  test("each control shows its price, and is at least 44px tall", async ({ authedPage: page, testUser }) => {
    await openEditor(page, testUser.id);
    for (const label of ["More impact-driven", "Quantify this", "More concise"]) {
      const control = page.getByRole("button", { name: `${label} · ${credits(CREDIT_COSTS.bulletRewrite)}` }).first();
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.height, `${label} is a ${box!.height}px hit target`).toBeGreaterThanOrEqual(44);
    }
  });

  test("a rewrite is a PREVIEW: the text is unchanged until Keep; the charge is taken once, at generation, and announced", async ({
    authedPage: page,
    testUser,
  }) => {
    await openEditor(page, testUser.id);
    const editor = page.locator("#experience-0-bullets");
    const before = await editor.innerText();

    await page.getByRole("button", { name: /^More concise · / }).first().click();
    const preview = page.getByTestId("rewrite-preview");
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("status").filter({ hasText: `Rewritten — ${credits(CREDIT_COSTS.bulletRewrite)} used` })).toBeVisible();
    await expect(preview).toContainText("already used");

    expect(await editor.innerText(), "the editor text must not change before Keep").toBe(before);
    // Generation is where the charge lands today; the preview never charges a second time.
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.bulletRewrite);
  });

  test("Keep applies the rewrite and charges nothing more", async ({ authedPage: page, testUser }) => {
    await openEditor(page, testUser.id);
    const editor = page.locator("#experience-0-bullets");
    const before = await editor.innerText();

    await page.getByRole("button", { name: /^More concise · / }).first().click();
    await expect(page.getByTestId("rewrite-preview")).toBeVisible({ timeout: 30_000 });
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.bulletRewrite);

    await page.getByTestId("rewrite-preview").getByRole("button", { name: "Keep" }).click();
    await expect(page.getByTestId("rewrite-preview")).toHaveCount(0);
    await expect.poll(async () => editor.innerText()).not.toBe(before);
    expect(await dbBalance(testUser.id), "Keep must not charge again").toBe(START - CREDIT_COSTS.bulletRewrite);
  });

  test("Discard restores the original text, charges nothing more, and does not pretend to refund", async ({ authedPage: page, testUser }) => {
    await openEditor(page, testUser.id);
    const editor = page.locator("#experience-0-bullets");
    const before = await editor.innerText();

    await page.getByRole("button", { name: /^More concise · / }).first().click();
    await expect(page.getByTestId("rewrite-preview")).toBeVisible({ timeout: 30_000 });
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.bulletRewrite);

    await page.getByTestId("rewrite-preview").getByRole("button", { name: "Discard" }).click();
    await expect(page.getByTestId("rewrite-preview")).toHaveCount(0);
    expect(await editor.innerText(), "Discard must restore the original").toBe(before);
    expect(await dbBalance(testUser.id), "Discard neither charges again nor refunds").toBe(START - CREDIT_COSTS.bulletRewrite);
    await expect(pill(page, START - CREDIT_COSTS.bulletRewrite)).toBeVisible();
  });

  test("leaving an editor where nothing was changed does not prompt", async ({ authedPage: page, testUser }) => {
    await openEditor(page, testUser.id);
    let prompted = false;
    page.on("dialog", async (d) => {
      prompted = true;
      await d.accept();
    });
    await page.getByRole("link", { name: "Resume Builder" }).first().click();
    await expect(page).not.toHaveURL(/\/resume-builder\/edit/);
    expect(prompted, "an untouched editor must never warn").toBe(false);
  });

  test("leaving with an unsaved (kept) rewrite asks first; staying keeps the work, leaving anyway is allowed, Save clears it", async ({
    authedPage: page,
    testUser,
  }) => {
    await openEditor(page, testUser.id);
    await page.getByRole("button", { name: /^More concise · / }).first().click();
    await expect(page.getByTestId("rewrite-preview")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("rewrite-preview").getByRole("button", { name: "Keep" }).click();

    // Declining the prompt keeps the user on the page, with the work.
    const messages: string[] = [];
    page.once("dialog", async (d) => {
      messages.push(d.message());
      await d.dismiss();
    });
    await page.getByRole("link", { name: "Resume Builder" }).first().click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toMatch(/unsaved/i);
    await expect(page).toHaveURL(/\/resume-builder\/edit/);

    // Saving clears it: no prompt, the navigation happens.
    // The editor has a Save button at the top and one at the bottom, so take the first of each.
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Saved", exact: true }).first()).toBeVisible();
    let prompted = false;
    page.on("dialog", async (d) => {
      prompted = true;
      await d.accept();
    });
    await page.getByRole("link", { name: "Resume Builder" }).first().click();
    await expect(page).not.toHaveURL(/\/resume-builder\/edit/);
    expect(prompted, "no prompt after Save").toBe(false);
  });

  test("a rewrite shown but not yet kept or discarded also counts as unsaved when leaving", async ({ authedPage: page, testUser }) => {
    await openEditor(page, testUser.id);
    await page.getByRole("button", { name: /^More concise · / }).first().click();
    await expect(page.getByTestId("rewrite-preview")).toBeVisible({ timeout: 30_000 });

    let message = "";
    page.once("dialog", async (d) => {
      message = d.message();
      await d.dismiss();
    });
    await page.getByRole("link", { name: "Resume Builder" }).first().click();
    await expect.poll(() => message).toMatch(/unsaved|rewrite/i);
    await expect(page).toHaveURL(/\/resume-builder\/edit/);
  });
});

test.describe("Farah quick actions", () => {
  const ACTIONS = [
    { label: "Job Interview Prep", prompt: "Help me prep for a job interview." },
    { label: "Career Advisor", prompt: "I'd like some career advice." },
    { label: "Salary Negotiation", prompt: "I want to prep for a salary negotiation." },
  ];

  test("with free messages left, a chip sends straight away and says nothing about price", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await page.goto("/tracker");
    await expect(page.getByText("3 free messages left.")).toBeVisible();

    await page.getByRole("button", { name: "Career Advisor" }).click();
    await expect(page.getByText("2 free messages left.")).toBeVisible({ timeout: 30_000 });
    expect(await dbBalance(testUser.id)).toBe(START);
  });

  test("once the free messages are used, the panel states the price and each chip PREFILLS instead of sending", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await useUpFreeFarahMessages(testUser.id, START);
    await page.goto("/tracker");
    await expect(page.getByText(new RegExp(`${CREDIT_COSTS.farahChatMessage} credit`))).toBeVisible();

    const input = page.getByPlaceholder("Ask me anything…");
    for (const { label, prompt } of ACTIONS) {
      const chip = page.getByRole("button", { name: label });
      const box = await chip.boundingBox();
      expect(box!.height, `${label} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);

      const messagesBefore = await farahMessageCount(testUser.id);
      await chip.click();
      await expect(input).toHaveValue(prompt);
      // Nothing was sent and nothing was charged by the click itself. A short settle, because "nothing
      // happened" has no event to wait for; the send path, if it were taken, answers in well under this.
      await page.waitForTimeout(500);
      expect(await farahMessageCount(testUser.id), `${label} sent a message`).toBe(messagesBefore);
      expect(await dbBalance(testUser.id)).toBe(START);
      await input.fill("");
    }
  });

  test("sending the prefilled text charges exactly the message price, the pill matches the database, and it is announced", async ({
    authedPage: page,
    testUser,
  }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await useUpFreeFarahMessages(testUser.id, START);
    await page.goto("/tracker");

    await page.getByRole("button", { name: "Career Advisor" }).click();
    await expect(page.getByPlaceholder("Ask me anything…")).toHaveValue("I'd like some career advice.");
    await page.getByRole("button", { name: "Send to Farah" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: `Farah replied — ${credits(CREDIT_COSTS.farahChatMessage)} used` }),
    ).toBeVisible({ timeout: 30_000 });
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.farahChatMessage);
  });
});

test.describe("Talent Directory purchases show the price on the button", () => {
  test("Talent Directory: the three purchase buttons carry their prices and charge exactly them", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await seedBaseResume(testUser.id);
    await grantTestCredits(testUser.id, START);
    await page.goto("/talent-directory/verify");

    await expect(page.getByRole("button", { name: `Request human review · ${credits(CREDIT_COSTS.talentDirectoryHumanReview)}` })).toBeVisible();
    const verify = page.getByRole("button", { name: `Request a resume review · ${credits(CREDIT_COSTS.talentDirectoryVerification)}` });
    await expect(verify).toBeVisible();
    await verify.click();
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.talentDirectoryVerification);
  });

  test("Talent Directory: the boost button carries its price", async ({ authedPage: page, testUser }) => {
    await requireStubbedLlm(page);
    await grantTestCredits(testUser.id, START);
    await admin.from("profiles").update({ talent_verification_status: "verified", talent_directory_opt_in: true }).eq("id", testUser.id);
    await page.goto("/talent-directory/verify");
    const boost = page.getByRole("button", { name: `Boost my placement · ${credits(CREDIT_COSTS.talentDirectoryBoost)}` });
    await expect(boost).toBeVisible();
    await boost.click();
    await expectCharged(page, testUser.id, START, CREDIT_COSTS.talentDirectoryBoost);
  });
});
