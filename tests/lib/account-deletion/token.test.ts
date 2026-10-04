/**
 * ACCT-1 PR 1 — the emailed confirm link's token.
 *
 * The token is the secret in an emailed link, so what the database keeps is only its sha256: a read of `account_deletions` cannot be turned into
 * a working link. These tests pin that split (the raw token is never what is stored or compared), the shape that makes a malformed value
 * cheap to refuse before it reaches the database, and the two numbers the owner decided: the link lives one hour, the restore window is 30 days.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DELETION_CONFIRM_PHRASE,
  DELETION_LINK_TTL_MINUTES,
  RESTORE_WINDOW_DAYS,
  confirmPhraseMatches,
  generateDeletionToken,
  hashDeletionToken,
  isWellFormedDeletionToken,
} from "@/lib/account-deletion/token";

describe("generateDeletionToken", () => {
  it("returns a 64-hex token and the sha256 of it, and the two differ", () => {
    const { token, hash } = generateDeletionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never repeats (256 bits from the system generator)", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateDeletionToken().token));
    expect(seen.size).toBe(200);
  });
});

describe("hashDeletionToken", () => {
  it("is deterministic and is exactly sha256 hex", () => {
    const t = "a".repeat(64);
    expect(hashDeletionToken(t)).toBe(hashDeletionToken(t));
    expect(hashDeletionToken(t)).toBe(createHash("sha256").update(t).digest("hex"));
  });
});

describe("isWellFormedDeletionToken", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(isWellFormedDeletionToken("0123456789abcdef".repeat(4))).toBe(true);
  });
  it.each([
    ["too short", "abc"],
    ["too long", "a".repeat(65)],
    ["uppercase", "A".repeat(64)],
    ["non-hex", "g".repeat(64)],
    ["with whitespace", " " + "a".repeat(63)],
    ["empty", ""],
  ])("rejects %s", (_name, v) => {
    expect(isWellFormedDeletionToken(v)).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isWellFormedDeletionToken(undefined)).toBe(false);
    expect(isWellFormedDeletionToken(null)).toBe(false);
    expect(isWellFormedDeletionToken(123)).toBe(false);
    expect(isWellFormedDeletionToken(["a".repeat(64)])).toBe(false);
  });
});

describe("the owner's numbers", () => {
  it("the confirm link lives one hour", () => {
    expect(DELETION_LINK_TTL_MINUTES).toBe(60);
  });
  it("the restore window is 30 days", () => {
    expect(RESTORE_WINDOW_DAYS).toBe(30);
  });
});

describe("the typed confirmation", () => {
  it("is the phrase the owner specified", () => {
    expect(DELETION_CONFIRM_PHRASE).toBe("delete my account");
  });
  it("matches the phrase, ignoring case and surrounding space", () => {
    expect(confirmPhraseMatches("delete my account")).toBe(true);
    expect(confirmPhraseMatches("  Delete My Account  ")).toBe(true);
  });
  it.each(["", "delete", "delete my  account", "delete my account please", "yes", "DELETE MY ACCOUNTS"])("refuses %j", (v) => {
    expect(confirmPhraseMatches(v)).toBe(false);
  });
  it("refuses non-strings", () => {
    expect(confirmPhraseMatches(null as unknown as string)).toBe(false);
  });
});
