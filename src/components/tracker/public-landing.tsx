import Link from "next/link";
import { EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";
import { TRACKER_STAGES } from "@/lib/tracker/stages";

/**
 * send-484 — the signed-out visitor's entry point at `/tracker`, replacing a redirect to /login.
 *
 * STATIC: no props, no database. The page always answers 200, which is why /tracker is a static sitemap
 * entry. Every claim below is one the signed-in tracker actually delivers — manual entries, per-application
 * notes, a dated stage history, and the notice that an employer has opened your resume (0126) — because a
 * landing page for a feature that does not exist would be the false promise the copy rules forbid.
 *
 * The stages are read from TRACKER_STAGES, never typed out, and the copy never says how many there are
 * (tests/tracker/public-landing.test.tsx swaps the list for a stub and proves the page follows it).
 *
 * WHY THE GUTTERS ARE NOT `Container`: see components/jobs/public-landing.tsx.
 */

const SIGNUP_HREF = `/signup?redirectTo=${encodeURIComponent("/tracker")}`;
const LOGIN_HREF = `/login?redirectTo=${encodeURIComponent("/tracker")}`;

const SECTION = "flex flex-col gap-5 border-t border-line pt-10";

const FEATURES: Array<{ title: string; text: string }> = [
  {
    title: "Add jobs you found elsewhere",
    text: "Not every application starts on Talentrah. Add a job you found elsewhere by hand — company, role, where it is — and it sits alongside the rest.",
  },
  {
    title: "Keep notes on every application",
    text: "Who you spoke to, what they asked, what to follow up on. Notes stay with the application they belong to.",
  },
  {
    title: "A dated history of every move",
    text: "Each change of stage is recorded with its date, so you can see how long an application has been sitting where it is.",
  },
  {
    title: "See when an employer opens your resume",
    text: "For jobs you applied to through Talentrah, you can see when the employer first opened your resume. It is information only — it changes nothing for you or for them.",
  },
];

export function TrackerPublicLanding() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-14 py-6 sm:py-10">
      {/* A — hero */}
      <div className="flex flex-col gap-5">
        <EyebrowLabel>Job Tracker</EyebrowLabel>
        <h1 className="max-w-[820px] font-display text-[30px] leading-[1.15] sm:text-[36px]">
          Keep every application in one place, from saved to hired.
        </h1>
        <p className="max-w-[640px] text-[16px] leading-[1.6] text-ink-soft">
          Move each job through the stages as it happens, write notes against it, and never lose track of which applications are waiting on you and which are waiting on them.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
            Create a free account
          </Link>
          <Link
            href={LOGIN_HREF}
            className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
          >
            Already have one? Log in
          </Link>
        </div>
        <p className="max-w-[560px] font-display text-[14.5px] italic leading-[1.55] text-ink-soft">
          Reading this page needs no account. The tracker itself is free and uncapped with a free account.
        </p>
      </div>

      {/* B — the stages */}
      <section className={SECTION}>
        <EyebrowLabel>The stages</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">Every job is always somewhere on this line.</h2>
        <ol className="flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0">
          {TRACKER_STAGES.map((s, i) => (
            <li key={s.key} className="flex items-center gap-3 text-[15px] font-semibold text-ink">
              {i > 0 && (
                <span aria-hidden="true" className="text-ink-soft">
                  →
                </span>
              )}
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* C — what you can do */}
      <section className={SECTION}>
        <EyebrowLabel>What you can do</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">A record you keep for yourself.</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => (
            <BorderedCard key={f.title} className="flex flex-col gap-3 p-5">
              <h3 className="font-display text-[18px] font-semibold">{f.title}</h3>
              <p className="text-[14px] leading-[1.55] text-ink-soft">{f.text}</p>
            </BorderedCard>
          ))}
        </div>
      </section>

      {/* D — closing card */}
      <BorderedCard borderWidth="2" className="flex flex-col items-start gap-4 p-8">
        <h2 className="font-display text-[22px] font-semibold">Start your tracker.</h2>
        <p className="max-w-[560px] text-[14.5px] leading-[1.55] text-ink-soft">
          Create a free account, save a job from the feed or add one you applied to elsewhere, and keep the whole search in one place.
        </p>
        <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
          Create a free account
        </Link>
      </BorderedCard>
    </div>
  );
}
