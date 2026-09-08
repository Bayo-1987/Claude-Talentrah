/**
 * `webmailUrlFor` — a pure domain match, no database or network involved.
 *
 * `null` is the interesting return value here, not the exception: it is what
 * the check-email pages use to hide the webmail button rather than link
 * somewhere wrong, so every "should NOT resolve" case below is pinning a real
 * UI decision, not just documenting an edge case.
 */
import { describe, expect, it } from "vitest";
import { webmailUrlFor } from "@/lib/auth/email-provider";

describe("webmailUrlFor", () => {
  it.each([
    ["gmail.com", "amaka@gmail.com", "mail.google.com"],
    ["googlemail.com (Gmail alias)", "amaka@googlemail.com", "mail.google.com"],
    ["outlook.com", "amaka@outlook.com", "outlook.live.com"],
    ["hotmail.com", "amaka@hotmail.com", "outlook.live.com"],
    ["live.com", "amaka@live.com", "outlook.live.com"],
    ["yahoo.com", "amaka@yahoo.com", "mail.yahoo.com"],
    ["icloud.com", "amaka@icloud.com", "icloud.com"],
    ["me.com (iCloud alias)", "amaka@me.com", "icloud.com"],
  ])("resolves %s to its webmail URL", (_label, email, expectedHost) => {
    const url = webmailUrlFor(email);
    expect(url).not.toBeNull();
    expect(url).toContain(expectedHost);
  });

  it("is case-insensitive on the domain", () => {
    expect(webmailUrlFor("amaka@Gmail.COM")).toBe(webmailUrlFor("amaka@gmail.com"));
    expect(webmailUrlFor("amaka@GMAIL.com")).not.toBeNull();
  });

  it("returns null for a custom/company domain, including talentrah.com itself", () => {
    expect(webmailUrlFor("someone@talentrah.com")).toBeNull();
    expect(webmailUrlFor("hr@some-employer.co")).toBeNull();
  });

  it("returns null for an unknown consumer provider", () => {
    expect(webmailUrlFor("someone@protonmail.com")).toBeNull();
    expect(webmailUrlFor("someone@aol.com")).toBeNull();
  });

  it("returns null for a malformed email string rather than throwing", () => {
    expect(webmailUrlFor("not-an-email")).toBeNull();
    expect(webmailUrlFor("")).toBeNull();
    expect(webmailUrlFor("@gmail.com")).not.toBeNull(); // empty local part, real domain — still resolvable
    expect(webmailUrlFor("someone@")).toBeNull(); // domain missing entirely
  });
});
