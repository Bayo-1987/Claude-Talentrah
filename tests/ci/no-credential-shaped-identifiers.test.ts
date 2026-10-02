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
