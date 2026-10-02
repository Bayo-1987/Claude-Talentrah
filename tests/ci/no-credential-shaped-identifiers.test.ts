/**
 * Catches, in a unit test and BEFORE the first push, what the CI "Secret scan" would otherwise reject: an identifier
 * the `talentrah-hardcoded-credential` rule trips on, in tests/ or e2e/.
 *
 * WHY. The rule (.gitleaks.toml) matches a name containing secret / password / token / api key / credential that is
 * assigned a quoted literal of 8+ characters. Test fixtures keep tripping it for innocent reasons: a sentinel string
 * named SECRET_JD (#667, three CI runs red before anyone read why), an HMAC literal (#671). CI scans COMMITS, so a
 * rename in a later commit does not clear a finding in an earlier one, and the only cure after the push is an
 * allowlist entry. This test reads the SAME config CI uses (rule, keywords, allowlist), so it cannot drift from it, and
 * fails with file:line:name while the fix is still a rename.
 *
 * WHAT IT DOES NOT DO. It reads the working tree, not git history, so it cannot see a bad line you already committed
 * and then renamed; for that the allowlist (an exact, commented value) is the only fix. It emulates THIS repo's custom
 * rule only (regex per line; keyword prefilter per FILE, as gitleaks applies it per fragment; allowlist matched against
 * the captured value and the path). It does NOT emulate gitleaks' default rules, notably `generic-api-key`, which also
 * fails CI (it fired on this test's own first fixtures): never put a credential-ish name and a 10+ character value on one
 * line in a fixture, not even inside a string; keep such lines in tests/support/credential-shaped-fixtures.txt. CI's real
 * scan remains the authority.
 *
 * HOW TO FIX A FAILURE. Prefer renaming the identifier (PASTED_JD_SENTINEL, not SECRET_JD). If the name is the point
 * (a real fixture for an env-var guard, say), add an EXACT, ANCHORED value to the allowlist in .gitleaks.toml with the
 * reason and the PR number in the comment.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { listFiles, loadRule, scanText } from "../support/credential-shaped-scan";

const ROOT = path.resolve(__dirname, "../..");
const toml = readFileSync(path.join(ROOT, ".gitleaks.toml"), "utf8");
const rule = loadRule(toml);

function scan(text: string, file = "tests/example.test.ts") {
  return scanText(file, text, rule);
}

/**
 * The credential-shaped lines used below live in tests/support/credential-shaped-fixtures.txt, whose exact path is
 * allowlisted in .gitleaks.toml. They must NOT appear in this file: this file is itself scanned (by the tree test below
 * and by CI's real Secret scan). The first version spelled them out here, and CI's scan rejected it four times (two by our
 * custom rule, two by gitleaks' default `generic-api-key`).
 */
type Kind = "BAD" | "GOOD" | "ALLOW" | "NEAR";
interface Fixture { kind: Kind; name: string; line: string }
const fixtures: Fixture[] = readFileSync(path.join(ROOT, "tests/support/credential-shaped-fixtures.txt"), "utf8")
  .split("\n")
  .filter((l) => /^(BAD|GOOD|ALLOW|NEAR)\t/.test(l))
  .map((l) => {
    const [kind, name, ...rest] = l.split("\t");
    return { kind: kind as Kind, name, line: rest.join("\t") };
  });
const of = (kind: Kind) => fixtures.filter((f) => f.kind === kind);

describe("the rule is read from .gitleaks.toml (not re-typed here)", () => {
  it("finds the rule, its keywords and its allowlist, so the scan below is not vacuous", () => {
    expect(rule.regex.source.length).toBeGreaterThan(40);
    expect(rule.keywords).toEqual(expect.arrayContaining(["password", "secret", "token", "credential"]));
    expect(rule.allowRegexes.length).toBeGreaterThanOrEqual(10);
    expect(rule.allowPaths.length).toBeGreaterThanOrEqual(3);
    // a few entries that have been in the file from the start
    const sources = rule.allowRegexes.map((r) => r.source);
    expect(sources).toContain("A-private-resume");
    expect(sources.some((s) => s.includes("CONFIDENTIAL-PASTE-9f3a"))).toBe(true);
  });
});

describe("the extractor fails loudly when .gitleaks.toml changes shape (it must never pass by finding nothing)", () => {
  /** A copy of the REAL config with one deliberate change. Asserts the change landed: a replace that matches nothing proves nothing. */
  function reshaped(from: string | RegExp, to: string): string {
    const out = toml.replace(from, to);
    expect(out, `the reshape of ${String(from).slice(0, 40)} must change the text`).not.toBe(toml);
    return out;
  }
  const KEYWORDS_BLOCK = /\nkeywords = \[[\s\S]*?\n\]\n/;
  const TQ = "'''";
  const REGEX_LINE = new RegExp(`\\nregex = ${TQ}.*${TQ}\\n`);
  const PATHS_BLOCK = /\npaths = \[[\s\S]*?\n\]\n/;

  it("the real file parses to a non-empty rule (baseline for the cases below)", () => {
    expect(rule.regex.source).not.toBe("(?:)");
    expect(rule.keywords.length).toBeGreaterThan(0);
    expect(rule.allowRegexes.length).toBeGreaterThan(0);
    expect(rule.allowPaths.length).toBeGreaterThan(0);
  });

  it.each([
    ["the rule is renamed, so there is no custom rule", () => reshaped('id = "talentrah-hardcoded-credential"', 'id = "renamed-rule"'), /rule .* not found/],
    ["the keyword list is emptied", () => reshaped(KEYWORDS_BLOCK, "\nkeywords = []\n"), /"keywords" list is empty/],
    ["the keyword list is deleted", () => reshaped(KEYWORDS_BLOCK, "\n"), /no "keywords = \["/],
    ["the regex is emptied", () => reshaped(REGEX_LINE, `\nregex = ${TQ}${TQ}\n`), /regex of .* is empty/],
    ["the regex becomes a basic string, not a triple-quoted literal", () => reshaped(REGEX_LINE, '\nregex = "x"\n'), /regex of .* is not a triple-quoted/],
    ["the allowlist section is renamed", () => reshaped("\n[allowlist]\n", "\n[allowlists]\n"), /no \[allowlist\]/],
    ["the allowlist paths are emptied", () => reshaped(PATHS_BLOCK, "\npaths = []\n"), /"paths" list is empty/],
    ["the allowlist paths key is renamed", () => reshaped(PATHS_BLOCK, "\npath_list = []\n"), /no "paths = \["/],
  ])("%s: loadRule throws instead of returning an empty rule", (_name, make, message) => {
    expect(() => loadRule(make())).toThrow(message);
  });

  it("a legal reshape (the keyword list on one line) is read correctly, not mistaken for an empty list", () => {
    const onOneLine = reshaped(KEYWORDS_BLOCK, '\nkeywords = ["password", "secret"]\n');
    expect(loadRule(onOneLine).keywords).toEqual(["password", "secret"]);
  });
});

describe("the fixtures file is not vacuous", () => {
  it("has every kind, in numbers that mean something", () => {
    expect(of("BAD").length).toBeGreaterThanOrEqual(8);
    expect(of("GOOD").length).toBeGreaterThanOrEqual(5);
    expect(of("ALLOW").length).toBeGreaterThanOrEqual(2);
    expect(of("NEAR").length).toBeGreaterThanOrEqual(3);
  });
});

describe("what it flags (known-bad lines)", () => {
  // Judged the way the real scan sees them: in a file that mentions a keyword (a trailing comment does that, and keeps the line number 1).
  it.each(of("BAD").map((f) => [f.name, f.line]))("%s is flagged and named", (name, line) => {
    const { findings } = scan(`${line} // token`);
    expect(findings, line).toHaveLength(1);
    expect(findings[0].name).toBe(name);
    expect(findings[0].line).toBe(1);
  });

  it("reports the line number and the file", () => {
    const { findings } = scan(`// header\n\n${of("BAD")[1].line} // token\n`, "e2e/x.spec.ts");
    expect(findings).toEqual([expect.objectContaining({ file: "e2e/x.spec.ts", line: 3, name: of("BAD")[1].name })]);
  });
});

describe("what it leaves alone (known-good lines)", () => {
  // A good line is judged INSIDE a file that mentions a trigger word elsewhere, which is how the real scan sees it: with the
  // per-file keyword prefilter, a line is only safe if its own shape does not match.
  it.each(of("GOOD").map((f) => [f.line]))("%s", (line) => {
    expect(scan(`// the secret is not here\n${line}`).findings).toEqual([]);
  });
});

describe("the keyword prefilter is per FILE, as in gitleaks", () => {
  const passed = of("BAD").find((f) => f.name === "PASSED")!.line;

  it("a file with no trigger word anywhere is skipped, even if a line is shaped like a credential", () => {
    // 'pass' is in the rule's name pattern but not in its keyword list: with no keyword in the file gitleaks never runs the regex
    expect(scan(passed).findings).toEqual([]);
  });

  it("the same line in a file that mentions a keyword ANYWHERE is evaluated, and flagged", () => {
    expect(scan(`// token\n${passed}`).findings).toHaveLength(1);
  });
});

describe("the allowlist is honoured, narrowly", () => {
  it.each(of("ALLOW").map((f) => [f.line]))("an allowlisted VALUE is suppressed and counted: %s", (line) => {
    const r = scan(line);
    expect(r.findings).toEqual([]);
    expect(r.suppressed).toBe(1);
  });

  it.each(of("NEAR").map((f) => [f.name, f.line]))("a value that only RESEMBLES an allowlisted one is still flagged (%s)", (name, line) => {
    const { findings } = scan(line);
    expect(findings, line).toHaveLength(1);
    expect(findings[0].name).toBe(name);
  });

  it("a path on the path allowlist is skipped entirely, including this PR's fixtures file", () => {
    expect(scan(of("BAD")[0].line, "docs/secrets-audit.md").findings).toEqual([]);
    expect(scan(of("BAD")[0].line, "tests/support/credential-shaped-fixtures.txt").findings).toEqual([]);
  });
});

describe("the one allowlisted fixtures file: exactly that path, and nothing in it is a real-looking value", () => {
  const FIXTURES = "tests/support/credential-shaped-fixtures.txt";

  it("is allowlisted by ONE entry, anchored at both ends, with no directory, glob or wildcard", () => {
    const entries = rule.allowPaths.map((r) => r.source).filter((src) => src.includes("credential-shaped-fixtures"));
    expect(entries).toEqual([new RegExp("^tests/support/credential-shaped-fixtures\\.txt$").source]);
    // nothing but the anchors, escaped dots and slashes, and plain path characters: no `.*`, `?`, `+`, `|`, `[…]`, `(…)`, no bare dot
    expect(entries[0].replace(/^\^|\$$/g, "").replace(/\\[./]/g, "")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is the ONLY path-allowlist entry that exempts this file, and it exempts nothing nearby", () => {
    const matching = (file: string) => rule.allowPaths.filter((r) => r.test(file));
    expect(matching(FIXTURES)).toHaveLength(1);
    for (const near of [
      "tests/support/credential-shaped-fixtures.txt.bak",
      "tests/support/credential-shaped-fixtures.ts",
      "tests/support/credential-shaped-fixturesXtxt",
      "tests/support/credential-shaped-fixtures.txt/extra.ts",
      "x/tests/support/credential-shaped-fixtures.txt",
      "tests/support/other.txt",
      "tests/support/",
      "tests/",
      "e2e/credential-shaped-fixtures.txt",
    ]) {
      expect(matching(near), near).toEqual([]);
    }
  });

  // Anything in the fixtures file is never scanned, by this test or by CI. So the file may hold nothing that looks real: a
  // real-looking value added "just for a test" would be committed past the one check that exists to catch it.
  const valueOf = (line: string): string | undefined => {
    const literals = [...line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)];
    return literals.length ? literals[literals.length - 1][2] : undefined;
  };

  it("every quoted value carries the obvious fake marker FAKE, except the allowlisted sentinels, which are already vetted by value", () => {
    let checked = 0;
    for (const f of fixtures) {
      const value = valueOf(f.line);
      if (value === undefined) continue; // no literal on the line (an env read, a comment): nothing to look real
      if (f.kind === "ALLOW") {
        expect(scan(f.line).suppressed, `${f.line}: an ALLOW value must be one the real allowlist already names`).toBe(1);
        continue;
      }
      checked += 1;
      expect(value, `${f.kind} ${f.name}: ${f.line}`).toContain("FAKE");
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it("the marker check itself rejects a real-looking value (so it is not vacuous)", () => {
    expect(valueOf('const dbValue = "hunter2hunter2";')).not.toContain("FAKE");
    expect(valueOf('const dbValue = "hunter2-FAKE-hunter2";')).toContain("FAKE");
    expect(valueOf('vi.stubEnv("SOME_NAME", "a-real-looking-value")')).toBe("a-real-looking-value");
  });
});

describe("today's tests/ and e2e/", () => {
  const files = listFiles(ROOT, ["tests", "e2e"]);
  const results = files.map((f) => ({ f, ...scanText(f, readFileSync(path.join(ROOT, f), "utf8"), rule) }));

  it("the scan really visits the tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.startsWith("tests/"))).toBe(true);
    expect(files.some((f) => f.startsWith("e2e/"))).toBe(true);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("the real test fixtures that need credential-like names are all allowlisted by value (so the allowlist is in use)", () => {
    expect(results.reduce((n, r) => n + r.suppressed, 0)).toBeGreaterThanOrEqual(5);
  });

  it("no test or e2e file has an identifier the talentrah-hardcoded-credential rule would trip", () => {
    const offenders = results.flatMap((r) => r.findings).map((x) => `${x.file}:${x.line}  ${x.name} = "${x.value.slice(0, 24)}"`);
    expect(
      offenders,
      "These lines would fail CI's Secret scan. Rename the identifier (PASTED_JD_SENTINEL, not SECRET_JD). If the name is the point, add an exact anchored value to .gitleaks.toml with a comment (reason + PR number).",
    ).toEqual([]);
  });
});
