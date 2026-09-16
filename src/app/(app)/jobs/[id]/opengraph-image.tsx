import { notFound } from "next/navigation";
import { jobForRequest } from "./job-for-request";
import { OG_CONTENT_TYPE, OG_IMAGE_SIZE, renderOgCard } from "@/lib/seo/og-card";
import { dedupeMetaParts } from "@/components/jobs/job-card";

/**
 * The share card for one job posting — the single most-forwarded link on the
 * site, and until now indistinguishable from the homepage's.
 *
 * `alt` is deliberately generic: Next reads it as a plain module export, so it
 * cannot vary per job the way the rendered card does. The per-job detail lives
 * in og:title/og:description, which generateMetadata already builds from the
 * row.
 *
 * NOT statically cached, and not by omission: `jobForRequest` goes through the
 * cookie-backed Supabase client, which is a request-time API, so this route is
 * dynamic for the same reason and to the same degree the page is. That is the
 * behaviour we want — the card must stop existing the moment the posting does.
 */
export const alt = "Job opening on Talentrah";
export const size = OG_IMAGE_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /*
   * The SAME loader the page and generateMetadata call — one query definition,
   * one freshness floor, one RLS client. A crawler must never be handed a card
   * for a posting whose page 404s, so this mirrors generateMetadata's own gate
   * exactly: `!data` after the 30-day `posted_at` floor, nothing else. (Two
   * separate requests, so React's cache() buys no dedup across them; what it
   * buys is that the rule cannot drift between the two files.)
   */
  const { data } = await jobForRequest(id);
  if (!data) notFound();

  return renderOgCard({
    /*
     * A CLOSED posting is not a 404 here, and that was checked rather than
     * assumed: /jobs/<id> answers 200 for `status != 'open'` and renders the
     * posting in full under a "This posting is no longer open." line (see
     * page.tsx). So the card has to exist for it — and has to say the same
     * thing the page says, or a forwarded link would advertise a closed role
     * as an opening. Same wording as the page, per the one-term-per-concept
     * rule; nothing here invents a fourth status label.
     */
    eyebrow: data.status === "open" ? "Job opening" : "No longer open",
    headline: data.title,
    // Company and where, deduped the same way the job card's own meta row
    // does it — a posting whose location IS the company name should not read
    // "Acme · Acme".
    supporting: dedupeMetaParts([
      data.company_name,
      data.location?.split(";")[0]?.trim() ?? null,
    ]).join(" · "),
  });
}
