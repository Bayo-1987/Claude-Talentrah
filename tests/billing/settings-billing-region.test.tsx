/**
 * send-503 / S18 — Settings' "Billing region" names the region and what billing means there.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const profile = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ profile: profile.value, user: { id: "u1" } }) }));
vi.mock("@/app/(app)/settings/settings-form", () => ({ SettingsForm: () => null }));

import SettingsPage from "@/app/(app)/settings/page";

const base = { email: "a@example.test", first_name: "Ada", last_name: "O", locale: "en" };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Settings > Billing region", () => {
  it("a Nigerian account: 'Nigeria — billed in naira (₦)'", async () => {
    profile.value = { ...base, country: "Nigeria", market_segment: "home" };
    const t = text(renderToStaticMarkup(await SettingsPage()));
    expect(t).toContain("Billing region");
    expect(t).toContain("Nigeria — billed in naira (₦)");
    expect(t).not.toContain("Home market");
  });

  it("a diaspora account: 'Outside Nigeria — billed in naira (₦) by card'", async () => {
    profile.value = { ...base, country: "United Kingdom", market_segment: "diaspora" };
    const t = text(renderToStaticMarkup(await SettingsPage()));
    expect(t).toContain("Outside Nigeria — billed in naira (₦) by card");
    expect(t).not.toContain("Diaspora");
  });

  it("a home-segment account outside Nigeria (Ghana) is not called Nigerian", async () => {
    profile.value = { ...base, country: "Ghana", market_segment: "home" };
    const t = text(renderToStaticMarkup(await SettingsPage()));
    expect(t).toContain("Outside Nigeria — billed in naira (₦) by card");
    expect(t).not.toContain("Nigeria — billed in naira (₦)  ");
  });

  it("does not claim the segment decides how the account is billed (billing never reads it)", async () => {
    profile.value = { ...base, country: "Nigeria", market_segment: "home" };
    expect(text(renderToStaticMarkup(await SettingsPage()))).not.toContain("It decides how you're billed");
  });
});
