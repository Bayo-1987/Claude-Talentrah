/**
 * send-480 — the signed-out /scholarships landing page's own rules. No DB, no
 * network: the component is presentational and gets its data as props, exactly
 * like MentorshipPublicLanding.
 *
 * What this file pins, and why each is here:
 *  - NUMBERS ARE NEVER HARDCODED. Every figure in the copy comes from the constant
 *    that owns it (CREDIT_COSTS, SCHOLARSHIP_DEADLINE_REMINDER_DAYS,
 *    LANDING_PAGE_MIN_ENTRIES). Asserting the rendered text equals today's constant
 *    would pass if someone typed "4" into the JSX, so the second test in that
 *    block swaps the constants for stubs and proves the text FOLLOWS them.
 *  - The three deadline states a listing can be in (a date, a provider's own note,
 *    or nothing confirmed), because a wrong deadline is this catalog's worst error.
 *  - Empty states: no qualifying category hides the whole card, and zero open
 *    listings shows one plain sentence, never an empty box.
 *  - Copy rules from CLAUDE.md: "create a free account" not "sign up", and every
 *    "free" claim scoped at the point it is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ScholarshipsPublicLanding,
  type LandingFacet,
  type LandingListing,
} from "@/components/scholarships/public-landing";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { SCHOLARSHIP_DEADLINE_REMINDER_DAYS } from "@/lib/scholarship-deadline-alerts/select";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { SAVE_STATUS_LABEL } from "@/lib/scholarships/types";
import { Constants } from "@/lib/supabase/types";

/** A local calendar date `n` days from today as YYYY-MM-DD — what the DATE column holds. */
function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FACETS: LandingFacet[] = [
  { href: "/scholarships/fully-funded", label: "Fully funded scholarships", count: 28 },
  { href: "/scholarships/degree/bsc", label: "BSc scholarships", count: 18 },
  { href: "/scholarships/degree/msc", label: "MSc scholarships", count: 27 },
  { href: "/scholarships/degree/phd", label: "PhD scholarships", count: 14 },
];

function listing(over: Partial<LandingListing> = {}): LandingListing {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "Chevening",
    program_name: "Chevening Scholarships",
    host_institution: "UK universities",
    degree_levels: ["msc"],
    funding_type: "full",
    application_deadline: ymd(40),
    close_time: null,
    close_tz: null,
    deadline_note: null,
    // A real listing on this page is verified, and a deadline note is shown only with a verified-deadline stamp (publicDeadlineNote, #594).
    deadline_verified_at: "2026-09-01T00:00:00.000Z",
    official_url: "https://www.chevening.org/scholarship/nigeria/",
    ...over,
  };
}

const render = (facets: LandingFacet[] = FACETS, listings: LandingListing[] = [listing()]) =>
  renderToStaticMarkup(<ScholarshipsPublicLanding facets={facets} listings={listings} />);

/** The one <span> that carries the deadline value, so styling assertions cannot match an eyebrow. */
const deadlineSpan = (html: string) => html.match(/<span class="[^"]*" data-deadline="value">([^<]*)<\/span>/);

describe("structure and links", () => {
  it("has exactly one <h1>, the approved one", () => {
    const html = render();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain(
      "Scholarships open to applicants from Nigeria and across Africa — deadline confirmed at the source, or not shown at all.",
    );
  });

  it("sends the primary CTAs to signup and login with a return path to /scholarships", () => {
    const html = render();
    expect(html).toContain('href="/signup?redirectTo=%2Fscholarships"');
    expect(html).toContain('href="/login?redirectTo=%2Fscholarships"');
    expect(html).toContain('href="/scholarships/apply-now"');
  });

  it("says 'create a free account', never 'sign up' (CLAUDE.md copy rule)", () => {
    const html = render();
    expect(html).toContain("Create a free account");
    expect(html.toLowerCase()).not.toMatch(/\bsign(ing)? up\b/);
  });

  it("scopes 'free' at the point it is claimed: reading needs no account, saving and reminders do", () => {
    expect(render()).toContain(
      "Reading every listing is free and needs no account. An account lets you save, track and get deadline reminders.",
    );
  });

  it("renders the five 'what every listing tells you' facts as a description list", () => {
    const html = render();
    expect(html.match(/<dt[\s>]/g)?.length).toBe(5);
    for (const label of ["Who funds it", "What it covers", "Who can apply", "The deadline", "The official source"]) {
      expect(html).toContain(label);
    }
  });

  it("links 'ask us' to /contact and rests on the approved sourcing policy wording", () => {
    const html = render();
    expect(html).toMatch(/<a [^>]*href="\/contact"[^>]*>ask us<\/a>/);
    expect(html).toContain("We help you find programmes. The provider decides.");
  });
});

describe("NUMBERS ARE NEVER HARDCODED", () => {
  it("renders today's real constants", () => {
    const html = render();
    expect(html).toContain(`${CREDIT_COSTS.scholarshipEligibilityCheck} Talentrah Credits per check`);
    expect(html).toContain(`${CREDIT_COSTS.scholarshipSopDraft} Talentrah Credits per draft`);
    expect(html).toContain(`${SCHOLARSHIP_DEADLINE_REMINDER_DAYS} days`);
    expect(html).toContain(`at least ${LANDING_PAGE_MIN_ENTRIES} open programmes`);
  });

  describe("and FOLLOWS them when they change (a typed-in number would not)", () => {
    afterEach(() => {
      vi.doUnmock("@/lib/credits/costs");
      vi.doUnmock("@/lib/scholarship-deadline-alerts/select");
      vi.doUnmock("@/lib/seo/landing-pages");
      vi.resetModules();
    });

    it("credit costs, reminder window and category threshold all come from their owning modules", async () => {
      vi.resetModules();
      const costs = await vi.importActual<typeof import("@/lib/credits/costs")>("@/lib/credits/costs");
      const pages = await vi.importActual<typeof import("@/lib/seo/landing-pages")>("@/lib/seo/landing-pages");
      const select = await vi.importActual<typeof import("@/lib/scholarship-deadline-alerts/select")>(
        "@/lib/scholarship-deadline-alerts/select",
      );
      vi.doMock("@/lib/credits/costs", () => ({
        ...costs,
        CREDIT_COSTS: { ...costs.CREDIT_COSTS, scholarshipEligibilityCheck: 71, scholarshipSopDraft: 233 },
      }));
      vi.doMock("@/lib/seo/landing-pages", () => ({ ...pages, LANDING_PAGE_MIN_ENTRIES: 83 }));
      vi.doMock("@/lib/scholarship-deadline-alerts/select", () => ({ ...select, SCHOLARSHIP_DEADLINE_REMINDER_DAYS: 9 }));

      const { ScholarshipsPublicLanding: Stubbed } = await import("@/components/scholarships/public-landing");
      const html = renderToStaticMarkup(<Stubbed facets={FACETS} listings={[listing()]} />);

      expect(html).toContain("71 Talentrah Credits per check");
      expect(html).toContain("233 Talentrah Credits per draft");
      expect(html).toContain("9 days");
      expect(html).toContain("at least 83 open programmes");
      // ...and today's real values are gone, so nothing is echoing a literal.
      expect(html).not.toContain(`${CREDIT_COSTS.scholarshipEligibilityCheck} Talentrah Credits per check`);
      expect(html).not.toContain(`${CREDIT_COSTS.scholarshipSopDraft} Talentrah Credits per draft`);
    });
  });
});

describe("the four application steps", () => {
  it("are the real scholarship_save_status values, in the enum's order, with the labels the app uses", () => {
    const html = render();
    const expected = Constants.public.Enums.scholarship_save_status.map((s) => SAVE_STATUS_LABEL[s]);
    expect(expected).toEqual(["Saved", "Applying", "Submitted", "Outcome"]);
    const positions = expected.map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((p) => p > -1), `missing a step label: ${JSON.stringify(positions)}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("Browse by (facet counts)", () => {
  it("renders one linked row per qualifying category, with its live count", () => {
    const html = render();
    for (const f of FACETS) {
      expect(html).toMatch(new RegExp(`<a [^>]*href="${f.href.replace(/\//g, "\\/")}"[^>]*>[\\s\\S]*?${f.count}[\\s\\S]*?</a>`));
    }
    expect(html).toContain("Browse by");
  });

  it("hides the whole card, footnote included, when no category qualifies", () => {
    const html = render([]);
    expect(html).not.toContain("Browse by");
    expect(html).not.toContain(`at least ${LANDING_PAGE_MIN_ENTRIES} open programmes`);
  });
});

describe("Open this cycle (real listings)", () => {
  it("shows provider, programme link, host, chips and a noopener official link", () => {
    const html = render(FACETS, [listing()]);
    expect(html).toContain("Chevening");
    expect(html).toMatch(/<a [^>]*href="\/scholarships\/11111111-1111-4111-8111-111111111111"[^>]*>Chevening Scholarships<\/a>/);
    expect(html).toContain("UK universities");
    expect(html).toContain("MSc");
    expect(html).toContain("Fully funded");
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/www\.chevening\.org\/scholarship\/nigeria\/"[^>]*rel="noopener noreferrer"[^>]*>|<a [^>]*rel="noopener noreferrer"[^>]*href="https:\/\/www\.chevening\.org\/scholarship\/nigeria\/"/,
    );
    expect(html).toContain('target="_blank"');
  });

  it("labels the catalog link honestly: it leads to signup, so it says so", () => {
    const html = render();
    expect(html).toContain("See the full catalog with a free account");
    expect(html).not.toContain("See all open scholarships");
  });

  it("shows one plain sentence and no rows when nothing is open — never an empty box", () => {
    const html = render(FACETS, []);
    expect(html).toContain("No programmes are open in the catalog right now. Check back soon.");
    expect(html).not.toContain("Official listing");
    expect(html).not.toMatch(/href="\/scholarships\/[0-9a-f-]{36}"/);
  });

  describe("the three real deadline states", () => {
    it("a date: unambiguous day-month-year, plain when it is not close", () => {
      const html = render(FACETS, [listing({ application_deadline: "2027-03-02", deadline_note: null })]);
      expect(html).toContain("2 Mar 2027");
      expect(html).not.toContain("3/2/2027");
      expect(html).not.toContain("days left");
    });

    /*
     * CHANGED DELIBERATELY (send-508, S3-21a). "N days left" used to be calendar days from the server's local midnight to a date, so it
     * moved with the DATE and these tests used `ymd(n)`. It now counts whole days to the closing INSTANT (src/lib/scholarships/close-instant.ts),
     * so the tests fix the clock and state the instant: each listing closes at an explicit time in UTC, `n` days and one hour from the
     * pinned "now". The exact boundary minute per zone is in tests/scholarships/close-instant-call-sites.test.ts.
     */
    describe("with the clock pinned (09:00 UTC on 20 Sep 2026)", () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-20T09:00:00Z"));
      });
      afterEach(() => vi.useRealTimers());

      const closing = (extraMs: number) => {
        const t = new Date(Date.parse("2026-09-20T09:00:00Z") + extraMs);
        return {
          application_deadline: t.toISOString().slice(0, 10),
          close_time: t.toISOString().slice(11, 16),
          close_tz: "UTC",
        };
      };
      const DAY = 86_400_000;
      const HOUR = 3_600_000;

      it("more than 14 days out (15): the date alone — no countdown, no rust", () => {
        const html = render(FACETS, [listing(closing(15 * DAY + HOUR))]);
        expect(html).not.toContain("days left");
        expect(html).not.toContain("closes today");
        expect(deadlineSpan(html)![0]).not.toContain("text-rust");
      });

      it("exactly 14 days out: rust with '14 days left' (the boundary is inclusive, as on the scholarship card)", () => {
        const span = deadlineSpan(render(FACETS, [listing(closing(14 * DAY + HOUR))]))!;
        expect(span[0]).toContain("text-rust");
        expect(span[1]).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4} · 14 days left$/);
      });

      it("5 days out: rust with '5 days left'", () => {
        const span = deadlineSpan(render(FACETS, [listing(closing(5 * DAY + HOUR))]))!;
        expect(span[0]).toContain("text-rust");
        expect(span[1]).toMatch(/ · 5 days left$/);
      });

      it("5 hours out reads 'Closes in 5 hours' (true for every reader), 29 hours out '1 day left'", () => {
        const today = deadlineSpan(render(FACETS, [listing(closing(5 * HOUR))]))!;
        expect(today[1]).toMatch(/ · Closes in 5 hours$/);
        expect(today[0]).toContain("text-rust");
        const tomorrow = deadlineSpan(render(FACETS, [listing(closing(DAY + 5 * HOUR))]))!;
        expect(tomorrow[1]).toMatch(/ · 1 day left$/);
        expect(tomorrow[1]).not.toContain("1 days");
      });
    });

    it("no date but the provider's own note: shows the note, verbatim", () => {
      const html = render(FACETS, [
        listing({ application_deadline: null, deadline_note: "Varies by partner university" }),
      ]);
      expect(html).toContain("Varies by partner university");
      expect(html).not.toContain("Not published yet");
    });

    it("neither a date nor a note: says 'Not published yet', never blank and never an estimate", () => {
      const html = render(FACETS, [listing({ application_deadline: null, deadline_note: null })]);
      expect(html).toContain("Not published yet");
    });
  });
});

describe("the provider's deadline note is shown only when it reads like a note (a heuristic)", () => {
  const FALLBACK = "See the official listing for the deadline";

  it("shows a note of exactly 140 characters in full", () => {
    const note = "n".repeat(140);
    const html = render(FACETS, [listing({ application_deadline: null, deadline_note: note })]);
    expect(html).toContain(note);
    expect(html).not.toContain(FALLBACK);
  });

  it("replaces a note of 141 characters with the fallback, and never prints any of it", () => {
    const note = "REVIEWERONLY " + "n".repeat(128);
    expect(note.length).toBe(141);
    const html = render(FACETS, [listing({ application_deadline: null, deadline_note: note })]);
    expect(html).toContain(FALLBACK);
    expect(html).not.toContain("REVIEWERONLY");
  });

  it("does not use the fallback when there is a real date, whatever the note says", () => {
    const html = render(FACETS, [listing({ application_deadline: ymd(40), deadline_note: "x".repeat(300) })]);
    expect(html).not.toContain(FALLBACK);
  });

  it("does not shorten the 'not published yet' state either", () => {
    expect(render(FACETS, [listing({ application_deadline: null, deadline_note: null })])).toContain("Not published yet");
  });
});

describe("when the listings could not be loaded", () => {
  it("says so plainly, instead of claiming nothing is open", () => {
    const html = renderToStaticMarkup(<ScholarshipsPublicLanding facets={[]} listings={[]} listingsError />);
    expect(html).toContain("We couldn&#x27;t load the programmes just now. Try reloading.");
    expect(html).not.toContain("No programmes are open in the catalog right now");
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  });
});

describe("the approved copy (send-480 self-review corrections)", () => {
  it("the hero lede carries no country list, which would go stale", () => {
    const html = render();
    expect(html).toContain(
      "Fully and partly funded programmes for BSc, MSc and PhD study, wherever they&#x27;re hosted. Every listing names who funds it, who can apply, and links to the official page.",
    );
    expect(html).not.toMatch(/from the UK and Germany|across Africa\.|Germany/);
  });

  it("the reminder card names the email channel and reads the window from the constant", () => {
    expect(render()).toContain(
      `We email you once when a saved scholarship is ${SCHOLARSHIP_DEADLINE_REMINDER_DAYS} days from closing — only for deadlines confirmed at the source.`,
    );
  });

  it("the eligibility card says resume (not profile) and does not promise 'what to confirm with the provider'", () => {
    const html = render();
    expect(html).toContain(
      "Farah compares the programme&#x27;s stated requirements with your resume and tells you which you meet, which are gaps and which are unclear, with suggested next steps. The official page has the final word.",
    );
    expect(html).not.toContain("against your profile");
    expect(html).not.toContain("what to confirm with the provider");
  });

  it("the credit lines say 'an active Pass', because passes carry a daily cap", () => {
    const html = render();
    expect(html).toContain(`${CREDIT_COSTS.scholarshipEligibilityCheck} Talentrah Credits per check, or included with an active Pass.`);
    expect(html).toContain(`${CREDIT_COSTS.scholarshipSopDraft} Talentrah Credits per draft, or included with an active Pass.`);
  });

  it("the deadline fact names all three real states and says never estimated", () => {
    expect(render()).toContain(
      "A date confirmed against the official page, the provider&#x27;s own note where there is no single date, or “not published yet”. Never estimated.",
    );
  });

  it("the sourcing section scopes the daily check to what it really does", () => {
    const html = render();
    expect(html).toContain("Closed listings come off daily.");
    expect(html).toContain("Where a provider publishes one machine-readable date, we re-read its page daily");
    expect(html).not.toContain("Checked every day.");
  });

  it("providers can ask us to remove or correct, and the Terms section is linked", () => {
    const html = render();
    expect(html).toContain("remove or correct");
    expect(html).toMatch(/<a [^>]*href="\/contact"[^>]*>ask us<\/a>/);
    expect(html).toContain('href="/legal/terms#scholarship-listings"');
  });
});

describe("which instant decides 'closes today' and 'N days left' (send-480, rewritten by send-508)", () => {
  /*
   * THE RULE NOW (owner's call, S3-21a; migration 0204 and src/lib/scholarships/close-instant.ts): a listing closes at an INSTANT.
   *   - a closing time and zone stated: that wall-clock time in that zone;
   *   - a zone but no time: the end of that day there;
   *   - neither: the end of the day at UTC-12, i.e. 12:00 UTC the NEXT day, so a bare "2 Oct" is open until 12:00 UTC on 3 Oct.
   * It used to be "the server's UTC date": a deadline of 2 Oct was gone from the 00:00 UTC 3 Oct render, whatever zone the source stated.
   * The countdown is whole days to that instant (0 = "closes today", the last 24 hours), so it DOES move with the time of day.
   * Pinned with a fixed clock; the TZ of the machine is irrelevant (and no longer set here) because nothing reads the local calendar.
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const at = (iso: string, over: Partial<LandingListing>) => {
    vi.setSystemTime(new Date(iso));
    return render(FACETS, [listing({ deadline_note: null, ...over })]);
  };

  /*
   * CHANGED DELIBERATELY (send-511). For a row with NO zone the 0204 rule still decides whether it is LISTED (open until 12:00 UTC the next day),
   * but the COUNTDOWN now reads the stated date on the timeline of the earliest zone (UTC+14): "N days left" before the date has begun anywhere,
   * "Closes today: time zone not stated, apply now" while the date is current there, then "Deadline date has passed in some time zones. May
   * already be closed" until the last place has ended the day. These tests used to expect "closes today" for the whole 36 hours.
   */
  const LAST_DAY_2_OCT = "Last day: deadline 2 Oct 2026, time zone not stated. Apply now.";
  const PASSED = "Deadline date has passed in some time zones. May already be closed.";

  it("a no-zone deadline of 2 Oct: 'Last day, apply now' on the day, 'passed in some time zones' from 10:00 UTC, and STILL listed at 00:30 UTC on 3 Oct", () => {
    const row = { application_deadline: "2026-10-02" };
    const onTheDay = deadlineSpan(at("2026-10-02T08:30:00Z", row))!;
    expect(onTheDay[1]).toBe(LAST_DAY_2_OCT);
    expect(onTheDay[0]).toContain("text-rust");
    expect(deadlineSpan(at("2026-10-02T10:00:00Z", row))![1]).toBe(`2 Oct 2026 · ${PASSED}`);
    const after = deadlineSpan(at("2026-10-03T00:30:00Z", row))!;
    expect(after[1]).toBe(`2 Oct 2026 · ${PASSED}`);
    expect(after[0]).toContain("text-rust");
  });

  it("the same deadline has closed at 12:00 UTC on 3 Oct: the date shows with no countdown and no rust", () => {
    const span = deadlineSpan(at("2026-10-03T12:00:00Z", { application_deadline: "2026-10-02" }))!;
    expect(span[1]).toBe("2 Oct 2026");
    expect(span[0]).not.toContain("text-rust");
  });

  it("a stated closing time is honoured to the minute: 13:00 Pacific on 2 Oct is 20:00 UTC", () => {
    const row = { application_deadline: "2026-10-02", close_time: "13:00", close_tz: "America/Vancouver" };
    expect(deadlineSpan(at("2026-10-02T19:59:00Z", row))![1]).toBe("2 Oct 2026 · Closes in under an hour");
    expect(deadlineSpan(at("2026-10-02T20:00:00Z", row))![1]).toBe("2 Oct 2026");
  });

  it("a no-zone row counts calendar days to the stated date on the UTC+14 timeline", () => {
    const row = { application_deadline: "2026-10-02" };
    expect(deadlineSpan(at("2026-09-30T12:00:00Z", row))![1]).toBe("2 Oct 2026 · 1 day left");
    expect(deadlineSpan(at("2026-09-29T12:00:00Z", row))![1]).toBe("2 Oct 2026 · 2 days left");
    expect(deadlineSpan(at("2026-10-01T10:00:00Z", row))![1]).toBe(LAST_DAY_2_OCT);
  });
});
