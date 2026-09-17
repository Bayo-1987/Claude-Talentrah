/**
 * A standing check that every `[[scholarship:<uuid>]]` token in a PUBLISHED
 * post actually points at a real `scholarships` row.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * scholarship-embed.ts's resolution pass already degrades gracefully when a
 * token's id doesn't resolve — it renders the "since closed" fallback rather
 * than breaking the page (see scholarship-embed.test.ts for that behaviour).
 * That's the right outcome for a scholarship that legitimately closes AFTER
 * a post is published — expected, not a mistake. But nothing distinguishes
 * that case from a single wrong hex character in a hand-typed UUID, which
 * would render the identical fallback to a real reader with nothing in CI
 * ever catching it. This is the same class of "easy to make once, easy to
 * miss until a user hits it" mistake tests/rls/column-privileges.test.ts
 * exists for on a different table.
 *
 * Deliberately does NOT check `moderation_status` or `application_deadline`
 * — a scholarship closing after a post ships is real, expected, and already
 * handled by the embed's own fallback UI. The only thing worth catching
 * automatically is a token that never pointed at a real row in the first
 * place, so this checks existence only.
 *
 * Reuses `SCHOLARSHIP_TOKEN` from scholarship-embed.ts rather than a second,
 * independently-maintained regex — exactly the "one source of truth" lesson
 * CLAUDE.md draws from the profiles/catalog duplication incidents.
 */
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { SCHOLARSHIP_TOKEN } from "@/lib/blog/scholarship-embed";

interface EmbedReference {
  slug: string;
  id: string;
}

function extractEmbedReferences(posts: { slug: string; body: string }[]): EmbedReference[] {
  const refs: EmbedReference[] = [];
  for (const post of posts) {
    for (const match of post.body.matchAll(SCHOLARSHIP_TOKEN)) {
      refs.push({ slug: post.slug, id: match[1]!.toLowerCase() });
    }
  }
  return refs;
}

/**
 * Service role, deliberately: this must see every published post's real
 * body and must check `scholarships` existence UNFILTERED by
 * moderation_status (RLS would hide a since-unverified row, which would
 * make this check indistinguishable from the "never existed" case it's
 * actually looking for).
 */
async function findBrokenScholarshipEmbeds(): Promise<EmbedReference[]> {
  const { data: posts, error: postsErr } = await admin
    .from("blog_posts")
    .select("slug, body")
    .eq("status", "published");
  if (postsErr) throw postsErr;

  const refs = extractEmbedReferences(posts ?? []);
  if (refs.length === 0) return [];

  const ids = [...new Set(refs.map((r) => r.id))];
  const { data: rows, error: schErr } = await admin.from("scholarships").select("id").in("id", ids);
  if (schErr) throw schErr;

  const existing = new Set((rows ?? []).map((r) => r.id.toLowerCase()));
  return refs.filter((r) => !existing.has(r.id));
}

describe("every scholarship embed token in a published post resolves to a real row", () => {
  it("finds no broken references among currently published posts", async () => {
    const broken = await findBrokenScholarshipEmbeds();
    expect(
      broken,
      broken
        .map((b) => `post "${b.slug}" embeds a scholarship id that does not exist: ${b.id}`)
        .join("\n"),
    ).toEqual([]);
  });

  describe("proof: a token that never pointed at a real row is caught", () => {
    const tag = randomUUID().slice(0, 8);
    const slug = `embed-id-check-fixture-${tag}`;
    const badId = randomUUID();

    afterEach(async () => {
      const { error } = await admin.from("blog_posts").delete().eq("slug", slug);
      if (error) throw new Error(`fixture cleanup failed: ${error.message}`);
    });

    it("flags a published post whose token points at a nonexistent scholarship", async () => {
      const { error } = await admin.from("blog_posts").insert({
        slug,
        title: `Embed id check fixture ${tag}`,
        description: "Throwaway fixture for scholarship-embed-ids.test.ts — deleted immediately after.",
        author: "Test Fixture",
        body: `Intro.\n\n[[scholarship:${badId}]]\n\nOutro.`,
        status: "published",
        published_at: new Date().toISOString(),
      });
      if (error) throw error;

      const broken = await findBrokenScholarshipEmbeds();
      const match = broken.find((b) => b.slug === slug);

      expect(match, `expected the fixture post "${slug}" to be flagged for id ${badId}`).toBeDefined();
      expect(match!.id).toBe(badId.toLowerCase());
    });
  });
});
