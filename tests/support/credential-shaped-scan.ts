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

/** The `'''…'''` literals in a block of TOML, ignoring comment lines. */
function tripleQuoted(block: string): string[] {
  const noComments = block.replace(/^[ \t]*#.*$/gm, "");
  return [...noComments.matchAll(/'''([\s\S]*?)'''/g)].map((m) => m[1]);
}

/** The text of `key = [ … ]`, ended by the first `]` that is alone on its line (entries contain `]` inside regexes). */
function arrayBlock(text: string, key: string, from = 0): string {
  const start = text.indexOf(`${key} = [`, from);
  if (start < 0) throw new Error(`.gitleaks.toml: no "${key} = [" found`);
  const rest = text.slice(start);
  const end = rest.search(/^\]\s*$/m);
  if (end < 0) throw new Error(`.gitleaks.toml: "${key}" array is not closed`);
  return rest.slice(0, end);
}

/** Go (RE2) syntax to a JS RegExp: the only difference these patterns use is the inline (?i) prefix. */
function toJs(source: string): RegExp {
  const insensitive = source.startsWith("(?i)");
  return new RegExp(insensitive ? source.slice(4) : source, insensitive ? "i" : "");
}

export function loadRule(toml: string): Rule {
  const idAt = toml.indexOf(`id = "${RULE_ID}"`);
  if (idAt < 0) throw new Error(`.gitleaks.toml: rule ${RULE_ID} not found`);
  const ruleText = toml.slice(idAt, toml.indexOf("\n[allowlist]", idAt) > 0 ? toml.indexOf("\n[allowlist]", idAt) : undefined);

  const regexAt = ruleText.search(/^regex = '''/m);
  if (regexAt < 0) throw new Error("rule has no regex");
  const regexSrc = tripleQuoted(ruleText.slice(regexAt).split("\nsecretGroup")[0])[0];

  const keywordsBlock = arrayBlock(ruleText, "keywords");
  const keywords = [...keywordsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());

  const allowAt = toml.indexOf("\n[allowlist]");
  if (allowAt < 0) throw new Error(".gitleaks.toml: no [allowlist] section");
  const allowRegexes = tripleQuoted(arrayBlock(toml, "regexes", allowAt)).map(toJs);
  const allowPaths = tripleQuoted(arrayBlock(toml, "paths", allowAt)).map(toJs);

  return { regex: toJs(regexSrc), keywords, allowRegexes, allowPaths };
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
