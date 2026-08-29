import { SKILL_VOCABULARY } from "@/lib/jobs/extract-jd";

/**
 * Freeform gap-analysis keyword → a curated skill tag, or null.
 *
 * ── What was already there, since the plan asked before building ──────────
 *
 * extract-jd.ts does have keyword handling, and it is worth being precise
 * about what: `extractStructuredJd` lowercases a whole JD and then tests each
 * vocabulary term against it as `\bterm\b`. That answers "which known skills
 * appear in this document" — the OPPOSITE direction from the question here,
 * which is "which known skill does this one freeform phrase mean". There is no
 * synonym map, no alias table, and nothing that maps a variant onto a
 * canonical term.
 *
 * So there is no normaliser to reuse. Two things are reused rather than
 * rebuilt: the VOCABULARY itself, now exported instead of copied, and the
 * word-boundary technique, applied to a single phrase instead of a document.
 * That second one earns its place — `\breact\b` matches "React.js" because the
 * dot is a boundary, which handles a whole family of variants for free.
 *
 * It does not handle all of them, which is why the alias map below exists:
 * "Node" cannot reach "node.js" by boundary matching, and no amount of
 * lowercasing gets "JS" to "javascript".
 *
 * ── Returning null is a feature ───────────────────────────────────────────
 *
 * A keyword that maps to nothing gets no recommendation. The plan is explicit
 * that this beats a generic one, and it is the behaviour that keeps this from
 * reading as an ad unit: a course appears only when the catalog genuinely
 * covers the thing the JD asked for.
 */

/**
 * Variants that boundary matching cannot reach.
 *
 * Deliberately small and deliberately not clever. Every entry is a real form a
 * model has reason to emit for a term already in the vocabulary — not a
 * taxonomy of adjacent skills. "postgres" is NOT mapped to "sql": they are
 * different things to want a course in, and quietly widening a match is how a
 * recommendation stops being about what the JD asked for.
 */
const ALIASES: Record<string, string> = {
  js: "javascript",
  "java script": "javascript",
  ts: "typescript",
  node: "node.js",
  nodejs: "node.js",
  "node js": "node.js",
  reactjs: "react",
  "react js": "react",
  nextjs: "next.js",
  "next js": "next.js",
  ux: "ui/ux",
  ui: "ui/ux",
  "ux design": "ui/ux",
  "ui design": "ui/ux",
  "user experience": "ui/ux",
  "product manager": "product management",
  "project manager": "project management",
  "data analytics": "data analysis",
  "data analyst": "data analysis",
  k8s: "kubernetes",
  "amazon web services": "aws",
  "google cloud": "gcp",
  "microsoft excel": "excel",
  powerbi: "power bi",
  "search engine optimization": "seo",
  "search engine optimisation": "seo",
  "business dev": "business development",
  "biz dev": "business development",
  "human resources": "hr",
  "people operations": "hr",
  "stakeholder mgmt": "stakeholder management",
  "restful api": "rest api",
  "rest apis": "rest api",
  "financial modelling": "financial modeling",
};

/** Lowercase, collapse whitespace, drop trailing punctuation. */
function tidy(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9+#./]+$/g, "")
    .trim();
}

/** Escapes the characters the vocabulary actually contains — `.`, `+`, `/`. */
function boundaryPattern(term: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.+/\\^$*?()[\]{}|]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i");
}

export function normalizeSkillKeyword(keyword: string | null | undefined): string | null {
  if (!keyword) return null;
  const tidied = tidy(keyword);
  if (!tidied) return null;

  // 1. Already canonical.
  if ((SKILL_VOCABULARY as readonly string[]).includes(tidied)) return tidied;

  // 2. A known variant.
  if (ALIASES[tidied]) return ALIASES[tidied];

  /*
   * 3. Contains a vocabulary term as a whole word — "React.js developer" ->
   *    react, "Advanced SQL" -> sql.
   *
   *    LONGEST FIRST, and that ordering is load-bearing: "product management"
   *    and "management" would both match a phrase containing the former, and
   *    the shorter one is the wrong answer. Sorting by length means the most
   *    specific vocabulary term wins rather than whichever happens to sit
   *    earlier in the array.
   */
  const byLength = [...SKILL_VOCABULARY].sort((a, b) => b.length - a.length);
  for (const term of byLength) {
    if (boundaryPattern(term).test(tidied)) return term;
  }

  // 4. A variant appearing inside a longer phrase — "senior nodejs engineer".
  for (const [alias, canonical] of Object.entries(ALIASES).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (boundaryPattern(alias).test(tidied)) return canonical;
  }

  return null;
}
