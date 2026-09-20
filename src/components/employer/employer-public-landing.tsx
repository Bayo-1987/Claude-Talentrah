import Link from "next/link";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

/**
 * The signed-out-visitor entry point at `/employer`, replacing what used to
 * be a silent redirect to /login with no content of its own.
 *
 * robots.ts's own comment on this route already anticipated exactly this:
 * "If a public 'for employers' marketing page is ever built, it earns its
 * own Allow and its own title at that point." `/employer` was disallowed
 * and absent from sitemap.ts precisely because there was no real page here
 * to index (its only act was `getEmployerContext()` -> `requireUser()`) —
 * this component, plus this route's new getOptionalUser() branch in
 * page.tsx, is that page.
 *
 * Every feature named below is real and already shipped (see CLAUDE.md's
 * own "employer side exists" note) — Company Profile, free job posting,
 * Ad Campaigns (0046/0047/0048), and Analytics (0128, reads real ad_events
 * rows). Billing is deliberately NOT mentioned: it is still Phase 2 and
 * absent from the employer nav itself, so describing it here would be the
 * exact "legal and marketing copy describing unshipped features as live"
 * problem PR #16 already exists to prevent.
 */
export function EmployerPublicLanding() {
  return (
    <main id="main-content" className="py-20">
      <Container className="flex max-w-[820px] flex-col gap-14">
        <div className="flex flex-col gap-4">
          <EyebrowLabel>For employers</EyebrowLabel>
          <h1 className="font-display text-[36px] leading-[1.15]">
            Post a job in Nigeria, free — no card required.
          </h1>
          <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
            Reach job seekers across Nigeria and Africa who are already
            using Talentrah&apos;s AI-matched job feed. Create a company
            profile, post your first opening for free, and run a paid ad
            campaign when you want more reach.
          </p>
          <div className="mt-2">
            <Link
              href="/signup?redirectTo=%2Femployer%2Fonboarding"
              className={buttonClasses("primary", "md", "no-underline")}
            >
              Create a free account to post a job
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-5 border-t border-line pt-10">
          <EyebrowLabel>What&apos;s included</EyebrowLabel>
          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
            <li>
              <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                <h2 className="font-body text-[14.5px] font-semibold text-ink">Free job posting</h2>
                <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                  Post an opening and it goes straight into the same
                  AI-matched feed seekers already use — no fee for a
                  standard listing.
                </p>
              </BorderedCard>
            </li>
            <li>
              <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                <h2 className="font-body text-[14.5px] font-semibold text-ink">Company profile</h2>
                <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                  A verified profile candidates see before they apply —
                  verification runs off your work email domain, not a manual
                  form.
                </p>
              </BorderedCard>
            </li>
            <li>
              <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                <h2 className="font-body text-[14.5px] font-semibold text-ink">Ad campaigns</h2>
                <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                  Promote a listing for more visibility once free reach
                  isn&apos;t enough — reviewed before it goes live, billed
                  per day it actually runs.
                </p>
              </BorderedCard>
            </li>
            <li>
              <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                <h2 className="font-body text-[14.5px] font-semibold text-ink">Analytics</h2>
                <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                  Real impression, click, and application numbers for every
                  posting and campaign — not a vanity view count.
                </p>
              </BorderedCard>
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-10">
          <EyebrowLabel>Built for employers hiring in Nigeria and Africa</EyebrowLabel>
          <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
            Talentrah is built around the roles and candidates local and
            diaspora employers actually hire for here — not a global job
            board with a Nigeria filter bolted on. The same matching engine
            that ranks your listing for candidates is what powers
            Talentrah&apos;s own seeker-side job feed.
          </p>
        </div>

        <BorderedCard className="flex flex-col gap-3 p-8">
          <h2 className="font-display text-[20px] font-semibold">Already have an account?</h2>
          <p className="max-w-[560px] text-[14px] text-ink-soft">
            Sign in to post a job, check your applicants, or manage an
            existing campaign.
          </p>
          <Link href="/login?redirectTo=%2Femployer" className="w-fit text-[13.5px] font-semibold text-rust underline underline-offset-2">
            Log in →
          </Link>
        </BorderedCard>
      </Container>
    </main>
  );
}
