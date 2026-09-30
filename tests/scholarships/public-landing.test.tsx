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
import { afterEach, describe, expect, it, vi } from "vitest";
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
    deadline_note: null,
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

    it("more than 14 days out (15): the date alone — no countdown, no rust", () => {
      const html = render(FACETS, [listing({ application_deadline: ymd(15) })]);
      expect(html).not.toContain("days left");
      expect(html).not.toContain("closes today");
      expect(deadlineSpan(html)![0]).not.toContain("text-rust");
    });

    it("exactly 14 days out: rust with '14 days left' (the boundary is inclusive, as on the scholarship card)", () => {
      const span = deadlineSpan(render(FACETS, [listing({ application_deadline: ymd(14) })]))!;
      expect(span[0]).toContain("text-rust");
      expect(span[1]).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4} · 14 days left$/);
    });

    it("5 days out: rust with '5 days left'", () => {
      const span = deadlineSpan(render(FACETS, [listing({ application_deadline: ymd(5) })]))!;
      expect(span[0]).toContain("text-rust");
      expect(span[1]).toMatch(/ · 5 days left$/);
    });

    it("closes today and closes tomorrow read naturally", () => {
      const today = deadlineSpan(render(FACETS, [listing({ application_deadline: ymd(0) })]))!;
      expect(today[1]).toMatch(/ · closes today$/);
      expect(today[0]).toContain("text-rust");
      const tomorrow = deadlineSpan(render(FACETS, [listing({ application_deadline: ymd(1) })]))!;
      expect(tomorrow[1]).toMatch(/ · 1 day left$/);
      expect(tomorrow[1]).not.toContain("1 days");
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
    expect(html).toContain("We couldn't load the programmes just now. Try reloading.");
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
