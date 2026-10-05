/**
 * S3-52 part 1: "above" and "below" meant opposite things in two places.
 *
 * score.ts sets seniorityAlignment = "above" when the RESUME's level is higher than the job's (so the role is MORE JUNIOR than you) and "below"
 * when the resume's level is lower (so the role is MORE SENIOR than you). vet-summary.ts rendered "below" as "it sits below your current level"
 * (a junior role: the opposite) and "above" as "it sits above your current level" (a senior role: the opposite), and the breakdown on the job card
 * and detail page showed the bare words "Above" and "Below", which read the same wrong way round. So for every job with a seniority mismatch the
 * card and Farah's summary contradicted what the scorer meant.
 *
 * One helper (src/lib/matching/seniority-words.ts) is now the only place that turns seniorityAlignment into words. A scan fails if any other file
 * maps the values to words, and the stored scoring values are pinned so this fix cannot change what is stored (trigger 0069 deletes scores when a
 * posting's seniority changes, and seniority is a pure regex over the title: nothing here touches either).
 *
 * The helper does not exist when this file is first committed, so it is loaded at runtime.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";
import { computeMatchScore, type MatchExplanation } from "@/lib/matching/score";
import { fitSummary } from "@/lib/matching/vet-summary";
import { buildJobContext } from "@/lib/farah/token-budget";

type Alignment = MatchExplanation["seniorityAlignment"];
interface Words {
  describeSeniorityAlignment(a: Alignment): { sentence: string; label: string | null };
}
const load = () => loadModule<Words>("@/lib/matching/seniority-words");

const resume = (title: string) =>
  ({ contact: {}, experience: [{ title, company: "Co", startDate: "2020", endDate: "2024", description: "" }], education: [], skills: ["sql", "python"], projects: [], certifications: [] }) as never;
const card = (e: MatchExplanation) => renderToStaticMarkup(<MatchBreakdown explanation={e} />);
const SKILLS = ["sql", "python", "aws", "docker"];

describe("the direction is right everywhere, for the two cases that matter", () => {
  it("a resume at Mid and a job at Senior: the scorer says below; the card and the summary BOTH say the role is more senior than you", () => {
    const { explanation } = computeMatchScore(resume("Accountant"), SKILLS, "senior", undefined);
    expect(explanation.seniorityAlignment).toBe("below");
    expect(card(explanation)).toContain("More senior than you");
    expect(fitSummary(explanation)).toMatch(/more senior than your current level/i);
    expect(card(explanation)).not.toMatch(/junior/i);
    expect(fitSummary(explanation)).not.toMatch(/junior/i);
    expect(buildJobContext({ title: "Finance Lead", companyName: "Acme" }, explanation)).toMatch(/more senior than your current level/i);
  });

  it("a resume at Senior and a job at Entry: the scorer says above; the card and the summary BOTH say the role is more junior than you", () => {
    const { explanation } = computeMatchScore(resume("Senior Accountant"), SKILLS, "entry", undefined);
    expect(explanation.seniorityAlignment).toBe("above");
    expect(card(explanation)).toContain("More junior than you");
    expect(fitSummary(explanation)).toMatch(/more junior than your current level/i);
    expect(card(explanation)).not.toMatch(/more senior/i);
    expect(fitSummary(explanation)).not.toMatch(/more senior/i);
  });

  it("a match, and an unknown level, read as before (unknown shows no cell on the card)", () => {
    const match = computeMatchScore(resume("Accountant"), SKILLS, "mid", undefined).explanation;
    expect(card(match)).toContain(">Match<");
    expect(fitSummary(match)).toContain("The seniority looks right for you");
    const unknown = computeMatchScore(resume("Accountant"), SKILLS, undefined, undefined).explanation;
    expect(card(unknown)).not.toContain("Seniority");
    expect(fitSummary(unknown)).toContain("isn't clear from the posting");
  });

  it("every (resume level, job level) pair: card and summary agree on the direction", () => {
    for (const title of ["Graduate Trainee", "Accountant", "Senior Accountant", "Head of Finance", "Chief Financial Officer"]) {
      for (const job of ["entry", "mid", "senior", "lead", "executive"] as const) {
        const { explanation } = computeMatchScore(resume(title), SKILLS, job, undefined);
        const cardSaysSenior = /More senior than you/.test(card(explanation));
        const cardSaysJunior = /More junior than you/.test(card(explanation));
        const sumSaysSenior = /more senior than your current level/i.test(fitSummary(explanation));
        const sumSaysJunior = /more junior than your current level/i.test(fitSummary(explanation));
        expect([cardSaysSenior, cardSaysJunior], `${title} vs ${job}`).toEqual([sumSaysSenior, sumSaysJunior]);
        expect(explanation.seniorityAlignment === "below", `${title} vs ${job}`).toBe(cardSaysSenior);
        expect(explanation.seniorityAlignment === "above", `${title} vs ${job}`).toBe(cardSaysJunior);
      }
    }
  });
});

describe("the helper", () => {
  it("is the one place that words each alignment, and the direction is explicit", async () => {
    const { describeSeniorityAlignment } = await load();
    expect(describeSeniorityAlignment("below").sentence).toMatch(/more senior/);
    expect(describeSeniorityAlignment("below").label).toBe("More senior than you");
    expect(describeSeniorityAlignment("above").sentence).toMatch(/more junior/);
    expect(describeSeniorityAlignment("above").label).toBe("More junior than you");
    expect(describeSeniorityAlignment("match").label).toBe("Match");
    expect(describeSeniorityAlignment("unknown").label).toBeNull();
    const sentences = (["match", "above", "below", "unknown"] as const).map((a) => describeSeniorityAlignment(a).sentence);
    expect(new Set(sentences).size).toBe(4);
  });
});

describe("only the helper (and the scorer that produces the values) maps seniorityAlignment values to words", () => {
  const ALLOWED = new Set(["src/lib/matching/seniority-words.ts", "src/lib/matching/score.ts", "src/lib/supabase/types.ts"]);
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("no other file keys a map or a branch on the 'above' / 'below' alignment values", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (ALLOWED.has(file)) continue;
      // Code lines only: a comment that happens to say "above:" is prose, not a mapping.
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      if (/(^|[ \t{,])(above|below)[ \t]*:[ \t]*["'`]/m.test(text) || /["'`](above|below)["'`]/.test(text)) offenders.push(file);
    }
    expect(offenders, "wording for seniorityAlignment must come from describeSeniorityAlignment").toEqual([]);
  });
});

/** Pinned from main BEFORE this fix: [score, seniorityAlignment] for each resume title x job level. The fix changes words only, never these. */
const STORED: Record<string, [number, Alignment]> = {
  "Graduate Trainee|entry": [55, "match"],
  "Graduate Trainee|mid": [50, "below"],
  "Graduate Trainee|senior": [35, "below"],
  "Graduate Trainee|lead": [35, "below"],
  "Graduate Trainee|executive": [35, "below"],
  "Graduate Trainee|undefined": [50, "unknown"],
  "Accountant|entry": [50, "above"],
  "Accountant|mid": [55, "match"],
  "Accountant|senior": [50, "below"],
  "Accountant|lead": [35, "below"],
  "Accountant|executive": [35, "below"],
  "Accountant|undefined": [50, "unknown"],
  "Senior Accountant|entry": [35, "above"],
  "Senior Accountant|mid": [50, "above"],
  "Senior Accountant|senior": [55, "match"],
  "Senior Accountant|lead": [50, "below"],
  "Senior Accountant|executive": [35, "below"],
  "Senior Accountant|undefined": [50, "unknown"],
  "Head of Finance|entry": [35, "above"],
  "Head of Finance|mid": [35, "above"],
  "Head of Finance|senior": [50, "above"],
  "Head of Finance|lead": [55, "match"],
  "Head of Finance|executive": [50, "below"],
  "Head of Finance|undefined": [50, "unknown"],
  "Chief Financial Officer|entry": [35, "above"],
  "Chief Financial Officer|mid": [35, "above"],
  "Chief Financial Officer|senior": [35, "above"],
  "Chief Financial Officer|lead": [50, "above"],
  "Chief Financial Officer|executive": [55, "match"],
  "Chief Financial Officer|undefined": [50, "unknown"]
};

describe("no scoring change: the stored values are identical to what main produced before the fix", () => {
  it("score and seniorityAlignment for every resume level x job level (and an unknown job level)", () => {
    const actual: Record<string, [number, Alignment]> = {};
    for (const title of ["Graduate Trainee", "Accountant", "Senior Accountant", "Head of Finance", "Chief Financial Officer"]) {
      for (const job of ["entry", "mid", "senior", "lead", "executive", undefined] as const) {
        const r = computeMatchScore(resume(title), SKILLS, job, undefined);
        actual[`${title}|${job}`] = [r.score, r.explanation.seniorityAlignment];
      }
    }
    expect(actual).toEqual(STORED);
    expect(Object.keys(STORED).length).toBe(30);
  });
});
