import { normalizeSkillKeyword } from "@/lib/courses/normalize";

/**
 * A resume's freeform skill entries, expanded into terms the scorer can match.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * The two sides of the comparison are produced by different things and always
 * were. A job's skills come from `extractStructuredJd`, which tests a fixed
 * vocabulary against the posting text, so they are canonical by construction:
 * `aws`, `agile`, `ui/ux`. A resume's come from parsing whatever the candidate
 * typed, so they are prose: real entries on production include
 *
 *   "SAFe Agile"              vs the job's  agile
 *   "Cloud (AWS, Azure)"      vs the job's  aws, azure
 *   "Product (UI/ UX) Design" vs the job's  ui/ux
 *
 * `computeMatchScore` compared them with `Set.has` on a lowercased string, so
 * none of those matched anything. Two of the four real accounts on production
 * carry resumes written this way, and the effect is silent: the skill is on
 * the resume, the job asks for it, and the score says it is missing.
 *
 * ── WHY THIS REUSES normalizeSkillKeyword RATHER THAN MATCHING LOOSELY ────
 *
 * The obvious alternative is substring matching, and it is wrong in the
 * expensive direction: `sql` is a substring of "NoSQL", `hr` of "Thruput", `ai`
 * of "Email". A false match inflates a score that Auto-Apply spends real money
 * acting on, so the comparison stays exact — this only decides what the resume
 * side's exact values ARE.
 *
 * normalizeSkillKeyword already answers exactly that question ("which known
 * skill does this one freeform phrase mean"), with word-boundary matching, an
 * alias table and a deliberate null for anything unrecognised. Rebuilding it
 * here would be the second copy its own header warns about; it lives under
 * `courses/` because that is what needed it first, not because it is about
 * courses.
 *
 * ── WHY SPLITTING IS NEEDED ON TOP OF IT ──────────────────────────────────
 *
 * It returns ONE term. "Cloud (AWS, Azure)" names two, and longest-first
 * matching picks `azure` and drops `aws` — so the entry is split on the
 * punctuation people actually use for lists before each part is normalised.
 *
 * Splitting on `/` looks risky next to a vocabulary containing `ui/ux`, and is
 * not: the fragments `ui` and `ux` are both aliases FOR `ui/ux`, so
 * "UX/UI Design" and a bare "UI/UX" both arrive at the same canonical term
 * from either direction. `.` is deliberately not a separator — it would split
 * `node.js`.
 *
 * The ORIGINAL entry is normalised too, not just its fragments, because some
 * phrases only resolve whole: "Product (UI/ UX) Design" reaches `ui/ux` via
 * the `ux` alias across the parenthesis, and splitting alone would not.
 *
 * ── WHAT IS DELIBERATELY STILL UNMATCHED ──────────────────────────────────
 *
 * "APIs" does not become `rest api`, "Analytics (Pendo)" does not become
 * `data analysis`, and "CI/CD", "System Design" and "Blockchain Basics" stay
 * unmatched. Each would need a new alias asserting two things are the same
 * skill, which is a judgement about the market rather than a parsing fix. This
 * change is about entries whose canonical term is already present and merely
 * unreachable.
 */

/**
 * List punctuation. Not `.` (breaks `node.js`), not `-` (breaks `ui-ux` less
 * often than it breaks hyphenated single skills), not `+` (`c++`).
 */
const SEPARATORS = /[,;|&()[\]/]+/;

/**
 * Every term a resume entry can contribute, canonical and raw alike.
 *
 * The RAW lowercased entry is always kept. It is what the scorer compared
 * before this existed, so an entry already written canonically — "SQL",
 * "Scrum", "Project Management" — keeps matching by exactly the route it
 * always did, and this can only add terms, never remove one.
 */
export function expandResumeSkills(skills: string[]): Set<string> {
  const out = new Set<string>();

  for (const entry of skills) {
    if (typeof entry !== "string") continue;
    const raw = entry.toLowerCase().trim();
    if (raw) out.add(raw);

    const whole = normalizeSkillKeyword(entry);
    if (whole) out.add(whole);

    for (const part of entry.split(SEPARATORS)) {
      const normalised = normalizeSkillKeyword(part);
      if (normalised) out.add(normalised);
    }
  }

  return out;
}
