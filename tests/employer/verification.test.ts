/**
 * Unit tests for the work-email-domain rule.
 *
 * Kept separate from the integration suite because this is the part with no
 * database in it: given an email and a claimed domain, does the rule say
 * verified or not. The integration suite then proves that answer is what
 * actually reaches `organizations.verified`, and that nothing else can.
 */
import { describe, expect, it } from "vitest";
import {
  emailDomain,
  evaluateDomainVerification,
  isConsumerEmailDomain,
  normalizeDomain,
  verificationMessage,
} from "@/lib/employer/verification";

describe("emailDomain", () => {
  it("takes everything after the last @, lowercased", () => {
    expect(emailDomain("Ada@Zaria-Digital.com")).toBe("zaria-digital.com");
  });

  it("returns null for junk rather than a half-parsed string", () => {
    for (const input of [null, undefined, "", "no-at-sign", "trailing@"]) {
      expect(emailDomain(input)).toBeNull();
    }
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["zariadigital.com", "zariadigital.com"],
    ["  ZariaDigital.COM  ", "zariadigital.com"],
    ["https://zariadigital.com", "zariadigital.com"],
    ["http://www.zariadigital.com/careers?ref=x", "zariadigital.com"],
    ["www.zariadigital.com", "zariadigital.com"],
    ["ada@zariadigital.com", "zariadigital.com"],
    ["zariadigital.com.", "zariadigital.com"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it("rejects things that are not domains", () => {
    // People type company NAMES into domain fields constantly. Accepting
    // "Zaria Digital" would store a domain no email can ever match, and the
    // employer would sit unverified with no idea why.
    for (const input of ["", "   ", "localhost", "Zaria Digital", "zariadigital", "a b.com"]) {
      expect(normalizeDomain(input)).toBeNull();
    }
  });
});

describe("isConsumerEmailDomain", () => {
  it("catches the providers anyone can sign up to", () => {
    for (const d of ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "proton.me"]) {
      expect(isConsumerEmailDomain(d)).toBe(true);
    }
  });

  it("does not catch company domains", () => {
    for (const d of ["zariadigital.com", "paystack.com", "moniepoint.com"]) {
      expect(isConsumerEmailDomain(d)).toBe(false);
    }
  });
});

describe("evaluateDomainVerification", () => {
  const confirmed = { userEmail: "ada@zariadigital.com", emailConfirmed: true };

  it("verifies when a confirmed work email matches the claimed domain", () => {
    const out = evaluateDomainVerification({ ...confirmed, claimedDomain: "zariadigital.com" });
    expect(out).toEqual({
      verified: true,
      domain: "zariadigital.com",
      reason: "verified_domain_match",
    });
  });

  it("verifies through a pasted URL, because that is what people type", () => {
    const out = evaluateDomainVerification({
      ...confirmed,
      claimedDomain: "https://www.zariadigital.com/",
    });
    expect(out.verified).toBe(true);
  });

  it("refuses a consumer domain even when it genuinely matches the user's email", () => {
    // The whole rule collapses without this: anyone could verify "gmail.com"
    // as their company and post under it.
    const out = evaluateDomainVerification({
      userEmail: "ada@gmail.com",
      emailConfirmed: true,
      claimedDomain: "gmail.com",
    });
    expect(out).toMatchObject({ verified: false, reason: "consumer_email_domain" });
  });

  it("refuses when the email is at a different domain", () => {
    const out = evaluateDomainVerification({
      userEmail: "ada@gmail.com",
      emailConfirmed: true,
      claimedDomain: "zariadigital.com",
    });
    expect(out).toMatchObject({ verified: false, reason: "domain_mismatch" });
  });

  it("refuses an unconfirmed email", () => {
    // An unconfirmed address proves nothing about who can receive mail there,
    // which is the only thing this check is measuring.
    const out = evaluateDomainVerification({
      userEmail: "ada@zariadigital.com",
      emailConfirmed: false,
      claimedDomain: "zariadigital.com",
    });
    expect(out).toMatchObject({ verified: false, reason: "email_unconfirmed" });
  });

  it("refuses with no domain given", () => {
    const out = evaluateDomainVerification({ ...confirmed, claimedDomain: "" });
    expect(out).toEqual({ verified: false, domain: null, reason: "no_domain_given" });
  });

  it("is case- and whitespace-insensitive on both sides", () => {
    const out = evaluateDomainVerification({
      userEmail: "  Ada@ZariaDigital.com ",
      emailConfirmed: true,
      claimedDomain: "  ZARIADIGITAL.COM  ",
    });
    expect(out.verified).toBe(true);
  });
});

describe("verificationMessage", () => {
  it("gives every outcome something the employer can act on", () => {
    const reasons = [
      "verified_domain_match",
      "no_domain_given",
      "consumer_email_domain",
      "domain_mismatch",
      "email_unconfirmed",
    ] as const;

    for (const reason of reasons) {
      const message = verificationMessage(
        { verified: reason === "verified_domain_match", domain: "zariadigital.com", reason },
        "ada@gmail.com",
      );
      expect(message.length, `${reason} needs a real message`).toBeGreaterThan(20);
      // "Unverified." with no next step is how a gate starts feeling arbitrary.
      if (reason !== "verified_domain_match") {
        expect(message, `${reason} should say what to do`).toMatch(
          /add|confirm|sign up|work email/i,
        );
      }
    }
  });
});
