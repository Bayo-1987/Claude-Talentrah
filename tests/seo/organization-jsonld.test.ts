/**
 * Organization and WebSite structured data — send-383.
 *
 * Like BlogPosting, neither schema has a required-property set, so what's
 * actually at risk is a claim the site can't back up rather than invalid
 * markup — concretely, `sameAs` naming a social/community profile the footer
 * on the same page doesn't actually link to. These tests stub the same env
 * vars marketing-footer.tsx reads, rather than asserting today's live values,
 * so the test keeps working the day one of those links rotates.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from "@/lib/seo/organization-jsonld";

const ALL_SAME_AS_ENV_VARS = [
  "NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL",
  "NEXT_PUBLIC_TELEGRAM_CHANNEL_URL",
  "NEXT_PUBLIC_LINKEDIN_URL",
  "NEXT_PUBLIC_X_URL",
  "NEXT_PUBLIC_FACEBOOK_URL",
  "NEXT_PUBLIC_INSTAGRAM_URL",
  "NEXT_PUBLIC_THREADS_URL",
  "NEXT_PUBLIC_TIKTOK_URL",
  "NEXT_PUBLIC_REDDIT_URL",
] as const;

/** Clears every sameAs-eligible env var so a test starts from a known state. */
function clearAllSameAsEnvVars() {
  for (const key of ALL_SAME_AS_ENV_VARS) vi.stubEnv(key, "");
}

afterEach(() => vi.unstubAllEnvs());

describe("buildOrganizationJsonLd", () => {
  it("emits the required identity fields", () => {
    clearAllSameAsEnvVars();
    const jsonLd = buildOrganizationJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd.name).toBe("Talentrah");
    expect(jsonLd.url).toMatch(/^https:\/\//);
    expect(jsonLd.logo).toMatch(/^https:\/\/.*\.png$/);
  });

  it("omits sameAs entirely when no social/community env var is set", () => {
    clearAllSameAsEnvVars();
    const jsonLd = buildOrganizationJsonLd();
    expect(jsonLd).not.toHaveProperty("sameAs");
  });

  it("includes only the profiles that are actually configured, in the footer's own order", () => {
    clearAllSameAsEnvVars();
    // Mirrors production's real live state at the time this was written:
    // WhatsApp, Telegram and X configured; the rest unset.
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL", "https://chat.whatsapp.com/test");
    vi.stubEnv("NEXT_PUBLIC_TELEGRAM_CHANNEL_URL", "https://t.me/talentrah_jobs");
    vi.stubEnv("NEXT_PUBLIC_X_URL", "https://x.com/talentrah_");

    const jsonLd = buildOrganizationJsonLd();
    expect(jsonLd.sameAs).toEqual([
      "https://chat.whatsapp.com/test",
      "https://t.me/talentrah_jobs",
      "https://x.com/talentrah_",
    ]);
  });

  it("never invents a profile whose env var is unset", () => {
    clearAllSameAsEnvVars();
    vi.stubEnv("NEXT_PUBLIC_LINKEDIN_URL", "https://linkedin.com/company/talentrah");

    const jsonLd = buildOrganizationJsonLd();
    expect(jsonLd.sameAs).toEqual(["https://linkedin.com/company/talentrah"]);
    for (const key of ALL_SAME_AS_ENV_VARS) {
      if (key === "NEXT_PUBLIC_LINKEDIN_URL") continue;
      expect((jsonLd.sameAs as string[]).join(" ")).not.toContain(key);
    }
  });
});

describe("buildWebSiteJsonLd", () => {
  it("emits name and url with no SearchAction", () => {
    const jsonLd = buildWebSiteJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("WebSite");
    expect(jsonLd.name).toBe("Talentrah");
    expect(jsonLd.url).toMatch(/^https:\/\//);
    // /jobs?q= redirects a signed-out visitor to /login (verified live) — no
    // real, publicly-reachable search entry point exists yet, so this must
    // never claim a sitelinks searchbox that would just dead-end at a login
    // wall for anyone Google sends there.
    expect(jsonLd).not.toHaveProperty("potentialAction");
  });
});
