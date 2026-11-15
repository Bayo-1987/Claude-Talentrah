/**
 * The one placeholder value that the CI "Secret scan" reports in the A3 commit of PR #1022 (NOTIF PR-D), and the exact, anchored allowlist entry that clears it.
 *
 * `talentrah-hardcoded-credential` (.gitleaks.toml) matches a name containing token / secret / password / key assigned a quoted literal of 8+ characters. Over origin/main..HEAD the scan reads
 * COMMITS, and the commit f42d020 carried an unsubscribe token that was a fixed made-up word in the operator's test send. The source now uses randomUUID(), but history is not rewritten, so the value is
 * allowlisted by ONE entry that is exactly ^value$ (the repo's convention: see the PR #979 entries). The value is assembled from parts here so that this file does not hold it as a literal.
 *
 * Held here, with the repo's own emulation of the rule (tests/support/credential-shaped-scan.ts, which models `[allowlist]` regexes and paths and nothing else):
 *   (a) the rule reports the line without the allowlist and the allowlist clears it;
 *   (b) exactly one entry matches the value and it is ^<value>$ with every regex character escaped: no wildcard, no alternation, no class;
 *   (c) a value that differs by one character, a longer, a shorter, a padded and an upper-case form are still reported;
 *   (d) the same line shape with another value is still reported;
 *   (e) the entry has a written reason that names the file, the commit and the PR, and says it is ANCHORED;
 *   (f) the entry adds no path exception and no commit list.
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

const VALUE = ["test", "copy"].join("-");
const NAME = ["unsubscribe", "Token"].join("");
const FILE = "src/app/admin/(protected)/messages/test-send.ts";
const COMMIT = "f42d020c4c2787c09b4b8006d4d994f833764b3a";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const scanLine = (value: string, allow: boolean) => scanText("tests/example.test.ts", `${NAME}: "${value}"`, allow ? rule : noAllowlist);

/** Every `'''...'''` entry of the allowlist `regexes` array, with the comment block above it. */
function entries(): Array<{ source: string; reason: string }> {
  const start = toml.search(/^\[allowlist\]\s*$/m);
  const from = start + toml.slice(start).search(/^regexes = \[/m);
  const out: Array<{ source: string; reason: string }> = [];
  let pending: string[] = [];
  let group: string[] = [];
  for (const raw of toml.slice(from).split("\n").slice(1)) {
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

describe("(a) the rule reports the value and the allowlist clears it", () => {
  it("reported without the allowlist, allowed with it", () => {
    expect(scanLine(VALUE, false).findings.map((f) => f.value)).toEqual([VALUE]);
    const real = scanLine(VALUE, true);
    expect(real.findings).toEqual([]);
    expect(real.suppressed).toBe(1);
  });
});

describe("(b) one entry, exactly ^value$", () => {
  it("matches the value and is anchored and escaped", () => {
    const matching = entries().filter((e) => new RegExp(e.source).test(VALUE));
    expect(matching.map((e) => e.source)).toEqual([`^${escapeRegex(VALUE)}$`]);
  });
});

describe("(c) a value that differs is NOT allowed", () => {
  const variants = (v: string): string[] => {
    const out = new Set<string>([v.slice(0, -1), `${v}x`, `x${v}`, `${v} `, ` ${v}`, v.toUpperCase()]);
    for (let i = 0; i < v.length; i++) out.add(v.slice(0, i) + (v[i] === "x" ? "y" : "x") + v.slice(i + 1));
    out.delete(v);
    return [...out];
  };
  it("every variant is reported", () => {
    const all = variants(VALUE).filter((v) => v.trim().length >= 8);
    expect(all.length).toBeGreaterThan(VALUE.length);
    for (const v of all) {
      expect(scanLine(v, false).findings.map((f) => f.value), `the rule must match ${JSON.stringify(v)} at all`).toEqual([v]);
      const real = scanLine(v, true);
      expect(real.findings.map((f) => f.value), `allowed by mistake: ${JSON.stringify(v)}`).toEqual([v]);
      expect(real.suppressed).toBe(0);
    }
  });
});

describe("(d) the same line shape with another value is NOT allowed", () => {
  it("other values are reported", () => {
    for (const other of [fakeSecret("token"), "another-hyphenated-word", "test-copies", "copy-test"]) {
      expect(scanLine(other, true).findings.map((f) => f.value), other).toEqual([other]);
    }
  });
});

describe("(e) the entry has a written reason, and (f) adds no path or commit exception", () => {
  it("names the file, the commit and the PR, and says it is anchored", () => {
    const entry = entries().find((e) => e.source === `^${escapeRegex(VALUE)}$`);
    expect(entry, "no entry for the value").toBeDefined();
    for (const needle of [FILE, COMMIT, "PR #1022", "placeholder", "ANCHORED"]) expect(entry!.reason, needle).toContain(needle);
  });

  it("the file still parses, and no path or commit list was added for this file", () => {
    expect(rule.allowRegexes.length).toBeGreaterThan(0);
    const pathsBlock = toml.slice(toml.search(/^paths = \[/m));
    expect(pathsBlock).not.toContain("test-send");
    expect(toml).not.toMatch(/^commits\s*=/m);
  });
});
