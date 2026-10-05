/**
 * The pending-signup cookie's value, and the masked address shown on the check-email page (S1-101). Pure functions: nothing here reads a cookie.
 * The cookie is the ONLY place the address travels between the signup form and the code page, so what it will and will not decode is the contract.
 */
import { describe, expect, it } from "vitest";
import {
  CODE_RESEND_COOLDOWN_SECONDS,
  SIGNUP_PENDING_COOKIE,
  SIGNUP_PENDING_MAX_AGE_SECONDS,
  cooldownSecondsLeft,
  decodeSignupPending,
  encodeSignupPending,
  maskEmail,
} from "@/lib/auth/signup-pending-codec";

describe("constants", () => {
  it("pins the cookie name and lifetimes", () => {
    expect(SIGNUP_PENDING_COOKIE).toBe("tr_signup_pending");
    expect(SIGNUP_PENDING_MAX_AGE_SECONDS).toBe(3600);
    expect(CODE_RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});

describe("encode / decode", () => {
  it("round-trips the address, the destination and the time the code was issued", () => {
    const p = { email: "Ada@Example.com", redirectTo: "/jobs?page=2", issuedAt: 1_760_000_000_000 };
    expect(decodeSignupPending(encodeSignupPending(p))).toEqual(p);
  });

  it("the encoded value is not readable as the address in the clear (it is a transport, not a secret)", () => {
    expect(encodeSignupPending({ email: "ada@example.com", redirectTo: "", issuedAt: 1 })).not.toContain("ada@example.com");
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["not base64url json", "%%%not-json%%%"],
    ["json of the wrong shape", Buffer.from(JSON.stringify({ e: 5, r: 1, t: "x" })).toString("base64url")],
    ["an address that is not an email", Buffer.from(JSON.stringify({ e: "nobody", r: "", t: 1 })).toString("base64url")],
    ["a non-finite issue time", Buffer.from(JSON.stringify({ e: "a@b.co", r: "", t: "soon" })).toString("base64url")],
    ["an absurdly long value", "A".repeat(5000)],
  ])("%s decodes to null, never throws", (_label, raw) => {
    expect(decodeSignupPending(raw as string | undefined)).toBeNull();
  });

  it("an unsafe destination is dropped to '' (the sign-in itself still works), never echoed", () => {
    const raw = Buffer.from(JSON.stringify({ e: "a@b.co", r: "https://evil.example/", t: 5 })).toString("base64url");
    expect(decodeSignupPending(raw)).toEqual({ email: "a@b.co", redirectTo: "", issuedAt: 5 });
    const raw2 = Buffer.from(JSON.stringify({ e: "a@b.co", r: "//evil.example", t: 5 })).toString("base64url");
    expect(decodeSignupPending(raw2)?.redirectTo).toBe("");
  });
});

describe("maskEmail", () => {
  it.each([
    ["john@example.com", "j••••@example.com"],
    ["a@example.com", "a••••@example.com"],
    ["Very.Long.Name@mail.company.co.uk", "V••••@mail.company.co.uk"],
  ])("%s -> %s (always four dots: the length of the name is not shown)", (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  it("never contains the rest of the local part", () => {
    expect(maskEmail("zebedee.longname@example.com")).not.toContain("ebedee");
  });
});

describe("cooldownSecondsLeft", () => {
  it("counts down from 60 and never goes below 0", () => {
    expect(cooldownSecondsLeft(1_000_000, 1_000_000)).toBe(60);
    expect(cooldownSecondsLeft(1_000_000, 1_000_000 + 59_001)).toBe(1);
    expect(cooldownSecondsLeft(1_000_000, 1_000_000 + 60_000)).toBe(0);
    expect(cooldownSecondsLeft(1_000_000, 1_000_000 + 999_999)).toBe(0);
  });

  it("a clock set in the future does not give a cooldown longer than 60 seconds", () => {
    expect(cooldownSecondsLeft(2_000_000, 1_000_000)).toBe(60);
  });
});
