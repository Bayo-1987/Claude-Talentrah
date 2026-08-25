/**
 * Verifies handle_new_user derives a usable name from what each auth
 * provider ACTUALLY supplies.
 *
 * The bug: the trigger read raw_user_meta_data ->> 'first_name' and nothing
 * else. Our own email signup form sets that key; no OAuth provider does, so
 * every Google and LinkedIn signup got a permanent NULL name.
 *
 * ── Why the fixtures look the way they do ───────────────────────────────
 *
 * They are not invented. The Google shape is copied from this project's own
 * auth data — real Google accounts here carry `full_name` and `name` but NO
 * `given_name`, which is exactly why a fix keyed on given_name alone would
 * have changed nothing for them. The LinkedIn shape follows LinkedIn's own
 * published OIDC userinfo schema (sub/name/given_name/family_name/picture/
 * locale/email), since no LinkedIn account exists here yet to copy from.
 *
 * ── Why this goes through createUser ────────────────────────────────────
 *
 * A full OAuth round-trip isn't runnable in CI, but the trigger is the thing
 * under test and admin.createUser({ user_metadata }) fires it for real —
 * same approach the RLS suite uses. Nothing here reimplements the trigger's
 * logic, which is the failure mode a hand-rolled unit test would have.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`handle_new_user test cannot run: ${key} is not set.`);
}

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const created: string[] = [];

/** Creates a user with the given metadata and returns the profile the trigger produced. */
async function profileFor(metadata: Record<string, unknown>) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `trigger-${randomUUID()}@talentrah.test`,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  created.push(data.user.id);

  const { data: profile, error: readErr } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", data.user.id)
    .single();
  if (readErr) throw readErr;
  return profile;
}

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
}, 60_000);

describe("handle_new_user name derivation", () => {
  it("email signup: uses the explicit first_name/last_name our form sets", async () => {
    const p = await profileFor({
      first_name: "Amaka",
      last_name: "Obi",
      country: "NG",
      email_verified: true,
    });
    expect(p.first_name).toBe("Amaka");
    expect(p.last_name).toBe("Obi");
  });

  it("Google: splits full_name, since this project's Google accounts have no given_name", async () => {
    // Shape copied from real auth data in this project.
    const p = await profileFor({
      email_verified: true,
      full_name: "Chidi Okonkwo",
      name: "Chidi Okonkwo",
      avatar_url: "https://example.com/a.png",
      picture: "https://example.com/a.png",
      provider_id: "1234567890",
      iss: "https://accounts.google.com",
      sub: "1234567890",
    });
    expect(p.first_name, "OAuth signups must not be left nameless").toBe("Chidi");
    expect(p.last_name).toBe("Okonkwo");
  });

  it("LinkedIn (linkedin_oidc): prefers the given_name/family_name claims", async () => {
    // Shape per LinkedIn's published OIDC userinfo schema.
    const p = await profileFor({
      sub: "782bbtaQ",
      name: "Ngozi Adeyemi",
      given_name: "Ngozi",
      family_name: "Adeyemi",
      picture: "https://media.licdn.com/x.png",
      locale: "en-US",
      email_verified: true,
    });
    expect(p.first_name).toBe("Ngozi");
    expect(p.last_name).toBe("Adeyemi");
  });

  it("falls back to `name` when there is no full_name", async () => {
    const p = await profileFor({ name: "Tunde Bakare", email_verified: true });
    expect(p.first_name).toBe("Tunde");
    expect(p.last_name).toBe("Bakare");
  });

  it("keeps every part of a multi-word surname", async () => {
    const p = await profileFor({ full_name: "Ada Nwosu Eze" });
    expect(p.first_name).toBe("Ada");
    expect(p.last_name, "a surname must not be truncated to one token").toBe("Nwosu Eze");
  });

  it("a single-token name yields no surname rather than repeating the first", async () => {
    const p = await profileFor({ full_name: "Amaka" });
    expect(p.first_name).toBe("Amaka");
    expect(p.last_name).toBeNull();
  });

  it("explicit first_name still wins over provider claims", async () => {
    const p = await profileFor({
      first_name: "Preferred",
      given_name: "Given",
      full_name: "Full Name",
    });
    expect(p.first_name).toBe("Preferred");
  });

  it("blank/whitespace values are treated as absent, not stored", async () => {
    const p = await profileFor({ first_name: "   ", full_name: "Bola Ade" });
    expect(p.first_name, "a whitespace-only name must not win over a real one").toBe("Bola");
  });

  it("no usable name anywhere still yields NULL — the UI fallback stays necessary", async () => {
    const p = await profileFor({ email_verified: true, sub: "abc" });
    expect(p.first_name).toBeNull();
    expect(p.last_name).toBeNull();
  });
});
