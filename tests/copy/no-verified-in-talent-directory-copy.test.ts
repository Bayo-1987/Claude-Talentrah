/**
 * The word "verified" must not appear in user-facing Talent Directory copy (VERIFY-1 Phase 0a).
 *
 * Why. The badge used to say "Verified — 87/100". What it stood for: Farah (or one mentor) read the resume for completeness and consistency. Nothing checks
 * identity, employment history or skills. An employer who reads "Verified" believes more than was checked. So the copy says what was done: "Resume reviewed by
 * Farah (AI)" or "Resume reviewed by a Talentrah mentor". This scan is what keeps the old word from coming back, one string at a time.
 *
 * What it scans. The files that carry Talent Directory, applicant-list, related email and marketing copy (SCANNED below). In each file, comments are removed, then:
 *   - every quoted string or template literal that contains "verified" (any case), and
 *   - every piece of JSX text that contains it
 * is a violation, EXCEPT the bare data literals "verified" and "unverified" (the database's status values: `status === "verified"` is a comparison, not copy).
 * Identifiers (verifiedAt, isVerified) are not strings and are not scanned.
 *
 * ALLOWLIST. Empty on purpose. It is reserved for a future check that really verifies something (an identity or employment check): a line goes here, with
 * the file, the exact string and the reason, only when that check exists. Not for convenience.
 *
 * What it does NOT cover. "Verified employer" (the CAC check and the work-email-domain check on organisations) and "verified" job and scholarship listings are
 * different, real checks, and stay. That is why the employer landing page and the FAQ ("your company profile is verified") are not in the list above.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Files and directories (relative to the repo root) whose user-facing strings are in scope. */
export const SCANNED = [
  "src/app/employer/talent-directory",
  "src/app/(app)/talent-directory",
  "src/app/(app)/mentorship/reviews",
  "src/app/(app)/mentorship/apply/reviews-verifications-toggle.tsx",
  "src/app/employer/jobs/[id]/applicants",
  "src/components/employer/applicant-list.tsx",
  "src/components/employer/talent-directory-preview-panel.tsx",
  "src/components/talent-directory",
  "src/lib/talent-directory",
  "src/app/how-we-review-resumes",
] as const;

/** Reserved for a future real check. Each entry: { file, text, reason }. Empty today. */
export const ALLOWLIST: ReadonlyArray<{ file: string; text: string; reason: string }> = [];

const DATA_LITERALS = new Set(["verified", "unverified"]);

function filesIn(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return [];
  }
  if (stat.isFile()) return /\.(ts|tsx)$/.test(rel) ? [rel] : [];
  return readdirSync(abs).flatMap((name) => filesIn(path.join(rel, name)));
}

/**
 * One pass over the source: comments are dropped (line numbers kept), and every string or template literal is lifted out as { text, index } with its place in
 * the code replaced by "S" so the rest can be searched for JSX text without a ">" or "<" inside a string confusing it.
 */
function lex(src: string): { code: string; strings: Array<{ text: string; index: number }> } {
  let code = "";
  const strings: Array<{ text: string; index: number }> = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") code += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      let text = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") {
          text += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c !== "`" && src[i] === "\n") break; // an apostrophe in JSX text, not a string
        text += src[i];
        i++;
      }
      if (src[i] === c) {
        strings.push({ text, index: code.length });
        code += "S" + "\n".repeat((text.match(/\n/g) ?? []).length);
        i++;
      } else {
        code += src.slice(start, i); // not a string after all (an apostrophe): keep it as text
      }
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings };
}

/** A string that is only identifiers (a column list such as "talent_verified_at, talent_directory_opt_in") is data, not copy. */
const isIdentifierList = (t: string) => /^[a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)*$/.test(t) && /_/.test(t);

export interface Violation {
  file: string;
  line: number;
  text: string;
}

export function scan(file: string, source: string): Violation[] {
  const { code, strings } = lex(source);
  const found: Violation[] = [];
  const lineOf = (index: number) => code.slice(0, index).split("\n").length;
  const record = (index: number, text: string) => {
    const t = text.trim();
    if (!/verified/i.test(t)) return;
    if (DATA_LITERALS.has(t) || isIdentifierList(t)) return;
    if (ALLOWLIST.some((a) => a.file === file && a.text === t)) return;
    found.push({ file, line: lineOf(index), text: t.replace(/\s+/g, " ").slice(0, 120) });
  };
  for (const s of strings) record(s.index, s.text);
  // JSX text: between a tag's ">" and the next "<" or "{".
  for (const m of code.matchAll(/>([^<>{}]*verified[^<>{}]*)(?=[<{])/gi)) record(m.index ?? 0, m[1]);
  return found.sort((a, b) => a.line - b.line);
}

describe("the scan itself", () => {
  it("finds user-facing copy and ignores the database's status values, column lists, identifiers and comments", () => {
    const src = [
      "// Verified — this comment is not copy",
      'const a = "Verified — 87/100";',
      'const ok = status === "verified";',
      "const b = `Search ${x} verified candidates`;",
      "const verifiedAt = 1;",
      "export const C = () => <p>Search verified candidates.</p>;",
      "const url = 'https://example.com/path';",
      'const cols = "talent_verification_status, talent_verified_at";',
      "const c = \"You're verified.\";",
    ].join("\n");
    expect(scan("x.tsx", src).map((v) => `${v.line}:${v.text}`)).toEqual([
      "2:Verified — 87/100",
      "4:Search ${x} verified candidates",
      "6:Search verified candidates.",
      "9:You're verified.",
    ]);
  });

  it("the allowlist is empty today", () => {
    expect(ALLOWLIST).toEqual([]);
  });

  it("every scanned path exists (a renamed folder must not silently shrink the scan)", () => {
    for (const rel of SCANNED) {
      if (rel === "src/app/how-we-review-resumes" || rel === "src/components/talent-directory") continue; // created by this change / may not exist yet
      expect(filesIn(rel).length, `${rel} has no scannable files`).toBeGreaterThan(0);
    }
  });
});

describe("user-facing Talent Directory copy says what was done, not 'verified'", () => {
  const files = SCANNED.flatMap(filesIn).filter((f) => !/\.test\.(ts|tsx)$/.test(f));

  it("scans a real number of files", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no 'verified' in any user-facing string", () => {
    const violations = files.flatMap((f) => scan(f, readFileSync(path.join(ROOT, f), "utf8")));
    expect(
      violations.map((v) => `${v.file}:${v.line}  ${v.text}`),
      "These strings say 'verified'. Say what was done: 'Resume reviewed by Farah (AI)' / 'Resume reviewed by a Talentrah mentor'. See VERIFY-1 Phase 0a.",
    ).toEqual([]);
  });
});
