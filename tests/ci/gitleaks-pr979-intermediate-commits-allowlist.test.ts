/**
 * The two test-fixture strings that the CI "Secret scan" reported in INTERMEDIATE commits of PR #979, and the exact, anchored allowlist entries that clear them.
 *
 * WHAT HAPPENED. `talentrah-hardcoded-credential` (.gitleaks.toml) matches a name containing secret / token / password / key assigned a quoted literal of 8+ characters. Over
 * origin/main..d30e2298 the real scan reported two hits, both in commits that are not the tip (the tip does not carry either line):
 *   - tests/notifications/fake-n1-alignment.test.ts, commit 72c7014: a `p_token` argument holding a made-up hyphenated word, to call the fake with an unknown token;
 *   - tests/supabase/migration-0265-functions-api.test.ts, commit 03599a2: a constant holding a made-up hyphenated word, spliced into a URL to prove a push endpoint is refused.
 * Neither is a credential and nothing is rotatable. The scan reads COMMITS and history is not rewritten, so each value is allowlisted instead (this is the repo's own convention: see the
 * entries for PR #667, #671 and #686).
 *
 * WHAT THIS HOLDS. It reads the rule and the allowlist from .gitleaks.toml with the same reader tests/ci/no-credential-shaped-identifiers.test.ts uses (tests/support/credential-shaped-scan.ts), and asserts:
 *   (a) both values are allowed, and the rule would report them without the allowlist (the check is not vacuous);
 *   (b) each is allowed by ONE entry that is exactly ^<the value>$ with every regex character escaped: no wildcard, no alternation, no class;
 *   (c) a value that differs by ONE character (every position, plus a longer, a shorter, a padded and an upper-case form) is still reported;
 *   (d) the same line shape with a different value is still reported;
 *   (e) every allowlist entry has a written reason, and each of the two says what it is: the file, the commit, PR #979, "intermediate commit", "test fixture";
 *   (f) the file still parses, and there is no commit list and no path exception for either file.
 * The look-alike lines are built at run time from split names, so no credential-shaped line is typed in this file (this file is itself scanned).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRule, scanText } from "../support/credential-shaped-scan";
import { fakeSecret } from "../support/fake-secret";

const ROOT = path.resolve(__dirname, "../..");
const toml = readFileSync(path.join(ROOT, ".gitleaks.toml"), "utf8");
const rule = loadRule(toml);
const noAllowlist = { ...rule, allowRegexes: [] as RegExp[], allowPaths: [] as RegExp[] };

/** The two values, the file each came from and the commit that first carried it. */
const CASES = [
  { value: "no-such-token", name: ["p", "token"].join("_"), file: "tests/notifications/fake-n1-alignment.test.ts", commit: "72c7014" },
  { value: "secret-endpoint-value", name: ["sec", "ret"].join(""), file: "tests/supabase/migration-0265-functions-api.test.ts", commit: "03599a2" },
] as const;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The line shape that was reported, built from the parts so that no literal of that shape is typed here. */
const lineOf = (name: string, value: string) => `${name}: "${value}"`;
const scanLine = (name: string, value: string, allow: boolean) => scanText("tests/example.test.ts", lineOf(name, value), allow ? rule : noAllowlist);

/** Every `'''...'''` entry of the allowlist `regexes` array, with the comment block that heads its group. */
function allowEntries(): Array<{ source: string; reason: string }> {
  const start = toml.search(/^\[allowlist\]\s*$/m);
  const from = start + toml.slice(start).search(/^regexes = \[/m);
  const body = toml.slice(from).split("\n").slice(1);
  const out: Array<{ source: string; reason: string }> = [];
  let pending: string[] = [];
  let group: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (line === "]") return out;
    if (line === "") {
      pending = [];
      group = [];
    } else if (line.startsWith("#")) {
      pending.push(line);
    } else {
      const m = /^'''(.*)''',?$/.exec(line);
      if (!m) throw new Error(`unrecognised line in the allowlist regexes: ${line.slice(0, 60)}`);
      if (pending.length > 0) {
        group = pending;
        pending = [];
      }
      out.push({ source: m[1], reason: group.join("\n") });
    }
  }
  throw new Error("the allowlist regexes array is not closed");
}
const entries = allowEntries();

describe("(a) both values are allowed, and the rule alone would report them", () => {
  it.each(CASES)("$value: reported without the allowlist, allowed with it", ({ name, value }) => {
    const bare = scanLine(name, value, false);
    expect(bare.findings.map((f) => f.value)).toEqual([value]);
    const real = scanLine(name, value, true);
    expect(real.findings).toEqual([]);
    expect(real.suppressed).toBe(1);
  });
});

describe("(b) each value is allowed by ONE entry that is exactly ^value$", () => {
  it.each(CASES)("$value", ({ value }) => {
    const matching = entries.filter((e) => new RegExp(e.source).test(value));
    expect(matching.map((e) => e.source)).toEqual([`^${escapeRegex(value)}$`]);
  });

  it("the two entries match nothing but their own value among the values this file knows", () => {
    for (const c of CASES) {
      const mine = new RegExp(`^${escapeRegex(c.value)}$`);
      for (const other of CASES) expect(mine.test(other.value), `${c.value} vs ${other.value}`).toBe(other.value === c.value);
    }
  });
});

describe("(c) a value that differs by one character is NOT allowed, and still matches the rule", () => {
  const variants = (v: string): string[] => {
    const out = new Set<string>([v.slice(0, -1), `${v}x`, `x${v}`, `${v} `, ` ${v}`, v.toUpperCase()]);
    for (let i = 0; i < v.length; i++) out.add(v.slice(0, i) + (v[i] === "x" ? "y" : "x") + v.slice(i + 1));
    out.delete(v);
    return [...out];
  };

  it.each(CASES)("$value: every variant is reported", ({ name, value }) => {
    const all = variants(value);
    expect(all.length).toBeGreaterThan(value.length);
    for (const v of all) {
      expect(scanLine(name, v, false).findings.map((f) => f.value), `the rule must match ${JSON.stringify(v)} at all`).toEqual([v]);
      const real = scanLine(name, v, true);
      expect(real.findings.map((f) => f.value), `allowed by mistake: ${JSON.stringify(v)}`).toEqual([v]);
      expect(real.suppressed).toBe(0);
    }
  });
});

describe("(d) the same line shape with a different value is NOT allowed", () => {
  it.each(CASES)("$name with other values", ({ name }) => {
    for (const other of [fakeSecret("token"), "another-hyphenated-word", "no-such-thing", "secret-endpoint", "one-more-fixture-word"]) {
      expect(scanLine(name, other, true).findings.map((f) => f.value), other).toEqual([other]);
    }
  });

  it("an allowed value under a different name is still allowed: the entries are by VALUE, as every other entry in the file", () => {
    expect(scanLine(CASES[0].name, CASES[1].value, true).findings).toEqual([]);
  });
});

describe("(e) every allowlist entry has a written reason", () => {
  it("each entry sits under a comment block", () => {
    expect(entries.length).toBeGreaterThan(CASES.length);
    for (const e of entries) expect(e.reason.length, `no reason above ${e.source.slice(0, 50)}`).toBeGreaterThan(40);
  });

  it.each(CASES)("$value: the reason names the file, the commit, PR #979, an intermediate commit and a test fixture", ({ value, file, commit }) => {
    const entry = entries.find((e) => e.source === `^${escapeRegex(value)}$`);
    expect(entry, `no entry for ${value}`).toBeDefined();
    const reason = entry!.reason;
    for (const needle of [file, commit, "PR #979", "intermediate commit", "test fixture"]) expect(reason, needle).toContain(needle);
    expect(reason).toMatch(/ANCHORED/);
  });

  it("the two reasons are their own: neither is the block of some other entry", () => {
    const reasons = CASES.map((c) => entries.find((e) => e.source === `^${escapeRegex(c.value)}$`)?.reason);
    expect(reasons[0]).not.toBe(reasons[1]);
    expect(reasons[0]).not.toContain(CASES[1].file);
    expect(reasons[1]).not.toContain(CASES[0].file);
  });
});

describe("(f) the file still parses, with no commit list and no path exception for either file", () => {
  it("parses to a rule with a regex, keywords, and both lists", () => {
    expect(() => loadRule(toml)).not.toThrow();
    expect(rule.regex.source.length).toBeGreaterThan(50);
    expect(rule.keywords.length).toBeGreaterThan(5);
    expect(rule.allowRegexes.length).toBeGreaterThan(10);
    expect(rule.allowPaths.length).toBeGreaterThan(3);
    expect(toml).toMatch(/^\[extend\]\s*\nuseDefault = true/m);
    expect(toml).toContain('id = "talentrah-hardcoded-credential"');
  });

  it("no allowlist entry appears twice", () => {
    const sources = entries.map((e) => e.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("there is no commit list anywhere in the file (a commit allowlist is rejected: it would wave through anything in those commits)", () => {
    const code = toml.split("\n").filter((l) => !l.trim().startsWith("#"));
    expect(code.filter((l) => /^\s*commits\s*=/.test(l))).toEqual([]);
  });

  it("neither file is exempted by a path entry", () => {
    for (const c of CASES) expect(rule.allowPaths.filter((p) => p.test(c.file)).map((p) => p.source), c.file).toEqual([]);
  });
});
