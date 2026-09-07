import "server-only";
import type { ResumeExperienceEntry, StructuredResume } from "@/lib/resume/types";
import type { ProposedAddition } from "./types";

/**
 * The backstop that makes "never invent experience" true regardless of
 * what the model actually does, not just what the prompt asks for.
 *
 * WHY THIS EXISTS, IN ONE SENTENCE: a real run (2026-09-06, a PM resume
 * against a Global MEL Manager posting) showed the model dropping 15 of 16
 * real skills and replacing them with a list including Stata, R, Survey
 * Design and Statistical Analysis — none of which the candidate has ever
 * claimed anywhere — plus experience bullets inventing "conducting regular
 * performance reviews and capacity planning" and "standardized integrations
 * across multiple country teams," phrases lifted almost verbatim from the
 * JD's own requirements. `TAILOR_RESPONSE_SCHEMA`'s own field description
 * already said "do not invent experience" before this happened; asking the
 * same completion nicer wasn't going to be the fix. This module is the fix:
 * whatever the model returns, nothing that isn't traceable to the
 * candidate's own base resume reaches `tailoredResume` — the field that
 * gets saved, downloaded, and applied with — without a separate, explicit
 * accept step first.
 *
 * TWO DIFFERENT FIELD SHAPES NEED TWO DIFFERENT CHECKS. `skills` is a flat
 * list of short, mostly-literal terms — a real substring match against the
 * base resume's own text is a workable grounding test. `experience[].
 * description` is free prose, and legitimate tailoring is SUPPOSED to
 * rephrase it — a sentence that doesn't string-match the original is not
 * automatically fabricated, it might just be well-rephrased. So the
 * experience check looks for something narrower and more specific: a
 * multi-word phrase taken from the JD's own extracted keywords/
 * responsibilities/skills that shows up in the tailored description but
 * nowhere in the base resume — the exact shape of "lifted the JD's words
 * into a claim about this candidate" the real incident showed, not merely
 * "phrased differently."
 *
 * DELIBERATELY CONSERVATIVE, NOT PRECISE. "SAFe Agile" in the base resume
 * and "Agile Methodologies" in the tailored output will get flagged here —
 * a reasonable generalisation, not a fabrication, but this module can't
 * tell the difference from a real invention using only text matching, and
 * the founder's own instruction is explicit about which way to err: a
 * flagged item becomes a `ProposedAddition` the candidate can accept in one
 * click, not something silently dropped or silently kept. Over-flagging
 * costs a checkbox; under-flagging is the actual incident this exists to
 * prevent. Do not "fix" false positives here by loosening the match — if
 * they turn out to be a real usability problem, that is a UI-copy question
 * (make accepting a flagged item cheap and fast), not a grounding-test
 * precision question.
 *
 * WHAT THIS DOES NOT COVER, on purpose: `summary` is prose exactly like
 * experience descriptions, but it wasn't fabricated in the incident this
 * was built from (Education/Projects/Certifications and, in that run,
 * Summary all came through byte-for-byte accurate) and a generic 1-3
 * sentence summary is much harder to phrase-match against without false
 * positives dominating. Not covered here; watch for a real summary
 * fabrication before building a check with no real incident to calibrate
 * against.
 */

const MIN_JD_PHRASE_WORDS = 2;

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary containment, not plain substring — the same discipline
 * extract-jd.ts's own SKILL_VOCABULARY matching uses, and for the identical
 * reason. Caught live by this module's own test suite: "R" (one of the
 * real fabricated skills in the incident this exists to catch) is a
 * single-character string, and `vocab.includes("r")` is satisfied by "r"
 * appearing inside "Product", "Manager", "FinTech" — practically any
 * English text — which would have marked "R" as "grounded" and let it
 * straight through.
 *
 * A boundary is only asserted at an edge where the needle's OWN edge
 * character is a word character. Also caught by this module's own tests:
 * an unconditional `\bneedle\b` broke real skill strings like
 * "Analytics (Pendo)" — `\b` requires a transition into/out of a word
 * character, and a needle ending in `)` can never satisfy a TRAILING `\b`
 * against a haystack that continues with a space or nothing, because both
 * sides of that position are non-word. Skipping the boundary at a
 * punctuation edge relies on the punctuation itself to provide separation,
 * which is what actually happens in real text either way.
 */
function containsAsWords(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeRegExp(needle);
  const leading = /^\w/.test(needle) ? "\\b" : "";
  const trailing = /\w$/.test(needle) ? "\\b" : "";
  return new RegExp(`${leading}${escaped}${trailing}`, "i").test(haystack);
}

/**
 * Every word the candidate has actually written, anywhere on their resume,
 * lowercased.
 *
 * INCLUDES `bullets`, NOT JUST `description` — an experience entry now
 * carries its narrative in either field (see `getExperienceText` in
 * resume/types.ts), and this vocabulary is what decides whether a tailored
 * skill or phrase counts as the candidate's own. Missing `bullets` here
 * would make this backstop wrongly flag genuinely-grounded content as
 * fabricated the moment a resume's roles are written as bullets instead of
 * a paragraph — the exact false positive this module's own header warns is
 * worse to under-flag than to over-flag, so it can't be left out.
 */
function baseResumeVocabulary(baseResume: StructuredResume): string {
  return [
    baseResume.summary ?? "",
    ...baseResume.skills,
    ...baseResume.projects,
    ...baseResume.certifications,
    ...baseResume.experience.flatMap((e) => [
      e.title,
      e.company,
      e.location ?? "",
      e.description ?? "",
      ...(e.bullets ?? []),
    ]),
    ...baseResume.education.flatMap((e) => [e.school, e.degree ?? "", e.field ?? ""]),
  ]
    .join(" \n ")
    .toLowerCase();
}

/**
 * JD phrases worth checking against — the model's own extraction of what
 * this job actually asks for, filtered to multi-word phrases only. A bare
 * single word ("leadership", "communication") is too likely to appear in a
 * legitimate rephrase to use as a fabrication signal; a real JD-specific
 * phrase ("capacity planning", "quasi-experimental design") is exactly the
 * kind of thing that shows up verbatim in a resume ONLY if it was lifted
 * from the posting rather than genuinely experienced.
 */
export function extractJdPhrases(structuredJd: {
  skills?: string[];
  keywords?: string[];
  responsibilities?: string[];
}): string[] {
  const all = [
    ...(structuredJd.skills ?? []),
    ...(structuredJd.keywords ?? []),
    ...(structuredJd.responsibilities ?? []),
  ];
  return [...new Set(all.map(normalize))].filter((p) => p.split(/\s+/).length >= MIN_JD_PHRASE_WORDS);
}

export interface SkillsGroundingResult {
  grounded: string[];
  ungrounded: string[];
}

/** A skill is grounded if the candidate's own resume text contains it anywhere. */
export function groundSkills(tailoredSkills: string[], baseResume: StructuredResume): SkillsGroundingResult {
  const vocab = baseResumeVocabulary(baseResume);
  const grounded: string[] = [];
  const ungrounded: string[] = [];
  for (const skill of tailoredSkills) {
    const s = normalize(skill);
    if (s && containsAsWords(vocab, s)) grounded.push(skill);
    else ungrounded.push(skill);
  }
  return { grounded, ungrounded };
}

export interface ExperienceGroundingResult {
  experience: ResumeExperienceEntry[];
  /** Index into the returned array, plus the specific JD phrase that triggered the revert. */
  violations: Array<{ index: number; phrase: string; revertedTo: string }>;
}

/**
 * Reverts a whole entry's description to the matching base-resume entry's
 * own text (matched by title + company) the moment ANY JD-lifted phrase
 * shows up in it that the base resume never mentions — not a surgical edit
 * of just the offending clause. Editing out one phrase from an LLM-written
 * sentence risks leaving a grammatically broken fragment behind, which
 * would read as the product being buggy; reverting the whole entry to text
 * the candidate actually wrote is always coherent, even when it's a net
 * loss of whatever legitimate rephrasing happened to be in the same
 * sentence. That loss is real and is exactly the tradeoff `ProposedAddition`
 * exists to recover: the caller can offer "apply Farah's rewrite of this
 * entry anyway" as a reviewable item off the ORIGINAL (unreverted) model
 * output, and the candidate can just say yes.
 */
export function groundExperienceDescriptions(
  tailoredExperience: ResumeExperienceEntry[],
  baseResume: StructuredResume,
  jdPhrases: string[],
): ExperienceGroundingResult {
  const vocab = baseResumeVocabulary(baseResume);
  const violations: ExperienceGroundingResult["violations"] = [];

  const experience = tailoredExperience.map((entry, index) => {
    const description = normalize(entry.description ?? "");
    if (!description) return entry;

    const suspiciousPhrase = jdPhrases.find(
      (phrase) => containsAsWords(description, phrase) && !containsAsWords(vocab, phrase),
    );
    if (!suspiciousPhrase) return entry;

    const baseEntry = baseResume.experience.find(
      (b) => normalize(b.title) === normalize(entry.title) && normalize(b.company) === normalize(entry.company),
    );
    const revertedTo = baseEntry?.description ?? "";
    violations.push({ index, phrase: suspiciousPhrase, revertedTo });
    return { ...entry, description: revertedTo };
  });

  return { experience, violations };
}

let proposedAdditionCounter = 0;
function nextProposedAdditionId(): string {
  proposedAdditionCounter += 1;
  return `backstop-${Date.now()}-${proposedAdditionCounter}`;
}

/**
 * Runs both checks and returns a resume that's safe to auto-save, plus the
 * backstop's own findings folded into the same `ProposedAddition` shape the
 * model's own declared proposals use — the review UI doesn't need to know
 * or care which source flagged an item, only that this one specific
 * resume never received it without a yes.
 */
export function applyGroundingBackstop(
  tailoredResume: StructuredResume,
  baseResume: StructuredResume,
  structuredJd: { skills?: string[]; keywords?: string[]; responsibilities?: string[] },
): { resume: StructuredResume; additions: ProposedAddition[] } {
  const jdPhrases = extractJdPhrases(structuredJd);

  const { grounded: skills, ungrounded: ungroundedSkills } = groundSkills(tailoredResume.skills, baseResume);
  const { experience, violations } = groundExperienceDescriptions(
    tailoredResume.experience,
    baseResume,
    jdPhrases,
  );

  const additions: ProposedAddition[] = [
    ...ungroundedSkills.map(
      (text): ProposedAddition => ({
        id: nextProposedAdditionId(),
        section: "skills",
        text,
        reason: "This JD asks for it, but it doesn't appear anywhere on your base resume.",
        source: "backstop",
      }),
    ),
    ...violations.map(
      (v): ProposedAddition => ({
        id: nextProposedAdditionId(),
        section: "experience",
        experienceIndex: v.index,
        text: tailoredResume.experience[v.index]?.description ?? "",
        reason: `Farah's rewrite of this role included "${v.phrase}" — from the job description, not your base resume. Your original wording was kept instead; accept this to use Farah's version.`,
        source: "backstop",
      }),
    ),
  ];

  return {
    resume: { ...tailoredResume, skills, experience },
    additions,
  };
}
