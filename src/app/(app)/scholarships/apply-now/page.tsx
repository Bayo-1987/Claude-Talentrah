import { cache } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/auth/require-user";
import { pageMetadata } from "@/lib/seo/site";
import { LANDING_PAGE_MIN_ENTRIES, DEGREE_LEVEL_SLUG, currentApplicationCycle } from "@/lib/seo/landing-pages";
import { loadFullyFundedScholarships, loadScholarshipsByLevel } from "@/lib/seo/landing-page-data";
import { loadScholarshipHubPosts } from "@/lib/seo/scholarship-hub-posts";
import { DEGREE_LEVEL_LABEL } from "@/lib/scholarships/types";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

/**
 * send-387 Part 1 — a pillar/hub page tying together content that already
 * exists: the six scholarship deep-dive posts and the funding-type/
 * degree-level programmatic landing pages (landing-pages.ts). This is
 * ASSEMBLY, not new authoring — no scholarship content is rewritten or
 * duplicated here, only linked to.
 *
 * Evergreen URL (/scholarships/apply-now), not a year-stamped one — the
 * SAME reasoning currentApplicationCycle() itself exists for: the cycle
 * advances on its own every year and a URL should not need renaming to
 * match. The cycle still appears in the on-page copy and metadata, computed
 * fresh, never hardcoded.
 *
 * LIVE, NOT BUILD-TIME, same as every sibling landing page in this feature:
 * force-dynamic, and every landing-page link below is only rendered once
 * its own live count clears LANDING_PAGE_MIN_ENTRIES — reusing
 * loadFullyFundedScholarships/loadScholarshipsByLevel (landing-page-data.ts)
 * rather than re-deriving the count query, so this can never claim a URL
 * that would 404 underneath it.
 */
export const dynamic = "force-dynamic";

const hubDataForRequest = cache(async () => {
  const supabase = await createClient();
  const [posts, fullyFunded, ...byLevel] = await Promise.all([
    loadScholarshipHubPosts(),
    loadFullyFundedScholarships(supabase),
    // loadScholarshipsByLevel takes the URL SLUG (hyphenated), not the enum
    // key — Object.values here, not Object.keys, is load-bearing: passing
    // the enum key for postgraduate_diploma would silently fail to resolve
    // via degreeLevelFromSlug and drop that level from the hub with no
    // error.
    ...Object.values(DEGREE_LEVEL_SLUG).map((slug) => loadScholarshipsByLevel(supabase, slug)),
  ]);
  return { posts, fullyFunded, byLevel: byLevel.filter((r) => r !== null) };
});

export async function generateMetadata() {
  const cycle = currentApplicationCycle();
  const title = `Scholarships Open for ${cycle}: Every Deadline in One Place — Talentrah`;
  const description = `PTDF, Mastercard Foundation, Rhodes, Chevening, the Trudeau Foundation and Gates Cambridge — the ${cycle} scholarship deadlines Nigerian and African students are tracking right now, in one page.`;
  return pageMetadata({ title, description, path: "/scholarships/apply-now" });
}

export default async function ScholarshipApplyNowPage() {
  const { posts, fullyFunded, byLevel } = await hubDataForRequest();
  const cycle = currentApplicationCycle();
  const session = await getOptionalUser();

  return (
    <Container className="flex max-w-[820px] flex-col gap-10 py-12">
      <Link
        href={session ? "/scholarships" : "/"}
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Talentrah home
      </Link>

      <div>
        <EyebrowLabel>Scholarship application cycle</EyebrowLabel>
        <h1 className="mt-1.5 text-[28px] leading-[1.2]">
          Scholarships open for the {cycle} cycle.
        </h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
          A running list of the specific programmes Nigerian and African
          students are applying to right now — each one covered in full on
          its own page, plus every other open scholarship by funding type
          and degree level.
        </p>
      </div>

      {posts.length > 0 && (
        <div className="flex flex-col gap-4 border-t border-line pt-8">
          <EyebrowLabel>This cycle&apos;s deadlines, explained</EyebrowLabel>
          <ul className="flex list-none flex-col gap-0 border-t border-line p-0">
            {posts.map((post) => (
              <li key={post.slug} className="border-b border-line py-5">
                <Link href={`/blog/${post.slug}`} className="flex flex-col gap-1 no-underline hover:text-rust">
                  <h2 className="text-[17px] font-semibold text-ink">{post.title}</h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">{post.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-line pt-8">
        <EyebrowLabel>Browse every open scholarship</EyebrowLabel>
        <div className="flex flex-wrap gap-3">
          {fullyFunded.total >= LANDING_PAGE_MIN_ENTRIES && (
            <Link href="/scholarships/fully-funded" className={buttonClasses("secondary", "sm", "no-underline")}>
              Fully funded ({fullyFunded.total})
            </Link>
          )}
          {byLevel
            .filter((entry) => entry!.total >= LANDING_PAGE_MIN_ENTRIES)
            .map((entry) => (
              <Link
                key={entry!.level}
                href={`/scholarships/degree/${DEGREE_LEVEL_SLUG[entry!.level]}`}
                className={buttonClasses("secondary", "sm", "no-underline")}
              >
                {DEGREE_LEVEL_LABEL[entry!.level]} ({entry!.total})
              </Link>
            ))}
        </div>
      </div>

      <BorderedCard className="flex flex-col gap-3 p-8">
        <h2 className="font-display text-[20px] font-semibold">
          Want Farah to check your eligibility first?
        </h2>
        <p className="max-w-[560px] text-[14px] text-ink-soft">
          {session
            ? "Browse the full scholarship catalog and let Farah check your eligibility for a specific programme."
            : "Create a free account to browse the full scholarship catalog and check your eligibility for a specific programme."}
        </p>
        <Link
          href={session ? "/scholarships" : `/signup?redirectTo=${encodeURIComponent("/scholarships")}`}
          className={buttonClasses("primary", "md", "no-underline w-fit")}
        >
          {session ? "Browse scholarships" : "Create a free account"}
        </Link>
      </BorderedCard>
    </Container>
  );
}
