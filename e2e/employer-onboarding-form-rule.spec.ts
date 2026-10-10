/**
 * Employer onboarding ("Tell us about your company"): the form rule (QA, 9 Oct). Deliberate error first: the domain typed already belongs to a verified company ("... is already registered on ..."): the
 * error is shown and the company name, domain and description typed are still in the form. Then the corrected entry (a free domain) creates the company and lands on Jobs Posted, with the
 * organisation row in the database. Local stack only, minted session for a throwaway user (e2e/fixtures/authed.ts), throwaway organisations removed afterwards.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { submitAndSettle } from "./support/form-keeps";
import { settle } from "./support/settle";

test("onboarding: a taken domain keeps what was typed; the corrected entry creates the company", async ({ authedPage: page, testUser }, info) => {
  test.setTimeout(90_000);
  const shot = async (step: string) => info.attach(step, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const tag = randomUUID().slice(0, 6);
  const takenDomain = `qa-taken-${tag}.example.test`;
  const freeDomain = `qa-free-${tag}.example.test`;
  const { data: existing, error } = await admin.from("organizations").insert({ name: `QA Existing ${tag}`, created_by: testUser.id, verified: true, domain: takenDomain }).select("id").single();
  if (error || !existing) throw new Error(`fixture org: ${error?.message}`);
  // The fixture org is created BY this user, so remove the membership link the app would add: the user must still look like someone with no company yet.
  const created: string[] = [existing.id];
  try {
    await page.goto("/employer/onboarding");
    const name = `QA Onboard Co ${tag}`;
    const description = "Two sentences about the company. Typed by QA.";
    await page.getByLabel("Company name").fill(name);
    await page.getByLabel("Company website domain").fill(takenDomain);
    await page.getByLabel(/What the company does/).fill(description);
    await shot("1-filled-taken-domain");
    await submitAndSettle(page, () => page.getByRole("button", { name: "Create company" }).click());
    await expect(page.getByText(/is already registered on/)).toBeVisible({ timeout: 30_000 });
    await shot("2-error");
    await settle(page);
    const kept = { name: await page.getByLabel("Company name").inputValue(), domain: await page.getByLabel("Company website domain").inputValue(), description: await page.getByLabel(/What the company does/).inputValue() };
    expect.soft(kept, "ONBOARD-KEEP-1: the error must keep what was typed").toEqual({ name, domain: takenDomain, description });

    // Corrected entry (re-typed if the form was wiped, so the second half still runs).
    await page.getByLabel("Company name").fill(name);
    await page.getByLabel("Company website domain").fill(freeDomain);
    await page.getByLabel(/What the company does/).fill(description);
    await submitAndSettle(page, () => page.getByRole("button", { name: "Create company" }).click());
    await page.waitForURL(/\/employer\/jobs/, { timeout: 30_000 });
    const { data: org } = await admin.from("organizations").select("id, name, domain, description").eq("name", name).maybeSingle();
    expect(org, "the company was created").not.toBeNull();
    if (org) created.push(org.id);
    expect(org?.domain).toBe(freeDomain);
    expect(org?.description).toBe(description);
    await shot("3-created");
  } finally {
    await deleteOrgsCascade(admin, created);
  }
});
