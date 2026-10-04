/**
 * The seniority words are written from the JOB SEEKER's side ("More senior than you"). The employer applicants page renders the same
 * `MatchBreakdown` for each applicant, where "you" would be the EMPLOYER and the direction would be wrong (the alignment compares the APPLICANT's
 * level with the role's). So the employer page uses its own perspective, worded about the applicant and the role, and this file pins that the
 * seeker wording never reaches an employer-facing page.
 *
 * "above" always means the resume's level exceeds the role's (score.ts). For the employer that is "Above the role's level".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";
import type { MatchExplanation } from "@/lib/matching/score";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { ApplicantList, type ApplicantRow } from "@/components/employer/applicant-list";

type Alignment = MatchExplanation["seniorityAlignment"];
const SEEKER_PHRASES = /than you\b|your level|your current level|looks right for you|isn't clear from the posting/i;

const row = (id: string, alignment: Alignment): ApplicantRow => ({
  application_id: id,
  first_name: "Test",
  last_name: id,
  applied_at: "2026-01-01T00:00:00Z",
  match_score: 70,
  resume_id: null,
  status: "applied" as ApplicantRow["status"],
  explanation: { matchedSkills: ["sql"], missingSkills: ["aws"], seniorityAlignment: alignment },
  talentVerificationStatus: "unverified",
  talentVerificationScore: null,
  screeningPassed: null,
});
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const render = (alignment: Alignment) =>
  decode(renderToStaticMarkup(<ApplicantList jobId="j1" applicants={[row("a", alignment)]} hasScreeningQuestions={false} hasAssessment={false} />));

describe("the employer applicants page never carries the seeker wording", () => {
  for (const alignment of ["match", "above", "below", "unknown"] as const) {
    it(`${alignment}: no 'you' / 'your level' wording anywhere in the rendered list`, () => {
      expect(render(alignment)).not.toMatch(SEEKER_PHRASES);
    });
  }

  it("says which way the APPLICANT sits relative to the role, in the employer's terms", () => {
    expect(render("above")).toContain("Above the role's level");
    expect(render("below")).toContain("Below the role's level");
    expect(render("match")).toContain(">Match<");
    expect(render("unknown")).not.toContain("Seniority");
  });
});

describe("the helper's employer perspective", () => {
  interface Words {
    describeSeniorityAlignment(a: Alignment, perspective?: "seeker" | "employer"): { sentence: string; label: string | null };
  }
  it("is worded about the applicant and the role, with no second person", async () => {
    const { describeSeniorityAlignment } = await loadModule<Words>("@/lib/matching/seniority-words");
    for (const a of ["match", "above", "below", "unknown"] as const) {
      const w = describeSeniorityAlignment(a, "employer");
      expect(`${w.sentence} ${w.label ?? ""}`).not.toMatch(SEEKER_PHRASES);
    }
    expect(describeSeniorityAlignment("above", "employer").label).toBe("Above the role's level");
    expect(describeSeniorityAlignment("below", "employer").label).toBe("Below the role's level");
    // the default is still the seeker's wording
    expect(describeSeniorityAlignment("below").label).toBe("More senior than you");
  });
});

describe("no employer-facing file reaches the seeker-side wording by import", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("employer pages, components and libs import neither vet-summary nor Farah's job context", () => {
    const offenders = [...walk("src/app/employer"), ...walk("src/components/employer"), ...walk("src/lib/employer")].filter((f) =>
      /from "@\/lib\/matching\/vet-summary"|from "@\/lib\/farah\/token-budget"/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("every employer file that renders MatchBreakdown says perspective=\"employer\"", () => {
    const offenders = [...walk("src/app/employer"), ...walk("src/components/employer")].filter((f) => {
      const t = readFileSync(f, "utf8");
      return /<MatchBreakdown\b/.test(t) && !/<MatchBreakdown[^>]*perspective="employer"/.test(t);
    });
    expect(offenders).toEqual([]);
  });
});
