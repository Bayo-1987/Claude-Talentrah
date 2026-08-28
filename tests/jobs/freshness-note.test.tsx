/**
 * The one freshness flag from finding 04.
 *
 * The line asserts two separate things — an age, and that the source still
 * serves the posting — and the two have different evidence behind them. Age
 * comes from `posted_at`; the source claim comes ONLY from `last_checked_at`.
 * `status = 'open'` is not evidence of the second, because the ingest's
 * empty-fetch guard leaves postings open precisely when it has NO fresh word
 * from the source.
 *
 * Measured against production before any of this was written: 150 open
 * postings, of which 7 are over 120 days old — all from the schema.org
 * Workable source, ages 190–694 days. Zero Greenhouse postings qualify (their
 * oldest open listing is 86 days), and no internal posting is older than two
 * days. Every open posting had been re-confirmed within the previous few
 * hours, so the confirmation gate suppresses nothing today and only starts
 * mattering when a source breaks.
 *
 * Three properties would break quietly and are pinned below:
 *
 *   1. Internal postings never get the note. We are the source; quoting our
 *      own record back as third-party confirmation is circular.
 *   2. A stale `last_checked_at` suppresses the WHOLE line rather than
 *      shortening it. Half a sentence backed by evidence plus half invented is
 *      still an invented claim.
 *   3. The copy carries no advice. "Worth checking it's still open" is a
 *      judgment, and one this system's own data contradicts.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import {
  freshnessNote,
  FRESHNESS_NOTE_AGE_DAYS,
  FRESHNESS_NOTE_CONFIRMATION_WINDOW_DAYS,
} from "@/lib/jobs/freshness-note";
import type { Tables } from "@/lib/supabase/types";

const NOW = new Date("2026-08-27T09:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function job(over: Partial<Tables<"job_postings">> = {}): Tables<"job_postings"> {
  return {
    source_type: "external",
    posted_at: daysAgo(200),
    last_checked_at: daysAgo(0),
    status: "open",
    ...over,
  } as unknown as Tables<"job_postings">;
}

describe("who gets the note", () => {
  it("flags an external posting past the age threshold", () => {
    expect(freshnessNote(job(), NOW)).toBe(
      "First listed 120+ days ago — still shown as open by the source.",
    );
  });

  it("never flags an internal posting, however old", () => {
    // We are the source. There is no third party to confirm anything.
    expect(freshnessNote(job({ source_type: "internal", posted_at: daysAgo(900) }), NOW)).toBeNull();
  });

  it("says nothing about a posting younger than the threshold", () => {
    expect(freshnessNote(job({ posted_at: daysAgo(FRESHNESS_NOTE_AGE_DAYS - 1) }), NOW)).toBeNull();
  });

  it("fires exactly at the threshold, not a day later", () => {
    expect(freshnessNote(job({ posted_at: daysAgo(FRESHNESS_NOTE_AGE_DAYS) }), NOW)).not.toBeNull();
  });

  it("still fires on the oldest real posting on the board (694 days)", () => {
    expect(freshnessNote(job({ posted_at: daysAgo(694) }), NOW)).not.toBeNull();
  });
});

describe("the source claim needs a source", () => {
  /*
   * The failure this guards is specific. When a source answers 200 with an
   * empty array, `ingest.ts` deliberately SKIPS the freshness sweep, so every
   * posting stays `status = 'open'` while nothing re-confirmed it. Reading
   * openness as confirmation would turn our own restraint into a claim about
   * the employer.
   */
  it("suppresses the line when the source has not re-confirmed in the window", () => {
    const stale = daysAgo(FRESHNESS_NOTE_CONFIRMATION_WINDOW_DAYS + 1);
    expect(freshnessNote(job({ last_checked_at: stale }), NOW)).toBeNull();
  });

  it("still shows the line at the edge of the window", () => {
    const edge = daysAgo(FRESHNESS_NOTE_CONFIRMATION_WINDOW_DAYS);
    expect(freshnessNote(job({ last_checked_at: edge }), NOW)).not.toBeNull();
  });

  it("suppresses the whole line, never just the second half", () => {
    // A partially-evidenced sentence is not a safer sentence.
    const stale = daysAgo(60);
    expect(freshnessNote(job({ last_checked_at: stale }), NOW)).toBeNull();
  });
});

describe("bad data is silence, not a guess", () => {
  it("returns null for an unparseable posted_at", () => {
    expect(freshnessNote(job({ posted_at: "not a date" }), NOW)).toBeNull();
  });

  it("returns null for an unparseable last_checked_at", () => {
    expect(freshnessNote(job({ last_checked_at: "not a date" }), NOW)).toBeNull();
  });

  it("returns null when either timestamp is missing", () => {
    expect(freshnessNote(job({ posted_at: null as unknown as string }), NOW)).toBeNull();
    expect(freshnessNote(job({ last_checked_at: null as unknown as string }), NOW)).toBeNull();
  });
});

describe("the copy states facts and gives no advice", () => {
  const note = freshnessNote(job(), NOW)!;

  /*
   * Finding 04's guidance was "one flag, plain text, no icon". The reference
   * mock's own wording — "Source hasn't refreshed since — worth checking it's
   * still open" — fails on both counts here: it advises, and it asserts the
   * opposite of what our ingest actually knows.
   */
  it.each(["worth checking", "hasn't refreshed", "may be", "might be", "probably", "likely"])(
    "does not hedge or advise with %j",
    (phrase) => {
      expect(note.toLowerCase()).not.toContain(phrase);
    },
  );

  it("never borrows match-tier vocabulary", () => {
    // CLAUDE.md fixes three tiers; a coloured or graded freshness line would
    // read as a fourth. The words are the first place that leaks.
    for (const tier of ["excellent", "good", "fair", "stale", "expired", "dead"]) {
      expect(note.toLowerCase()).not.toContain(tier);
    }
  });

  it("names the threshold it fired on, so the reader knows why this card", () => {
    expect(note).toContain(`${FRESHNESS_NOTE_AGE_DAYS}+ days`);
  });
});

describe("the card actually renders it", () => {
  /*
   * The module can be perfectly correct and the card still silently drop the
   * line — that is one conditional away. These render the real component.
   */
  function card(over: Partial<Tables<"job_postings">> = {}) {
    return renderToStaticMarkup(
      <JobCard
        job={
          {
            id: "job-1",
            title: "Associate Product Manager",
            company_name: "Reliance Health",
            description: "A real posting from the schema.org Workable source.",
            location: "Lagos",
            work_type: null,
            seniority: null,
            external_url: "https://example.test/apply",
            status: "open",
            source_type: "external",
            posted_at: new Date(Date.now() - 200 * DAY).toISOString(),
            last_checked_at: new Date().toISOString(),
            ...over,
          } as unknown as Tables<"job_postings">
        }
        score={75}
        isSaved={false}
        applicationStage={null}
        explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
        origin="https://talentrah.test"
      />,
    );
  }

  it("prints the line on an aging external card", () => {
    expect(card()).toContain("still shown as open by the source");
  });

  it("prints nothing at all on a recent card — no placeholder, no empty row", () => {
    const html = card({ posted_at: new Date(Date.now() - 3 * DAY).toISOString() });
    expect(html).not.toContain("still shown as open");
    expect(html).not.toContain("120+");
  });

  it("sets the line in --ink-soft, not --rust", () => {
    /*
     * The reference mock used --rust here. Rust is the "Good" match tier's
     * colour, and CLAUDE.md forbids a fourth tier — a coloured line beside a
     * tier badge is how one arrives without anyone deciding to add it.
     */
    const html = card();
    const line = html.match(/<span[^>]*>First listed[^<]*<\/span>/)?.[0] ?? "";
    expect(line).toContain("text-ink-soft");
    expect(line).not.toContain("rust");
  });

  it("keeps the italic-serif aside voice the design system reserves for this", () => {
    const line = card().match(/<span[^>]*>First listed[^<]*<\/span>/)?.[0] ?? "";
    expect(line).toContain("italic");
    expect(line).toContain("font-display");
  });
});
