/**
 * Every feature flag explains itself on /admin/feature-flags.
 *
 * The descriptions live in code (src/lib/admin/flags/descriptions.ts), keyed by flag key, not in a database column: a flag is created by migration and its description is reviewed in the same
 * diff as the code that reads it. This test is the guard: it reads every migration, collects every key that is seeded into feature_flags, and fails if one has no description, so a new flag
 * cannot ship without saying what it does. A key the map does not know shows "No description yet" and never throws.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NOTIFICATION_FLAGS } from "@/lib/notifications/contract";
import { FLAG_DESCRIPTIONS, NO_DESCRIPTION_YET, describeFlag } from "@/lib/admin/flags/descriptions";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");

/** Every flag key that a migration inserts into feature_flags. */
function seededKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const insert of text.matchAll(/insert\s+into\s+(?:public\.)?feature_flags\s*\([^)]*\)\s*values([^;]*);/gi)) {
      for (const tuple of insert[1].matchAll(/\(\s*'([a-z0-9_]+)'\s*,/gi)) keys.add(tuple[1]);
    }
  }
  return [...keys].sort();
}

describe("every flag has a description", () => {
  const seeded = seededKeys();

  it("the scan finds the flags (it is not vacuous)", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(14);
    for (const k of ["job_match_digest", "notifications_master", "admin_email", "job_lifecycle_delete_unreferenced"]) expect(seeded).toContain(k);
  });

  it.each(seededKeys())("%s has a non-empty description", (key) => {
    const text = FLAG_DESCRIPTIONS[key as keyof typeof FLAG_DESCRIPTIONS];
    expect(typeof text, `no description for the flag "${key}": add it to src/lib/admin/flags/descriptions.ts`).toBe("string");
    expect(text.trim().length).toBeGreaterThan(20);
    expect(describeFlag(key)).toBe(text);
  });

  it("the five notification flags in the typed registry have one too", () => {
    for (const key of Object.values(NOTIFICATION_FLAGS)) expect(describeFlag(key)).not.toBe(NO_DESCRIPTION_YET);
  });

  it("the map holds no key that no migration seeds (a stale entry)", () => {
    expect(Object.keys(FLAG_DESCRIPTIONS).sort()).toEqual(seeded);
  });

  it("each description is one plain sentence: ends with a full stop, no line breaks", () => {
    for (const [key, text] of Object.entries(FLAG_DESCRIPTIONS)) {
      expect(text, key).toMatch(/\.$/);
      expect(text, key).not.toMatch(/\n/);
      expect(text.length, key).toBeLessThan(260);
    }
  });
});

describe("a key with no description", () => {
  it("shows 'No description yet' and never throws, whatever the key", () => {
    expect(NO_DESCRIPTION_YET).toBe("No description yet");
    for (const key of ["some_future_flag", "", " ", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(describeFlag(key), JSON.stringify(key)).toBe("No description yet");
    }
  });
});

vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ adminId: "a", email: "op@example.test", displayName: "Op", permissions: ["feature_flags"] }) }));
vi.mock("@/lib/admin/flags/list", () => ({
  listFeatureFlags: async () => [
    { key: "job_match_digest", label: "Job-match digest emails", enabled: false, updatedAt: "2026-11-01T10:00:00Z", updatedByName: null },
    { key: "a_flag_nobody_described", label: "A new switch", enabled: true, updatedAt: "2026-11-02T10:00:00Z", updatedByName: null },
  ],
}));
vi.mock("@/lib/admin/flags/actions", () => ({ setFeatureFlagAction: async () => ({ status: "idle" }) }));

describe("the page", () => {
  it("shows the description under each label, and 'No description yet' for a flag the map does not know", async () => {
    const { default: FeatureFlagsPage } = await import("@/app/admin/(protected)/feature-flags/page");
    const html = renderToStaticMarkup(await FeatureFlagsPage());
    expect(html).toContain(FLAG_DESCRIPTIONS.job_match_digest);
    expect(html).toContain("No description yet");
    // under the label: the description comes after the label and before the key line
    const known = html.indexOf("Job-match digest emails");
    expect(known).toBeGreaterThan(-1);
    expect(html.indexOf(FLAG_DESCRIPTIONS.job_match_digest)).toBeGreaterThan(known);
  });
});
