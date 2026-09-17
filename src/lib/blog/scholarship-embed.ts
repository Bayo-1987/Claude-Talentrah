import { createClient } from "@supabase/supabase-js";
import { loadPublicScholarship } from "@/lib/scholarships/public";
import { daysUntil, formatDeadline } from "@/components/scholarships/scholarship-card";
import type { Database } from "@/lib/supabase/types";

/**
 * A plain anon-key client, deliberately NOT `@/lib/supabase/server`'s
 * cookie-aware one. The blog post page renders under ISR (`revalidate` in
 * src/app/blog/[slug]/page.tsx), and calling `cookies()` inside an ISR
 * render throws `DYNAMIC_SERVER_USAGE` — hit directly while verifying this
 * feature live, not a theoretical concern. The embed has no use for a
 * visitor's session anyway (no personalization, just a public fact looked
 * up by id), so it never touches `next/headers` at all: this client is
 * request-independent and safe to build once per module and reuse.
 */
const publicClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * Plain-text embed token an operator can drop into a blog post body:
 *
 *   [[scholarship:0199b1f2-3c4d-7e8f-9a0b-1c2d3e4f5a6b]]
 *
 * Bracket-and-colon, deliberately unlike every real Markdown construct
 * (links, images, reference definitions, footnotes all use different
 * delimiters), so it can't collide with real prose or real Markdown and
 * reads unambiguously as "not prose" to anyone skimming the raw body.
 *
 * Resolved to a live fact card BEFORE `marked.parse` — see render.ts's own
 * header comment for why post bodies never become MDX/JSX. This stays a
 * plain string substitution over Markdown text: the token can only ever
 * resolve to a scholarship id this server looks up itself, never to
 * arbitrary markup an author (or an attacker with admin access) supplies.
 *
 * Put it on its own line, blank line above and below — like any other
 * CommonMark HTML block, that's what makes `marked` pass the substituted
 * `<aside>` through untouched instead of folding it into a paragraph.
 */
export const SCHOLARSHIP_TOKEN =
  /\[\[scholarship:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

/**
 * Rendered when the token's id doesn't resolve to a currently-visible
 * listing — deleted, or moved off `verified` by the daily expiry sweep or a
 * provider takedown since the post was written. A post that goes on
 * referencing a closed listing with no explanation is worse than one that
 * says so plainly; this can never render as a broken embed or a stale
 * "Deadline: —".
 */
const FALLBACK_HTML =
  "<aside>" +
  "<p>This scholarship's listing has since closed — " +
  '<a href="/scholarships">browse current opportunities</a>.</p>' +
  "</aside>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface EmbeddableScholarship {
  provider: string;
  program_name: string;
  application_deadline: string | null;
  deadline_note: string | null;
}

/**
 * The fact strip itself: provider, programme, the REAL deadline via the same
 * formatDeadline/daysUntil helpers the scholarship card and detail page use
 * (not a third reimplementation of date formatting), and a link to the full
 * listing. Sanitized like the rest of the post body — see render.ts — so
 * even a bug here can never emit more than the existing allowlist permits.
 */
function factCardHtml(id: string, scholarship: EmbeddableScholarship): string {
  const left = daysUntil(scholarship.application_deadline);
  const deadlineText = scholarship.application_deadline
    ? formatDeadline(scholarship.application_deadline)
    : (scholarship.deadline_note ?? "Not published yet");
  const daysLeft =
    left !== null && left >= 0 ? ` · ${left} ${left === 1 ? "day" : "days"} left` : "";

  return (
    "<aside>" +
    `<p><strong>${escapeHtml(scholarship.provider)}</strong> — ${escapeHtml(scholarship.program_name)}</p>` +
    `<p>Deadline: ${escapeHtml(deadlineText)}${daysLeft}</p>` +
    `<a href="/scholarships/${id}">View this scholarship →</a>` +
    "</aside>"
  );
}

/**
 * Resolves every `[[scholarship:<id>]]` token in a post body to a live fact
 * card (or the fallback, if the listing is gone). Each distinct id is looked
 * up once, however many times it's referenced in the post. Must run before
 * `marked.parse` — see render.ts.
 *
 * Reads LIVE, every render — no caching layer sits in front of this, on
 * purpose. See sitemap.ts's own reasoning for the identical choice: the
 * entire point of this feature is to stop a post from stating a deadline
 * that can go stale, so a cached answer would silently reintroduce the exact
 * failure mode it exists to prevent.
 */
export async function resolveScholarshipEmbeds(body: string): Promise<string> {
  const ids = [...new Set([...body.matchAll(SCHOLARSHIP_TOKEN)].map((m) => m[1]!.toLowerCase()))];
  if (ids.length === 0) return body;

  const cards = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const scholarship = await loadPublicScholarship(id, publicClient);
      cards.set(id, scholarship ? factCardHtml(id, scholarship) : FALLBACK_HTML);
    }),
  );

  return body.replace(
    SCHOLARSHIP_TOKEN,
    (_match, id: string) => cards.get(id.toLowerCase()) ?? FALLBACK_HTML,
  );
}
