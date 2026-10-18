/**
 * The three descriptive sentences in the export manifest and README that the CI "Secret scan" reads as credentials, and the exact, anchored allowlist entries that clear them.
 *
 * WHAT HAPPENED. `talentrah-hardcoded-credential` (.gitleaks.toml) matches a name containing secret / token / password / key assigned a quoted literal of 8+ characters. Three constants in
 * the export code have such names and hold plain English: the manifest's reason strings for a secret and a token column, and the README line saying secrets are never exported. Nothing there
 * is a credential and nothing is rotatable. CI scans COMMITS, and the commit that first carried them is in the PR's history, so renaming now would not help: each value is allowlisted instead.
 *
 * WHAT THIS HOLDS. It reads the rule and the allowlist from .gitleaks.toml with the same reader tests/ci/no-credential-shaped-identifiers.test.ts uses (tests/support/credential-shaped-scan.ts),
 * runs the rule over the REAL lines of the two source files, and asserts: (a) every hit is allowlisted, by an entry that is ANCHORED (^ and $) and has no wildcard; (b) look-alikes are NOT
 * allowlisted: the same names with a credential-shaped value, and each sentence with one word changed. The look-alike lines are built at run time from the real lines, so no
 * credential-shaped line is typed in this file (this file is itself scanned).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRule, scanText } from "../support/credential-shaped-scan";
import { fakeSecret } from "../support/fake-secret";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const rule = loadRule(read(".gitleaks.toml"));
const noAllowlist = { ...rule, allowRegexes: [] as RegExp[] };

const MANIFEST = "src/lib/account-export/manifest.ts";
const README = "src/lib/account-export/readme.ts";
const sources = { [MANIFEST]: read(MANIFEST), [README]: read(README) };

/** The hits of the rule on the real files, before any allowlist. */
const hits = Object.entries(sources).flatMap(([file, text]) => scanText(file, text, noAllowlist).findings);

describe("the rule's hits on the export code are exactly three descriptive sentences", () => {
  it("finds them (the check is not empty): manifest twice, readme once", () => {
    expect(hits.map((h) => h.file).sort()).toEqual([MANIFEST, MANIFEST, README].sort());
    for (const h of hits) expect(h.value.length, `${h.file}:${h.line}`).toBeGreaterThan(40);
  });
});

describe("(a) every hit is allowlisted, by an anchored entry with no wildcard", () => {
  it.each(Object.entries(sources))("%s: the rule reports nothing once the allowlist is applied", (file, text) => {
    expect(scanText(file, text, rule).findings.map((f) => `${f.file}:${f.line} ${f.name}`)).toEqual([]);
  });

  it("each hit is matched by exactly one allowlist entry, and that entry is ^...$ anchored with no .* or .+", () => {
    for (const h of hits) {
      const matching = rule.allowRegexes.filter((a) => a.test(h.value));
      expect(matching, `${h.file}:${h.line}`).toHaveLength(1);
      const src = matching[0].source;
      expect(src.startsWith("^") && src.endsWith("$"), `not anchored: ${src.slice(0, 40)}`).toBe(true);
      expect(src).not.toMatch(/\.\*|\.\+|\.\{/);
    }
  });
});

describe("(b) look-alikes are NOT allowlisted", () => {
  const NAME_A = ["SEC", "RET"].join("");
  const NAME_B = ["TO", "KEN"].join("");
  const line = (name: string, value: string) => `const ${name} = "${value}";`;
  const scan = (text: string) => scanText("tests/example.ts", text, rule);

  it("the same constant names with a credential-shaped value are reported", () => {
    for (const name of [NAME_A, NAME_B, `SECRETS_${"LINE"}`]) {
      const r = scan(line(name, fakeSecret("token")));
      expect(r.findings, name).toHaveLength(1);
      expect(r.suppressed).toBe(0);
    }
  });

  it.each(hits.map((h, i) => [i, h.value] as const))("hit %i with ONE word changed is reported, and the real sentence is not", (_i, value) => {
    const words = value.split(" ");
    const at = words.findIndex((w) => w.length > 3);
    const changed = [...words.slice(0, at), `${words[at]}x`, ...words.slice(at + 1)].join(" ");
    expect(changed).not.toBe(value);
    expect(scan(line(NAME_A, changed)).findings).toHaveLength(1);
    expect(scan(line(NAME_A, `${value} `)).findings, "trailing text defeats an anchored entry").toHaveLength(1);
    expect(scan(line(NAME_A, value)).findings, "the real sentence is allowlisted").toHaveLength(0);
  });

  it("the entries do not relax the rule for anything else: a short unrelated sentence under the same name is still reported", () => {
    expect(scan(line(NAME_B, "not one of the three sentences")).findings).toHaveLength(1);
  });
});
