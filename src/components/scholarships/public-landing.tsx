import Link from "next/link";
import { publicDeadlineNote } from "@/lib/scholarships/public-deadline-note";
import { EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { SCHOLARSHIP_DEADLINE_REMINDER_DAYS } from "@/lib/scholarship-deadline-alerts/select";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL, SAVE_STATUS_LABEL } from "@/lib/scholarships/types";
import { Constants, type Tables } from "@/lib/supabase/types";
import { scholarshipDeadlineDisplay } from "@/lib/scholarships/close-instant";
import { DeadlineLine } from "@/components/scholarships/deadline-line";
import { formatCalendarDate } from "@/lib/format/datetime";

/**
 * send-480 — the signed-out visitor's entry point at `/scholarships`, replacing what
 * used to be a redirect to /login (a 307 from proxy.ts, before any page ran). Same
 * shape as `MentorshipPublicLanding` (send-385): a presentational component with NO
 * database access of its own — the page fetches and passes everything down.
 *
 * ── NUMBERS ARE NEVER HARDCODED ───────────────────────────────────────────────────
 * Every figure below is read from the constant that owns it: credit costs from
 * CREDIT_COSTS, the reminder window from SCHOLARSHIP_DEADLINE_REMINDER_DAYS, the
 * category threshold from LANDING_PAGE_MIN_ENTRIES, and the four application steps
 * from the scholarship_save_status enum with the labels the app itself uses.
 * tests/scholarships/public-landing.test.tsx swaps those constants for stubs and
 * proves the copy follows them.
 *
 * ── WHY THE GUTTERS ARE NOT `Container` ───────────────────────────────────────────
 * AppShell's signed-out branch already wraps every page in `px-6` / `min-[760px]:px-10`.
 * `Container` adds its own `px-10` on top, and `cn()` is a plain join (not twMerge),
 * so overriding it with `px-0` is a stylesheet-order coin toss. Stacked, the two leave
 * 232px of content at a 360px viewport. A plain width-constrained div lets the shell's
 * gutters apply exactly once.
 *
 * ── THE DEADLINE-NOTE GUARD IS A HEURISTIC ────────────────────────────────────────
 * `deadline_note` is meant for a provider's own short "varies by partner" style text,
 * but it is a bare `text` column with no length limit or check, and one live listing
 * carries a paragraph of internal reviewer instructions there (issue #594). This page
 * shows a note only when it is 140 characters or fewer, and otherwise says to see the
 * official listing. That catches long reviewer prose; it does NOT catch a short one,
 * and it changes nothing about the detail page or the list cards.
 */

export interface LandingFacet {
  href: string;
  label: string;
  count: number;
}

export type LandingListing = Pick<
  Tables<"scholarships">,
  | "id"
  | "provider"
  | "program_name"
  | "host_institution"
  | "degree_levels"
  | "funding_type"
  | "application_deadline"
  | "close_time"
  | "close_tz"
  | "deadline_note"
  | "deadline_verified_at"
  | "official_url"
>;

/** The longest deadline_note this page will print. See the header: a heuristic, not a guarantee. */
export const DEADLINE_NOTE_MAX_CHARS = 140;
export const DEADLINE_NOTE_FALLBACK = "See the official listing for the deadline";

/**
 * "2 Oct 2026": the app's one calendar-date format (src/lib/format/datetime.ts), which this file used to build by hand to
 * avoid the server locale's `10/2/2026` (2 October or 10 February?). Null for anything that is not a real YYYY-MM-DD date.
 */
function formatDeadlineLong(deadline: string): string | null {
  return formatCalendarDate(deadline) || null;
}

export function deadlineDisplay(l: Pick<LandingListing, "application_deadline" | "close_time" | "close_tz" | "deadline_note" | "deadline_verified_at">): {
  text: string;
  urgent: boolean;
  labelled: boolean;
} {
  if (l.application_deadline) {
    const date = formatDeadlineLong(l.application_deadline);
    if (date) {
      // The countdown shows only when it is urgent (within 14 days, under a day, or the date is current or over somewhere); otherwise the bare date.
      const shown = scholarshipDeadlineDisplay(l, new Date(), { detailed: false, showClosed: false });
      if (shown?.urgent) return { text: shown.text, urgent: true, labelled: shown.labelled };
      return { text: date, urgent: false, labelled: true };
    }
  }
  const note = publicDeadlineNote(l);
  if (note) {
    return {
      text: note.length <= DEADLINE_NOTE_MAX_CHARS ? note : DEADLINE_NOTE_FALLBACK,
      urgent: false,
      labelled: true,
    };
  }
  return { text: "Not published yet", urgent: false, labelled: true };
}

const SIGNUP_HREF = `/signup?redirectTo=${encodeURIComponent("/scholarships")}`;
const LOGIN_HREF = `/login?redirectTo=${encodeURIComponent("/scholarships")}`;

const SECTION = "flex flex-col gap-5 border-t border-line pt-10";

function ListingRow({ listing }: { listing: LandingListing }) {
  const { text, urgent, labelled } = deadlineDisplay(listing);
  return (
    <li>
      <BorderedCard className="flex flex-col gap-2.5 p-5">
        <div>
          <span className="font-body text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {listing.provider}
          </span>
          <h3 className="text-[17px]">
            <Link
              href={`/scholarships/${listing.id}`}
              className="inline-flex min-h-6 items-center text-ink no-underline hover:text-rust hover:underline"
            >
              {listing.program_name}
            </Link>
          </h3>
          {listing.host_institution && (
            <span className="text-[13px] text-ink-soft">{listing.host_institution}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {listing.degree_levels.map((level) => (
            <span
              key={level}
              className="inline-flex min-h-6 items-center border border-line px-2 text-[11.5px] font-semibold text-ink-soft"
            >
              {DEGREE_LEVEL_LABEL[level]}
            </span>
          ))}
          <span className="inline-flex min-h-6 items-center border border-line px-2 text-[11.5px] font-semibold text-ink-soft">
            {FUNDING_TYPE_LABEL[listing.funding_type]}
          </span>
        </div>

        <span className="text-[13px] text-ink-soft">
          <DeadlineLine text={text} urgent={urgent} labelled={labelled} calmClassName="text-ink-soft" valueDataAttr="value" />
        </span>

        <a
          href={listing.official_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center self-start text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
        >
          Official listing ↗
        </a>
      </BorderedCard>
    </li>
  );
}

const FACTS: Array<{ label: string; text: string }> = [
  { label: "Who funds it", text: "The provider and the host institution where you'd actually study." },
  { label: "What it covers", text: "Degree level, and whether funding is full or partial — tuition, stipend, travel." },
  { label: "Who can apply", text: "Nationality, prior degree, age limits and any other stated requirement." },
  {
    label: "The deadline",
    text: "A date confirmed against the official page, the provider's own note where there is no single date, or “not published yet”. Never estimated.",
  },
  { label: "The official source", text: "A direct link on every listing. The provider's own page always has the final word." },
];

export function ScholarshipsPublicLanding({
  facets,
  listings,
  listingsError = false,
}: {
  facets: LandingFacet[];
  listings: LandingListing[];
  /** True when the listing query failed: say so, rather than claiming nothing is open. */
  listingsError?: boolean;
}) {
  const steps = Constants.public.Enums.scholarship_save_status.map((s) => SAVE_STATUS_LABEL[s]);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-14 py-6 sm:py-10">
      {/* A — hero */}
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
        <div className="flex flex-col gap-5">
          <EyebrowLabel>Scholarships</EyebrowLabel>
          <h1 className="font-display text-[30px] leading-[1.15] sm:text-[36px]">
            Scholarships open to applicants from Nigeria and across Africa — deadline confirmed at the source, or not shown at all.
          </h1>
          <p className="max-w-[640px] text-[16px] leading-[1.6] text-ink-soft">
            Fully and partly funded programmes for BSc, MSc and PhD study, wherever they&apos;re hosted. Every listing names who funds it, who can apply, and links to the official page.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
              Create a free account
            </Link>
            <Link href="/scholarships/apply-now" className={buttonClasses("secondary", "md", "no-underline")}>
              Read this cycle&apos;s application guide
            </Link>
          </div>
          <p className="max-w-[560px] font-display text-[14.5px] italic leading-[1.55] text-ink-soft">
            Reading every listing is free and needs no account. An account lets you save, track and get deadline reminders.
          </p>
        </div>

        {facets.length > 0 && (
          <BorderedCard className="flex flex-col gap-3 p-5">
            <EyebrowLabel size="sm">Browse by</EyebrowLabel>
            <ul className="flex list-none flex-col p-0">
              {facets.map((f) => (
                <li key={f.href} className="border-t border-line first:border-t-0">
                  <Link
                    href={f.href}
                    className="flex min-h-11 items-center justify-between gap-3 py-1 text-[14px] text-ink no-underline hover:text-rust"
                  >
                    <span>{f.label}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-ink-soft">{`${f.count} open →`}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] leading-[1.5] text-ink-soft">
              {`Counts are live. A category appears here only once it has at least ${LANDING_PAGE_MIN_ENTRIES} open programmes.`}
            </p>
          </BorderedCard>
        )}
      </div>

      {/* B — open this cycle */}
      <section className={SECTION}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <EyebrowLabel>Open this cycle</EyebrowLabel>
            <h2 className="font-display text-[24px] leading-[1.2]">A few programmes currently in the catalog</h2>
          </div>
          <Link href={SIGNUP_HREF} className={buttonClasses("secondary", "md", "no-underline")}>
            See the full catalog with a free account&nbsp;→
          </Link>
        </div>
        {listingsError ? (
          <p className="text-[14.5px] text-ink-soft">We couldn&apos;t load the programmes just now. Try reloading.</p>
        ) : listings.length === 0 ? (
          <p className="text-[14.5px] text-ink-soft">No programmes are open in the catalog right now. Check back soon.</p>
        ) : (
          <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
            {listings.map((l) => (
              <ListingRow key={l.id} listing={l} />
            ))}
          </ul>
        )}
      </section>

      {/* C — what every listing tells you */}
      <section className={SECTION}>
        <EyebrowLabel>What every listing tells you</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">
          The facts you need to decide whether to apply — and where to check them.
        </h2>
        <dl className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col gap-1">
              <dt className="font-body text-[14.5px] font-semibold text-ink">{f.label}</dt>
              <dd className="text-[14px] leading-[1.55] text-ink-soft">{f.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* D — with a free account */}
      <section className={SECTION}>
        <EyebrowLabel>With a free account</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">
          Turn a list of programmes into a shortlist you actually finish.
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">Save and track every application</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              Move each programme along as you go, so nothing you started gets forgotten.
            </p>
            <ol className="flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-[13px] font-semibold text-ink">
              {steps.map((label, i) => (
                <li key={label} className="flex items-center gap-2">
                  {i > 0 && (
                    <span aria-hidden="true" className="text-ink-soft">
                      →
                    </span>
                  )}
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">A reminder before it closes</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              {`We email you once when a saved scholarship is ${SCHOLARSHIP_DEADLINE_REMINDER_DAYS} days from closing — only for deadlines confirmed at the source.`}
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">Ask Farah if you&apos;re eligible</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              Farah compares the programme&apos;s stated requirements with your resume and tells you which you meet, which are gaps and which are unclear, with suggested next steps. The official page has the final word.
            </p>
            <p className="text-[13px] font-semibold text-ink">
              {`${CREDIT_COSTS.scholarshipEligibilityCheck} Talentrah Credits per check, or included with an active Pass.`}
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">Draft your personal statement</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              Tell Farah why this programme matters to you and get a first draft to rewrite in your own voice.
            </p>
            <p className="text-[13px] font-semibold text-ink">
              {`${CREDIT_COSTS.scholarshipSopDraft} Talentrah Credits per draft, or included with an active Pass.`}
            </p>
          </BorderedCard>
        </div>
      </section>

      {/* E — where the listings come from */}
      <section className={SECTION}>
        <EyebrowLabel>Where the listings come from</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">We help you find programmes. The provider decides.</h2>
        <p className="font-display text-[14.5px] italic text-ink-soft">
          Always confirm the exact terms on the official page before you apply.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <h3 className="font-body text-[14.5px] font-semibold text-ink">Official, permitted sources only.</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              Listings come from official programme pages whose published terms allow automated access, or are entered and verified by our own team. Each one is attributed and linked to its source, and we publish the facts, not the provider&apos;s own wording.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="font-body text-[14.5px] font-semibold text-ink">Closed listings come off daily.</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              Once a deadline has passed, the listing comes off at the next daily check. Where a provider publishes one machine-readable date, we re-read its page daily; a changed date goes back for review before it&apos;s shown.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="font-body text-[14.5px] font-semibold text-ink">Providers can ask us to remove or correct a listing.</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              If you&apos;re a provider and something is wrong or shouldn&apos;t be listed,{" "}
              <Link href="/contact" className="text-ink underline underline-offset-2 hover:text-rust">
                ask us
              </Link>
              .{" "}
              <Link href="/legal/terms#scholarship-listings" className="text-ink underline underline-offset-2 hover:text-rust">
                Read how we source listings
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* F — closing card */}
      <BorderedCard borderWidth="2" className="flex flex-col items-start gap-4 p-8">
        <h2 className="font-display text-[22px] font-semibold">Start your shortlist.</h2>
        <p className="max-w-[560px] text-[14.5px] leading-[1.55] text-ink-soft">
          Create a free account to save programmes, track each application and get reminded before deadlines. Browsing stays free either way.
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
      </BorderedCard>
    </div>
  );
}
