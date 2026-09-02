import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/seo/site";
import { LANDING_PAGE_MIN_ENTRIES, currentApplicationCycle } from "@/lib/seo/landing-pages";
import { liveScholarshipLandingLinks } from "@/lib/seo/landing-page-links";
import { loadFullyFundedScholarships } from "@/lib/seo/landing-page-data";
import { PublicScholarshipRow } from "@/components/scholarships/public-scholarship-row";
import { EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * Programmatic SEO landing page targeting "fully funded scholarships for
 * Nigerian students" and the year-stamped variant ("...2026/2027") — the
 * pattern ScholarshipTab's own nationality×funding-type pages target.
 *
 * NO .eq("moderation_status", "verified") FILTER GAP TO WORRY ABOUT — same
 * reasoning as sitemap.ts and /scholarships/[id]: RLS (0084) already scopes
 * every read through this anon-scoped client to verified rows only. The
 * `.eq(...)` in loadFullyFundedScholarships is written anyway, unlike those
 * two — it is not a SECURITY filter (RLS is), it is what turns "every
 * verified row" into "every verified row that is ALSO fully funded", which
 * nothing else provides.
 *
 * LIVE, NOT BUILD-TIME — see loadFullyFundedScholarships
 * (src/lib/seo/landing-page-data.ts) and
 * tests/seo/landing-page-liveness.test.ts for the proof.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const supabase = await createClient();
  const { total } = await loadFullyFundedScholarships(supabase);
  if (total < LANDING_PAGE_MIN_ENTRIES) return { title: "Scholarships — Talentrah" };

  const cycle = currentApplicationCycle();
  const title = `Fully Funded Scholarships for Nigerian Students ${cycle} | Talentrah`;
  const description = `${total} fully funded scholarships open for the ${cycle} cycle — tuition, stipend and travel covered. Verified against each provider's official page, always linked and attributed.`;
  return pageMetadata({ title, description, path: "/scholarships/fully-funded" });
}

export default async function FullyFundedScholarshipsPage() {
  const supabase = await createClient();
  const { total, scholarships } = await loadFullyFundedScholarships(supabase);
  if (total < LANDING_PAGE_MIN_ENTRIES) notFound();

  const cycle = currentApplicationCycle();
  const relatedLinks = await liveScholarshipLandingLinks(supabase, "/scholarships/fully-funded");

  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <Link
        href="/"
        className="inline-flex min-h-10 min-w-10 items-center self-start text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Talentrah home
      </Link>

      <div>
        <EyebrowLabel>No tuition bill, no guesswork</EyebrowLabel>
        <h1 className="mt-1.5 text-[28px] leading-[1.2]">
          Fully Funded Scholarships for Nigerian Students {cycle}
        </h1>
        <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
          {total} fully funded programmes are open for the {cycle} cycle, each verified against
          its own official page rather than copied from a listing service. &quot;Fully funded&quot;
          here means tuition plus a stipend, travel or both, stated by the provider itself — not
          Talentrah&apos;s own guess at what a scholarship is worth.
        </p>
      </div>

      {relatedLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-y border-line py-3 text-[13px]">
          <span className="font-semibold text-ink-soft">Also browsing:</span>
          {relatedLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-rust underline underline-offset-2 hover:text-rust-hover">
              {l.label}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {scholarships.map((s) => (
          <PublicScholarshipRow key={s.id} scholarship={s} />
        ))}
      </div>

      {total > scholarships.length && (
        <p className="text-[13.5px] text-ink-soft">
          Showing {scholarships.length} of {total} fully funded programmes.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <Link
          href={`/signup?redirectTo=${encodeURIComponent("/scholarships")}`}
          className={buttonClasses("primary", "sm", "no-underline w-fit")}
        >
          Create a free account to save and track these
        </Link>
        <p className="text-[12.5px] text-ink-soft">
          Saving and tracking deadlines is free and unlimited. Farah can also check your
          eligibility against any listing here for a small number of credits.
        </p>
      </div>
    </div>
  );
}
