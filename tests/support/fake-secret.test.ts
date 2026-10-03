/**
 * fakeSecret (tests/support/fake-secret.ts): each kind has the shape its consumer expects, each call is fresh, and neither the helper nor a
 * consumer of it contains a credential-shaped literal, so the Secret scan has nothing to reject and nothing needs allowlisting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fakeSecret, type FakeKind } from "./fake-secret";
import { isPasswordValid } from "@/lib/auth/password";
import { loadRule, scanText } from "./credential-shaped-scan";

const SHAPES: Record<FakeKind, RegExp> = {
  paystackSecret: /^sk_test_[0-9a-f]{40}$/,
  resendKey: /^re_[A-Za-z0-9]{8}_[A-Za-z0-9]{24}$/,
  stripeShaped: /^sk_test_[A-Za-z0-9]{24}$/,
  token: /^[0-9a-f]{32}$/,
  password: /^[A-Z][a-z][2-9]-[A-Za-z0-9]{20}$/,
};
const KINDS = Object.keys(SHAPES) as FakeKind[];

describe("fakeSecret: the shape each consumer expects", () => {
  it.each(KINDS)("%s matches its pinned shape, every time", (kind) => {
    for (let i = 0; i < 50; i++) expect(fakeSecret(kind), `${kind} #${i}`).toMatch(SHAPES[kind]);
  });

  it("a password sample passes the app's own rule (client check, and so the server's)", () => {
    for (let i = 0; i < 50; i++) expect(isPasswordValid(fakeSecret("password"))).toBe(true);
  });

  it("is never the same twice", () => {
    for (const kind of KINDS) expect(new Set(Array.from({ length: 20 }, () => fakeSecret(kind))).size, kind).toBe(20);
  });

  it("a generic token and the key shapes are long enough for the scan's own rule (8+ characters), so the helper is not trivially safe", () => {
    for (const kind of KINDS) expect(fakeSecret(kind).length, kind).toBeGreaterThanOrEqual(8);
  });
});

describe("the helper and its consumers pass the #680 scan", () => {
  const rule = loadRule(readFileSync(path.join(__dirname, "../../.gitleaks.toml"), "utf8"));

  it("the helper's own source has no credential-shaped literal", () => {
    const text = readFileSync(path.join(__dirname, "fake-secret.ts"), "utf8");
    expect(scanText("tests/support/fake-secret.ts", text, rule).findings).toEqual([]);
  });

  it("a test that uses it has none either, for every kind", () => {
    const lines = KINDS.map((k) => `const sample = fakeSecret("${k}"); // token`).join("\n");
    expect(scanText("tests/example.test.ts", lines, rule).findings).toEqual([]);
  });

  it("the same VALUES written as literals would have been flagged: the helper is what keeps them out of source", () => {
    for (const kind of KINDS) {
      const asLiteral = `const apiKey = "${fakeSecret(kind)}"; // token`;
      expect(scanText("tests/example.test.ts", asLiteral, rule).findings, kind).toHaveLength(1);
    }
  });
});
