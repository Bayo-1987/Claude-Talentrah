import Link from "next/link";
import { getOptionalUser } from "@/lib/auth/require-user";
import { browseMentors } from "@/lib/mentorship/queries";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { stripInlineMarkdown } from "@/lib/farah/render-markdown";
import { MentorshipPublicLanding } from "@/components/mentorship/public-landing";
import { pageMetadata } from "@/lib/seo/site";
import { getApprovedMentorPriceRangeNgn } from "@/lib/mentorship/public-price-range";

/**
 * send-385 — real metadata for the signed-out visitor, who is now served a
 * real page instead of the redirect-to-/login this route always used to
 * carry. `getOptionalUser()` (not `requireUser()`, and cheap: React `cache()`
 * de-dupes it against the identical call the page component below makes in
 * the same request) is what makes this a BRANCH rather than a fork — a
 * signed-in visitor keeps the exact plain title this page always had, no
 * regression to the authenticated experience's own metadata.
 *
 * send-393 — the description's price clause now reads the real, current
 * floor from getApprovedMentorPriceRangeNgn() rather than a hardcoded
 * figure (see that function's own header for why "from ₦5,000" was wrong
 * and why this reads live rather than trusting any snapshot, including this
 * comment's own). No price clause at all when there are zero qualifying
 * mentors — see that same header for why that beats a fallback number.
 */
export async function generateMetadata() {
  const session = await getOptionalUser();
  if (session) return { title: "Mentorship — Talentrah" };

  const priceRange = await getApprovedMentorPriceRangeNgn();
  const priceClause =
    priceRange !== null ? `, from ₦${priceRange.minNgn.toLocaleString("en-NG")} a session` : "";

  return pageMetadata({
    title: "Mentorship for Job Seekers in Nigeria & Africa — Talentrah",
    description:
      `Book a real career mentor for a mock interview, offer negotiation, or resume review — human mentorship for job seekers across Nigeria and Africa${priceClause}.`,
    path: "/mentorship",
  });
}

/**
 * Discovery (send-137, build-prompt §6.11 v1 slice). Approved mentors only —
 * `browseMentors()` reads through 0133's own RLS, which is the actual gate;
 * this page adds no filtering of its own.
 *
 * A signed-in user browses here whether or not they are themselves a mentor
 * — the dual-role case (§2.5's flywheel: a hired seeker graduating into a
 * mentor) needs no special handling on this page, because `mentor_profiles`
 * is keyed to `profiles.id` rather than columns on `profiles` itself, so
 * being a mentor never changes what a person sees as a mentee.
 *
 * send-385 — signed-out branch added above the existing signed-in body,
 * which is otherwise untouched: same query, same markup, same behavior. See
 * components/mentorship/public-landing.tsx's own header for why that public
 * page describes session TYPES and pricing TIERS rather than previewing any
 * individual mentor's identity.
 */
export default async function MentorshipPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getOptionalUser();
  if (!session) {
    // React cache() dedupes this against generateMetadata()'s identical
    // call in the same request — see public-price-range.ts's own header.
    const priceRange = await getApprovedMentorPriceRangeNgn();
    return <MentorshipPublicLanding priceRangeNgn={priceRange} />;
  }

  const [mentors, { error }] = await Promise.all([browseMentors(), searchParams]);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <EyebrowLabel>Mentorship</EyebrowLabel>
          <h1 className="font-display text-[28px] font-semibold">
            Talk to someone who&apos;s done it.
          </h1>
          <p className="max-w-[560px] text-[14.5px] text-ink-soft">
            Farah can benchmark and coach — a human mentor is for the moments
            that carry real stakes: a mock interview, a negotiation for a
            specific offer, or a second opinion on your resume from someone
            who&apos;s hired.
          </p>
        </div>
        <Link
          href="/mentorship/apply"
          className="inline-flex min-h-11 shrink-0 items-center justify-center border-[1.5px] border-ink px-4 font-body text-[13.5px] font-semibold text-ink no-underline hover:border-rust hover:text-rust"
        >
          Become a mentor
        </Link>
      </div>

      {error && <p className="text-[13.5px] text-rust">{error}</p>}

      {mentors.length === 0 ? (
        <p className="text-[14px] text-ink-soft">
          No mentors are listed yet — check back soon.
        </p>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2">
          {mentors.map((mentor) => (
            <li key={mentor.userId}>
              <Link href={`/mentorship/${mentor.userId}`} className="no-underline">
                <BorderedCard className="flex h-full flex-col gap-3 p-5">
                  <h2 className="font-display text-[18px] font-semibold text-ink">
                    {mentor.name}
                  </h2>
                  <p className="text-[13px] text-ink-soft">
                    {mentor.basePriceNgn != null
                      ? `From ₦${mentor.basePriceNgn.toLocaleString()} / session`
                      : "Free / volunteer"}
                    {mentor.reviewCount > 0 && mentor.averageRating != null && (
                      <> · {mentor.averageRating.toFixed(1)}★ ({mentor.reviewCount})</>
                    )}
                  </p>
                  {/*
                    send-369 — bio can now carry markdown syntax; a
                    line-clamp-3 excerpt is the wrong register for rich
                    formatting (same reasoning as extract-jd.ts's
                    stripMarkdownToPlainText for the job feed card), so this
                    card strips to plain text and only the full profile page
                    (mentorId/page.tsx) renders it richly. stripInlineMarkdown
                    (send-370/371/373's shared minimal-grammar plumbing) is
                    now the one canonical plain-text stripper for this
                    grammar — a bare URL has no syntax to strip either way,
                    so it survives untouched here same as everywhere else.
                  */}
                  {mentor.bio && (
                    <p className="line-clamp-3 text-[13.5px] text-ink-soft">
                      {stripInlineMarkdown(mentor.bio)}
                    </p>
                  )}
                  {[...mentor.expertiseRoles, ...mentor.expertiseIndustries].length > 0 && (
                    <p className="text-[12.5px] font-semibold text-ink">
                      {[...mentor.expertiseRoles, ...mentor.expertiseIndustries].slice(0, 4).join(" · ")}
                    </p>
                  )}
                </BorderedCard>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
