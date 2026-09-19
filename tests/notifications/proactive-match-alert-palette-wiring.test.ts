/**
 * send-395 — proves the proactive-alert template genuinely READS
 * EMAIL_COLORS from layout.ts at render time, rather than merely happening
 * to contain the same hex strings a hardcoded copy would also contain.
 *
 * A plain `email.html.toContain(EMAIL_COLORS.line)` string check does NOT
 * prove this: the pre-refactor template hardcoded the exact same hex
 * values (they were copied from the same palette in the first place), so
 * that assertion passes against BOTH the old, duplicated-copy version and
 * the new, properly-wired one — the same "test that passes for the wrong
 * reason" failure mode this repo's own CLAUDE.md warns about elsewhere.
 *
 * This file mocks layout.ts's own EMAIL_COLORS export to distinctive
 * sentinel values (keeping every real helper function — emailParagraph,
 * emailLabel, etc. — intact via importOriginal) and asserts the rendered
 * HTML picks up the SENTINEL values wherever template.ts interpolates
 * EMAIL_COLORS directly into hand-rolled markup (the job-info block's
 * border/company-line colors, the footer unsubscribe link color) — the
 * three spots that survived the refactor as raw markup rather than calls
 * to a shared helper, and therefore the three spots a re-introduced
 * hardcoded copy would most plausibly reappear. If template.ts ever goes
 * back to its own hardcoded hex here, this fails: the sentinel would never
 * appear, because the hardcoded literal doesn't read the (mocked) export
 * at all.
 *
 * Kept in its own file, not added to proactive-match-alert-template.test.ts:
 * `vi.mock` is hoisted and module-scoped to the whole file, and that file's
 * other tests import the template statically with no need for mocking.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ScoredNewJob } from "@/lib/notifications/proactive-match-alert/select";

const SENTINEL_LINE = "#123456";
const SENTINEL_BODY_MUTED = "#654321";
const SENTINEL_ACCENT = "#abcdef";

vi.mock("@/lib/email/layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/layout")>();
  return {
    ...actual,
    EMAIL_COLORS: {
      ...actual.EMAIL_COLORS,
      line: SENTINEL_LINE,
      bodyMuted: SENTINEL_BODY_MUTED,
      accent: SENTINEL_ACCENT,
    },
  };
});

const job = (over: Partial<ScoredNewJob> = {}): ScoredNewJob => ({
  jobId: "job-1",
  title: "Senior Backend Engineer",
  companyName: "Verified Co",
  location: "Lagos",
  score: 92,
  explanation: {
    matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"],
    missingSkills: ["react"],
    seniorityAlignment: "unknown",
  },
  ...over,
});

describe("send-395: proactive-alert template genuinely reads EMAIL_COLORS, not a private copy", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("SABOTAGE-PROOF TARGET: mocked EMAIL_COLORS values reach the rendered HTML at the three hand-rolled interpolation sites", async () => {
    const { buildProactiveAlertEmail } = await import("@/lib/notifications/proactive-match-alert/template");
    const email = buildProactiveAlertEmail({ firstName: "Ada", job: job(), unsubscribeToken: "tok" });

    // The job-info block's border and company/location line — both
    // interpolate EMAIL_COLORS directly in template.ts's own hand-rolled
    // markup, so the mocked values must show up here.
    expect(email.html).toContain(SENTINEL_LINE);
    expect(email.html).toContain(SENTINEL_BODY_MUTED);
    // The footer unsubscribe link's color is ALSO a direct
    // EMAIL_COLORS.accent interpolation in template.ts.
    expect(email.html).toContain(SENTINEL_ACCENT);

    // "line" and "accent" also have a SECOND, legitimate real source in
    // this render — renderBrandedEmail()'s own footer divider (line) and
    // emailLabel()'s own styling (accent), both real, unmocked layout.ts
    // functions that close over their own module-scoped EMAIL_COLORS
    // reference rather than the mocked re-export. That is correct, not a
    // leak — proof those helpers are genuinely being called, not
    // reimplemented — so this file does not assert #d9cfc2/#6b4a3a absent.
    //
    // "bodyMuted" has no such second source (grep confirms no layout.ts
    // helper references EMAIL_COLORS.bodyMuted internally): its only path
    // into this HTML is template.ts's own direct interpolation, so its real
    // value disappearing entirely is exactly what genuine wiring predicts.
    expect(email.html).not.toContain("#5a4a3f");
  });
});
