/**
 * generateOneTapNonce (src/lib/auth/one-tap-nonce.ts) — the pair Google One
 * Tap sign-in is built on: a raw nonce for Supabase's `signInWithIdToken`,
 * and SHA-256(raw) for Google's own script. Getting these two swapped, or
 * skipped, is the actual security bug this feature exists to avoid — see the
 * long comment on the module under test, and tests/auth/one-tap-client.test.ts
 * for the half of this that pins how the two values get USED.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateOneTapNonce } from "@/lib/auth/one-tap-nonce";

describe("generateOneTapNonce", () => {
  it("hashedNonce is exactly SHA-256(nonce), hex-encoded — not some other transform", () => {
    const { nonce, hashedNonce } = generateOneTapNonce();
    const expected = createHash("sha256").update(nonce).digest("hex");
    expect(hashedNonce).toBe(expected);
  });

  it("SABOTAGE-PROOF TARGET: the two halves are never equal — a caller that wires nonce where hashedNonce belongs (or vice versa) must fail obviously, not coincidentally pass", () => {
    const { nonce, hashedNonce } = generateOneTapNonce();
    expect(nonce).not.toBe(hashedNonce);
  });

  it("hashedNonce is a 64-character lowercase hex string (SHA-256 output)", () => {
    const { hashedNonce } = generateOneTapNonce();
    expect(hashedNonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the raw nonce carries real entropy — not a constant, not a short/guessable value", () => {
    const { nonce } = generateOneTapNonce();
    // randomBytes(32) is 32 bytes; base64url encodes that to 43 chars (no padding).
    expect(nonce.length).toBeGreaterThanOrEqual(40);
  });

  it("two calls never produce the same nonce or the same hash", () => {
    const a = generateOneTapNonce();
    const b = generateOneTapNonce();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.hashedNonce).not.toBe(b.hashedNonce);
  });
});
