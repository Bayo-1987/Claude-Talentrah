import Link from "next/link";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

/**
 * send-385 — the signed-out-visitor entry point at `/mentorship`, replacing
 * what used to be a silent redirect to /login with no content of its own
 * (confirmed live by the 2026-09-19 SEO audit: HTTP 200, title/description
 * "Log in — Talentrah", zero unique content — a real, uncontested keyword
 * gap, since "mentorship for job seekers Nigeria" / "find a career mentor
 * Nigeria" both scored Easy-difficulty/High-opportunity precisely because
 * nothing else ranks for them today, including Talentrah itself).
 *
 * ── WHY THIS DOES NOT PREVIEW INDIVIDUAL MENTORS ──────────────────────────
 *
 * Investigated first, per the send's own instruction not to invent a new
 * public/private boundary. `mentor_profiles`' own SELECT policy (0133) is
 * `for select to authenticated` — no `anon` grant at all — and
 * `mentor_public_names()` (0167), the ONE existing mechanism that exposes a
 * mentor's identity beyond the raw table, explicitly
 * `revoke all ... from public, anon` and grants only to `authenticated`.
 * That was never a deliberate "keep mentors private from the public internet"
 * decision — it predates any signed-out-facing mentorship surface existing at
 * all — but it IS the codebase's current, real, considered boundary for a
 * real person's name/photo/rate, and widening it (or bypassing it with the
 * service-role client, which `jobs/[id]/job-for-request.ts`'s own header
 * explicitly warns against for exactly this class of decision: "RLS is what
 * decides whether this posting is visible... never the service role") is a
 * real privacy call this send does not make unilaterally. So this page
 * describes session TYPES (a fixed, non-personal enum already public in
 * spirit — mentorship/[mentorId]/page.tsx's own SESSION_TYPES) and the
 * documented pricing TIER range, never an individual mentor's identity. If a
 * public, browsable mentor directory is wanted later, that is a deliberate
 * follow-up decision, not a byproduct of an SEO fix.
 */

const SESSION_TYPES: { label: string; description: string }[] = [
  {
    label: "Mock interview",
    description: "Practice the real thing with someone who has actually run interviews for the role you want.",
  },
  {
    label: "Negotiation strategy for a specific offer",
    description: "Walk into a real offer conversation with a plan, not a guess.",
  },
  {
    label: "Career strategy",
    description: "Zoom out on where you're headed with someone who's navigated the same industry.",
  },
  {
    label: "Resume review",
    description: "A second, human opinion on your resume from someone who's actually hired for roles like yours.",
  },
  {
    label: "Quick question (15 min)",
    description: "One specific thing on your mind, answered without booking a full session.",
  },
];

export function MentorshipPublicLanding() {
  return (
    <Container className="flex max-w-[900px] flex-col gap-14 py-16">
      <div className="flex flex-col gap-4">
        <EyebrowLabel>Mentorship</EyebrowLabel>
        <h1 className="font-display text-[36px] leading-[1.15]">
          Real career mentors, for the moments Farah can&apos;t coach you through alone.
        </h1>
        <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
          Talentrah pairs job seekers in Nigeria and across Africa with real
          human mentors — people who have actually hired, interviewed, and
          negotiated for the kind of role you&apos;re going after.
        </p>
      </div>

      <div className="flex flex-col gap-4 border-t border-line pt-10">
        <EyebrowLabel>Farah coaches. Mentors decide with you.</EyebrowLabel>
        <div className="grid gap-6 sm:grid-cols-2">
          <BorderedCard className="flex flex-col gap-2 p-5">
            <h2 className="font-display text-[18px] font-semibold">Farah, day to day</h2>
            <p className="text-[14px] leading-[1.6] text-ink-soft">
              Farah&apos;s coaching stays informational and scalable —
              benchmarking your resume, talking points for an interview,
              practice questions. She&apos;s built into your feed and resume
              builder, always available.
            </p>
          </BorderedCard>
          <BorderedCard className="flex flex-col gap-2 p-5">
            <h2 className="font-display text-[18px] font-semibold">A mentor, when it&apos;s high-stakes</h2>
            <p className="text-[14px] leading-[1.6] text-ink-soft">
              A real mentor is for the moments that carry real stakes: a mock
              interview before the actual one, negotiating a specific offer,
              or a second opinion from someone who&apos;s hired for the exact
              kind of role you want. Farah is the on-ramp to mentorship, not a
              competitor to it.
            </p>
          </BorderedCard>
        </div>
      </div>

      <div className="flex flex-col gap-5 border-t border-line pt-10">
        <EyebrowLabel>What you can book a mentor for</EyebrowLabel>
        <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
          {SESSION_TYPES.map((type) => (
            <li key={type.label}>
              <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                <h3 className="font-body text-[14.5px] font-semibold text-ink">{type.label}</h3>
                <p className="text-[13.5px] leading-[1.5] text-ink-soft">{type.description}</p>
              </BorderedCard>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-10">
        <EyebrowLabel>Pricing</EyebrowLabel>
        <p className="max-w-[620px] text-[15px] leading-[1.65] text-ink-soft">
          Mentors set their own rates, typically from around ₦5,000 to
          ₦100,000+ depending on their experience and the kind of session —
          you pay the mentor directly for the session you book, not from
          Talentrah Credits. Some mentors offer sessions for free or as
          volunteers; that&apos;s always shown on their profile before you
          book, never a surprise afterward.
        </p>
      </div>

      <BorderedCard className="flex flex-col items-start gap-4 p-8">
        <h2 className="font-display text-[22px] font-semibold">Ready to find your mentor?</h2>
        <p className="max-w-[520px] text-[14.5px] text-ink-soft">
          Create a free account to browse approved mentors, see their real
          availability, and book a session — browsing and creating an account
          cost nothing; only booking a paid mentor&apos;s session does.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/signup?redirectTo=${encodeURIComponent("/mentorship")}`}
            className={buttonClasses("primary", "md", "no-underline")}
          >
            Create a free account
          </Link>
          <Link
            href={`/login?redirectTo=${encodeURIComponent("/mentorship")}`}
            className={buttonClasses("secondary", "md", "no-underline")}
          >
            Log in
          </Link>
        </div>
      </BorderedCard>
    </Container>
  );
}
