import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { browseMentors } from "@/lib/mentorship/queries";
import { Container, EyebrowLabel, Card } from "@/components/ui";

export const metadata = { title: "Mentorship — Talentrah" };

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
 */
export default async function MentorshipPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
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
          className="inline-flex min-h-11 shrink-0 items-center justify-center border-[1.5px] border-ink px-4 font-body text-[13.5px] font-semibold text-ink no-underline hover:border-coral hover:text-coral"
        >
          Become a mentor
        </Link>
      </div>

      {error && <p className="text-[13.5px] text-coral">{error}</p>}

      {mentors.length === 0 ? (
        <p className="text-[14px] text-ink-soft">
          No mentors are listed yet — check back soon.
        </p>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2">
          {mentors.map((mentor) => (
            <li key={mentor.userId}>
              <Link href={`/mentorship/${mentor.userId}`} className="no-underline">
                <Card className="flex h-full flex-col gap-3 p-5">
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
                  {mentor.bio && (
                    <p className="line-clamp-3 text-[13.5px] text-ink-soft">{mentor.bio}</p>
                  )}
                  {[...mentor.expertiseRoles, ...mentor.expertiseIndustries].length > 0 && (
                    <p className="text-[12.5px] font-semibold text-ink">
                      {[...mentor.expertiseRoles, ...mentor.expertiseIndustries].slice(0, 4).join(" · ")}
                    </p>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
