/**
 * The database accepts every country the signup and settings lists now offer, byte for byte.
 *
 * Why this exists (S1-26 item 1). The country list went from eight hard-coded names to every ISO country. A signup stores the
 * picked name in auth user metadata, and `handle_new_user` copies it into `profiles.country`. Read-only inspection of
 * production before this change found no CHECK constraint on `profiles.country`, no RLS policy that reads it, and a trigger that
 * copies `raw_user_meta_data ->> 'country'` verbatim, so nothing at the database holds the old list. This test keeps it that way:
 * if a constraint, a normalising trigger or a column-type change ever starts refusing or rewriting a newly allowed country
 * ("Japan" stranded at signup, "Côte d'Ivoire" stored without its accent), it fails here rather than in production.
 *
 * It goes through `auth.admin.createUser({ user_metadata })`, which fires the real trigger (the same approach as
 * handle-new-user-names.test.ts), and through an owner's own session for the settings path. DB-backed: runs in CI only.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { SIGNUP_COUNTRIES } from "@/lib/auth/schemas";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

// Newly allowed, accented, apostrophe-bearing, ambiguous-in-free-text, and the catch-all: each exactly as the dropdown submits it.
const NEWLY_ALLOWED = ["Japan", "Côte d'Ivoire", "Åland Islands", "Curaçao", "Réunion", "Türkiye", "Georgia", "Jersey", "Other"];

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
}, 60_000);

it("every country under test is on the list the forms offer (so this test cannot drift from the forms)", () => {
  for (const c of NEWLY_ALLOWED) expect(SIGNUP_COUNTRIES, c).toContain(c);
});

describe("signup: handle_new_user copies the picked country into the profile exactly", () => {
  it.each(NEWLY_ALLOWED)("%s", async (country) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `country-${randomUUID()}@talentrah.test`,
      email_confirm: true,
      user_metadata: { first_name: "Ada", last_name: "Obi", country },
    });
    if (error) throw error;
    created.push(data.user.id);

    const { data: profile, error: readErr } = await admin.from("profiles").select("country").eq("id", data.user.id).single();
    if (readErr) throw readErr;
    expect(profile.country, "the profile must hold the exact picked value, accents and apostrophes intact").toBe(country);
  });
});

describe("settings: an owner can save any listed country on their own profile", () => {
  it.each(["Japan", "Côte d'Ivoire", "Georgia"])("%s", async (country) => {
    const owner = await createAuthedTestUser("country-settings");
    try {
      const { error } = await owner.client.from("profiles").update({ country }).eq("id", owner.id);
      expect(error, "the owner's own UPDATE of country must not be refused by any constraint or grant").toBeNull();
      const { data, error: readErr } = await owner.client.from("profiles").select("country").eq("id", owner.id).single();
      if (readErr) throw readErr;
      expect(data.country).toBe(country);
    } finally {
      await deleteTestUsers([owner.id]);
    }
  }, 60_000);
});
