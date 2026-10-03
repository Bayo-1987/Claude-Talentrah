/**
 * An emulation of the `talentrah-hardcoded-credential` rule in .gitleaks.toml, for the unit test in
 * tests/ci/no-credential-shaped-identifiers.test.ts. It reads the rule, its keywords and the allowlist FROM that file
 * (so it cannot drift from what CI's Secret scan uses) with a small extractor, because the repo carries no TOML library
 * and this is not worth a dependency.
 *
 * What it reproduces of gitleaks, for THIS repo's own rule only: the line-by-line regex match; the `keywords` prefilter,
 * applied per FILE exactly as gitleaks applies it per fragment (a file with no keyword anywhere is skipped; a file with
 * one is scanned in full); the rule's second capture group as the "secret"; the allowlist `regexes` matched against that
 * secret and `paths` matched against the file path.
 *
 * What it does NOT do: read git history; or emulate gitleaks' DEFAULT rules (`useDefault = true` pulls in
 * `generic-api-key`, which fired on the first version of this PR's own fixtures: it matches a keyword-ish name, a
 * separator that includes a COMMA, and a high-entropy value). Those depend on an entropy threshold and a stopword list
 * this emulation does not have; an approximation was tried against today's tree and reported 49 false positives, so it
 * is deliberately not shipped. CI's real scan stays the authority for them.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface Finding {
  file: string;
  line: number;
  /** The identifier that carries a trigger word. */
  name: string;
  /** The quoted literal it is assigned. */
  value: string;
}

export interface Rule {
  regex: RegExp;
  keywords: string[];
  allowRegexes: RegExp[];
  allowPaths: RegExp[];
}

const RULE_ID = "talentrah-hardcoded-credential";

/**
 * The string values of `key = [ … ]` in `text`, however the array is laid out (one line or many, comments between entries).
 * It walks the text rather than matching a closing `]` by pattern, because entries are regexes that contain `]`. Every shape it
 * cannot make sense of throws: this feeds a security test, and "found nothing" must never be what a parse failure looks like.
 */
function arrayValues(text: string, key: string): string[] {
  const open = new RegExp(`^${key} = \\[`, "m").exec(text);
  if (!open) throw new Error(`.gitleaks.toml: no "${key} = [" found`);
  const values: string[] = [];
  let i = open.index + open[0].length;
  while (i < text.length) {
    const c = text[i];
    if (c === "]") return values;
    if (c === "#") {
      i = text.indexOf("\n", i);
      if (i < 0) break;
    } else if (text.startsWith("'''", i)) {
      const end = text.indexOf("'''", i + 3);
      if (end < 0) break;
      values.push(text.slice(i + 3, end));
      i = end + 3;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) break;
      values.push(text.slice(i + 1, j));
      i = j + 1;
    } else {
      i += 1;
    }
  }
  throw new Error(`.gitleaks.toml: "${key}" array is not closed`);
}

/** Go (RE2) syntax to a JS RegExp: the only difference these patterns use is the inline (?i) prefix. */
function toJs(source: string): RegExp {
  const insensitive = source.startsWith("(?i)");
  return new RegExp(insensitive ? source.slice(4) : source, insensitive ? "i" : "");
}

/** The text from `from` up to the next table header (`[x]` / `[[x]]` at the start of a line), or the end of the file. */
function untilNextTable(text: string, from: number): string {
  const next = text.slice(from).search(/\n\[/);
  return next < 0 ? text.slice(from) : text.slice(from, from + next);
}

function nonEmpty<T>(key: string, list: T[]): T[] {
  if (list.length === 0) throw new Error(`.gitleaks.toml: the "${key}" list is empty, so the scan would match nothing`);
  return list;
}

/**
 * Every failure to read the rule is a thrown Error naming what was missing or empty: the rule, its regex, its keywords, the
 * allowlist's regexes or paths. A scanner that quietly reads "no rule" or "no keywords" would skip every file and report a clean tree.
 */
export function loadRule(toml: string): Rule {
  const idAt = toml.indexOf(`id = "${RULE_ID}"`);
  if (idAt < 0) throw new Error(`.gitleaks.toml: rule ${RULE_ID} not found`);
  const ruleText = untilNextTable(toml, idAt);

  const regexLine = /^regex = (.*)$/m.exec(ruleText);
  if (!regexLine) throw new Error(`.gitleaks.toml: rule ${RULE_ID} has no regex`);
  const quoted = /^'''([\s\S]*)'''$/.exec(regexLine[1].trim());
  if (!quoted) throw new Error(`.gitleaks.toml: the regex of ${RULE_ID} is not a triple-quoted literal, which is the only form this reader knows`);
  if (quoted[1] === "") throw new Error(`.gitleaks.toml: the regex of ${RULE_ID} is empty`);

  const keywords = nonEmpty("keywords", arrayValues(ruleText, "keywords")).map((k) => k.toLowerCase());

  const allowAt = toml.search(/^\[allowlist\]\s*$/m);
  if (allowAt < 0) throw new Error(".gitleaks.toml: no [allowlist] section");
  const allowText = untilNextTable(toml, allowAt + 1);
  const allowRegexes = nonEmpty("regexes", arrayValues(allowText, "regexes")).map(toJs);
  const allowPaths = nonEmpty("paths", arrayValues(allowText, "paths")).map(toJs);

  return { regex: toJs(quoted[1]), keywords, allowRegexes, allowPaths };
}

export function scanText(file: string, text: string, rule: Rule): { findings: Finding[]; suppressed: number } {
  const findings: Finding[] = [];
  let suppressed = 0;
  if (rule.allowPaths.some((p) => p.test(file))) return { findings, suppressed };

  // gitleaks applies `keywords` to the WHOLE fragment (here: the file), not line by line: if the text contains any
  // keyword anywhere (even in a comment), every line is then run through the regex. A per-line prefilter missed
  // `const PASSED = "..."` in a file that merely mentioned "secret" elsewhere, which the real scan flagged.
  const lowerText = text.toLowerCase();
  if (!rule.keywords.some((k) => lowerText.includes(k))) return { findings, suppressed };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = rule.regex.exec(lines[i]);
    if (!m) continue;
    const [, name, value] = m;
    if (rule.allowRegexes.some((a) => a.test(value))) {
      suppressed += 1;
      continue;
    }
    findings.push({ file, line: i + 1, name, value });
  }
  return { findings, suppressed };
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|sql|ya?ml|toml|txt|html|css|sh)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "test-results", "playwright-report", ".git"]);

/** Repo-relative paths (forward slashes) of the text files under `dirs`. */
export function listFiles(root: string, dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(root, rel))) {
      const childRel = `${rel}/${name}`;
      const full = path.join(root, childRel);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(childRel);
      } else if (TEXT_EXT.test(name)) {
        out.push(childRel);
      }
    }
  };
  for (const d of dirs) walk(d);
  return out.sort();
}
