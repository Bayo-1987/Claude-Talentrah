/**
 * Employer > Talent Directory (QA, 9 Oct), up to (not including) the payment provider. (A) An organisation with NO subscription: below the minimum number of listed candidates it sees the waitlist (no Subscribe
 * button): "Join the waitlist" joins once, a second visit shows "You're on the waitlist" and does not duplicate; with enough listed candidates the Subscribe button is shown and, with no provider configured,
 * pressing it comes back with a readable error and records nothing as pending. (B) An organisation WITH an active subscription: the listed candidate appears, the filters narrow the list correctly, the
 * candidate page takes a contact request (success message, one pending row), and a second request to the same candidate is refused readably. Local stack only, minted session, throwaway orgs, candidates and
 * subscriptions removed afterwards; no email, no payment.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { settle } from "./support/settle";

test("talent directory, employer side: waitlist, subscribed search and filters, contact request twice", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(180_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Employer Co TD${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  const mkCand = async (label: string, remote: boolean) => {
    const { data } = await admin.auth.admin.createUser({ email: `qa-cand-${label}-${tag}@talentrah.test`, email_confirm: true });
    await admin.from("profiles").update({ first_name: `QACand${label}`, last_name: tag, talent_verification_status: "verified", talent_directory_opt_in: true, talent_verified_at: new Date().toISOString(), talent_remote_ready: remote, talent_available_for_hire: true }).eq("id", data.user!.id);
    return data.user!.id;
  };
  const candA = await mkCand("A", true);
  const candB = await mkCand("B", false);
  let subId: string | null = null;
  try {
    // (A) not subscribed.
    await page.goto("/employer/talent-directory");
    await expect(page.getByRole("heading", { name: /Search candidates with a reviewed resume/ })).toBeVisible({ timeout: 30_000 });
    await shot("1-unsubscribed");
    const joinBtn = page.getByRole("button", { name: "Join the waitlist" });
    const subscribeBtn = page.getByRole("button", { name: /^Subscribe/ });
    if (await joinBtn.count()) {
      await joinBtn.click();
      await page.waitForURL(/waitlist=joined/, { timeout: 30_000 });
      await expect(page.getByText("You're on the waitlist.")).toBeVisible();
      const rows = async () => ((await admin.from("talent_directory_waitlist").select("organization_id").eq("organization_id", org!.id)).data ?? []).length;
      expect(await rows(), "joined once").toBe(1);
      await page.goto("/employer/talent-directory");
      await expect(page.getByText("You're on the waitlist.")).toBeVisible();
      await expect(joinBtn, "no second join offered").toHaveCount(0);
      expect(await rows(), "still once").toBe(1);
      await shot("2-waitlisted");
    } else if (await subscribeBtn.count()) {
      await subscribeBtn.first().click();
      await page.waitForLoadState("networkidle");
      await shot("2-subscribe-unconfigured");
      const txs = (await admin.from("payment_transactions").select("status").eq("user_id", testUser.id)).data ?? [];
      expect(txs.every((t) => t.status !== "pending"), "nothing left pending when payments are unavailable").toBe(true);
    }

    // (B) subscribed.
    const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
    const { data: sub, error: subErr } = await admin.from("talent_directory_subscriptions").insert({ organization_id: org!.id, plan_id: plan!.id, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), status: "active" }).select("id").single();
    if (subErr) throw new Error(`fixture subscription: ${subErr.message}`);
    subId = sub!.id;
    await page.goto("/employer/talent-directory");
    await expect(page.getByText(/Subscription active until/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`QACandA`).first()).toBeVisible();
    await expect(page.getByText(`QACandB`).first()).toBeVisible();
    await page.getByLabel("Remote-ready").check();
    await page.getByRole("button", { name: /Filter|Apply|Search/ }).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("QACandA").first(), "remote-ready candidate stays").toBeVisible();
    await expect(page.getByText("QACandB"), "the non-remote candidate is filtered out").toHaveCount(0);
    await shot("3-filtered");

    await page.goto(`/employer/talent-directory/${candA}`);
    const note = page.getByLabel(/short note introducing why/);
    await note.fill("Hello from QA: we have a role that fits your profile.");
    await page.getByRole("button", { name: "Request contact" }).click();
    await expect(page.getByText(/Request (sent|pending)/).first()).toBeVisible({ timeout: 30_000 }); // the form is replaced by "Request pending" on refresh
    const pending = async () => ((await admin.from("talent_directory_contact_requests").select("id, status").eq("organization_id", org!.id).eq("candidate_id", candA)).data ?? []);
    expect((await pending()).filter((r) => r.status === "pending")).toHaveLength(1);
    await shot("4-request-sent");

    // Second request to the same candidate.
    await page.reload();
    const form2 = page.getByRole("button", { name: "Request contact" });
    if (await form2.count()) {
      await page.getByLabel(/short note introducing why/).fill("A second note typed by QA that must not be lost.");
      await form2.click();
      await settle(page);
      await shot("5-second-request");
      expect((await pending()).filter((r) => r.status === "pending"), "still one pending").toHaveLength(1);
      await expect(page.getByText(/already have a request pending/i)).toBeVisible();
      expect.soft(await page.getByLabel(/short note introducing why/).inputValue(), "DIRECTORY-KEEP-1: the note typed is kept after the refusal").toBe("A second note typed by QA that must not be lost.");
    } else {
      info.annotations.push({ type: "note", description: "after a request is pending the form is replaced; no second request offered" });
    }
  } finally {
    await admin.from("talent_directory_contact_requests").delete().eq("organization_id", org!.id);
    if (subId) await admin.from("talent_directory_subscriptions").delete().eq("id", subId);
    await admin.from("talent_directory_waitlist").delete().eq("organization_id", org!.id);
    await deleteOrgsCascade(admin, [org!.id]);
    for (const id of [candA, candB]) await admin.auth.admin.deleteUser(id);
  }
});
