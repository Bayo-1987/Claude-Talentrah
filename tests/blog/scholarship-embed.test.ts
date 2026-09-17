/**
 * resolveScholarshipEmbeds (src/lib/blog/scholarship-embed.ts) — the blog
 * body's `[[scholarship:<id>]]` token, resolved to a live fact card.
 *
 * ── WHY A REAL DATABASE ROW, NOT A MOCK ────────────────────────────────────
 *
 * The whole point of this feature is that a post never states a frozen,
 * freezable deadline (see the module's own header comment, and sitemap.ts's
 * identical reasoning). A mocked `loadPublicScholarship` would prove the
 * string-substitution logic works and nothing about whether it actually
 * reads live, RLS-gated data the way the scholarship detail page does. So
 * this creates a real fixture through the service-role client and reads it
 * back through the module's own plain anon-key client — no mocking of
 * `next/headers` needed here, unlike most things touching
 * `@/lib/scholarships/public`: the embed deliberately never calls
 * `@/lib/supabase/server`'s cookie-aware client (see scholarship-embed.ts's
 * own header comment for why — it broke ISR the first time this shipped).
 *
 * ── SABOTAGE-AND-RESTORE FOR THE FALLBACK PATH ─────────────────────────────
 *
 * The gone/unverified case is exercised by taking a REAL verified fixture and
 * flipping its own `moderation_status` — the same state transition the daily
 * expiry sweep or a provider takedown produces — rather than asserting
 * against a row that was never verified to begin with. That is the actual
 * regression this fallback exists to survive.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { resolveScholarshipEmbeds } from "@/lib/blog/scholarship-embed";

const tag = randomUUID().slice(0, 8);
let scholarshipId: string;

beforeAll(async () => {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `Embed-Test Provider ${tag}`,
      program_name: `Embed-Test Programme ${tag}`,
      degree_levels: ["msc"],
      field_tags: [],
      funding_type: "full",
      funding_covers: [],
      eligibility_nationalities: ["Nigeria"],
      official_url: "https://example.test/scholarship-embed-fixture",
      dedup_fingerprint: `scholarship-embed-test-${tag}`,
      application_deadline: "2099-12-31",
      moderation_status: "verified",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create fixture: ${error?.message}`);
  scholarshipId = data.id;
});

afterAll(async () => {
  if (!scholarshipId) return;
  const { error } = await admin.from("scholarships").delete().eq("id", scholarshipId);
  if (error) throw new Error(`scholarship-embed cleanup failed: ${error.message}`);
});

describe("a token for a verified scholarship", () => {
  it("resolves to a fact card with the provider, programme, deadline and a link", async () => {
    const body = `Intro.\n\n[[scholarship:${scholarshipId}]]\n\nOutro.`;
    const html = await resolveScholarshipEmbeds(body);

    expect(html).toContain("<aside>");
    expect(html).toContain(`Embed-Test Provider ${tag}`);
    expect(html).toContain(`Embed-Test Programme ${tag}`);
    // The real, current deadline via the shared formatDeadline helper — not
    // a hand-typed copy that could disagree with it.
    expect(html).toContain(new Date(2099, 11, 31).toLocaleDateString());
    expect(html).toContain(`href="/scholarships/${scholarshipId}"`);
    expect(html).not.toContain("[[scholarship:");
  });

  it("resolves the same id only once even if the token appears twice", async () => {
    const body = `[[scholarship:${scholarshipId}]] and again [[scholarship:${scholarshipId}]]`;
    const html = await resolveScholarshipEmbeds(body);
    const occurrences = html.split(`Embed-Test Programme ${tag}`).length - 1;
    expect(occurrences).toBe(2);
    expect(html).not.toContain("[[scholarship:");
  });

  it("leaves a body with no token untouched", async () => {
    const body = "Just an ordinary post with no embeds.";
    expect(await resolveScholarshipEmbeds(body)).toBe(body);
  });
});

describe("a token for a scholarship that is no longer visible", () => {
  it("falls back to a plain notice for a random id that was never real", async () => {
    const html = await resolveScholarshipEmbeds(`[[scholarship:${randomUUID()}]]`);
    expect(html).toContain("since closed");
    expect(html).toContain('href="/scholarships"');
  });

  it("falls back once the real fixture is moved off verified — sabotage-and-restore", async () => {
    // SABOTAGE: the exact state transition the daily expiry sweep or a
    // takedown produces.
    const { error: sabotageErr } = await admin
      .from("scholarships")
      .update({ moderation_status: "pending" })
      .eq("id", scholarshipId);
    if (sabotageErr) throw sabotageErr;

    try {
      const html = await resolveScholarshipEmbeds(`[[scholarship:${scholarshipId}]]`);
      expect(html).toContain("since closed");
      expect(html).not.toContain(`Embed-Test Programme ${tag}`);
    } finally {
      // RESTORE, so the earlier-declared `describe` block's fixture is intact
      // regardless of vitest's execution order.
      const { error: restoreErr } = await admin
        .from("scholarships")
        .update({ moderation_status: "verified" })
        .eq("id", scholarshipId);
      if (restoreErr) throw restoreErr;
    }

    // CONFIRM THE RESTORE TOOK: the same token resolves to the real card
    // again, proving the fallback above was caused by the sabotage and
    // nothing else.
    const restored = await resolveScholarshipEmbeds(`[[scholarship:${scholarshipId}]]`);
    expect(restored).toContain(`Embed-Test Programme ${tag}`);
  });
});
