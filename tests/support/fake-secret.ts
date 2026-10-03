/**
 * Fake credentials for tests, assembled at run time so that no credential-shaped literal ever appears in source.
 *
 * WHY. The Secret scan (gitleaks, with this repo's `talentrah-hardcoded-credential` rule, mirrored by tests/ci/no-credential-shaped-identifiers.test.ts)
 * rejects a quoted literal of 8 or more characters assigned to a name containing secret, password, token, api key or credential, and the default
 * `generic-api-key` rule rejects a high-entropy one beside a keyword. Test fixtures keep tripping both for innocent reasons, and because the scan reads
 * COMMITS a rename in a later commit does not clear a finding in an earlier one: the only cure after the push is an allowlist entry. Generating the
 * value at run time makes the right way the easy way: nothing for a scanner to find, nothing to allowlist.
 *
 *   const key = fakeSecret("resendKey");
 *   vi.stubEnv("RESEND_API_KEY", key);
 *
 * Each call returns a FRESH value of the shape its consumer expects (tests/support/fake-secret.test.ts pins every shape). The prefixes are joined
 * from parts so even the prefix is not a literal; the random part comes from node:crypto. Never put a real credential in a test, and do not use these
 * where a test needs the SAME value across processes: a fixed value that must be reproducible belongs in a fixture file, not here.
 */
import { randomBytes } from "node:crypto";

export type FakeKind = "paystackSecret" | "resendKey" | "stripeShaped" | "token" | "password";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `length` characters drawn uniformly from `alphabet` (rejection sampling, so no modulo bias). */
function pick(length: number, alphabet: string): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const join = (...parts: string[]) => parts.join("_");

export function fakeSecret(kind: FakeKind): string {
  switch (kind) {
    // Paystack: a secret key is "sk_test_" or "sk_live_" and 40 hex characters. Always the test prefix here.
    case "paystackSecret":
      return join("sk", "test", hex(20));
    // Resend: "re_", an 8-character id, an underscore, then 24 characters.
    case "resendKey":
      return join("re", pick(8, ALNUM), pick(24, ALNUM));
    // Stripe-shaped: "sk_test_" and 24 base62 characters (the shape, not a real key: this project has no Stripe integration).
    case "stripeShaped":
      return join("sk", "test", pick(24, ALNUM));
    // A generic bearer token or shared secret: 32 hex characters.
    case "token":
      return hex(16);
    // A password sample that meets the app's own rule (8+ characters, upper, lower, digit) and then some, with a symbol.
    case "password":
      return `${pick(1, "ABCDEFGHJKLMNPQRSTUVWXYZ")}${pick(1, "abcdefghijkmnopqrstuvwxyz")}${pick(1, "23456789")}-${pick(20, ALNUM)}`;
  }
}
