/**
 * send-400 — regression test for `checkMentorDisplayName`
 * (src/lib/mentorship/name-validation.ts), pinning the exact two production
 * findings that motivated it (queried live from `nytwbbzfpytctjsoczzq`,
 * 2026-09-19):
 *
 *   email                          | first_name | last_name    | org on file
 *   -------------------------------|------------|--------------|----------------
 *   zimcresttechnologies@gmail.com | Zimcrest   | Technologies | Fatishcakes
 *   info@talentrah.com             | Info       | Talentrah    | Talentrah Portal
 *
 * "Zimcrest Technologies" is caught by the company-word check alone (its own
 * org name, "Fatishcakes", doesn't match at all — proving the org-name check
 * isn't the only thing standing between this bug and being caught again).
 * "Info Talentrah" is caught two ways independently: its own email domain
 * (talentrah.com) and its own org name (Talentrah Portal) both match.
 *
 * Pure function, no DB — this is the "prove the test catches the bug" half
 * of the fix; tests/lib/mentor-name-validation.test.ts is a false positive
 * check.
 */
import { describe, expect, it } from "vitest";
import { checkMentorDisplayName } from "@/lib/mentorship/name-validation";

describe("checkMentorDisplayName", () => {
  it("flags 'Zimcrest Technologies' via the company-word check, independent of its own (non-matching) org name", () => {
    const result = checkMentorDisplayName("Zimcrest Technologies", "zimcresttechnologies@gmail.com", [
      "Fatishcakes",
    ]);
    expect(result.suspicious, "REGRESSION: production's real bad mentor name was not flagged").toBe(true);
    expect(result.reason).toMatch(/company-style word/i);
  });

  it("flags 'Info Talentrah' via its own email domain matching the name", () => {
    const result = checkMentorDisplayName("Info Talentrah", "info@talentrah.com", []);
    expect(result.suspicious, "REGRESSION: production's real bad mentor name was not flagged").toBe(true);
    expect(result.reason).toMatch(/email domain/i);
  });

  it("flags 'Info Talentrah' via its own organisation name too, even ignoring the email", () => {
    const result = checkMentorDisplayName("Info Talentrah", "someone@example.com", ["Talentrah Portal"]);
    expect(result.suspicious).toBe(true);
    expect(result.reason).toMatch(/organisation name/i);
  });

  it("does not flag an ordinary personal name with an unrelated org and a public email provider", () => {
    const result = checkMentorDisplayName("Amara Chukwu", "amara.chukwu@gmail.com", ["Fatishcakes"]);
    expect(result.suspicious, "FALSE POSITIVE: an ordinary name was flagged").toBe(false);
    expect(result.reason).toBeNull();
  });

  it("does not flag a personal-domain email just because the local part matches the name (common, not suspicious)", () => {
    // firstname.lastname@gmail.com is the normal shape of a real signup —
    // this must never trip the check on its own.
    const result = checkMentorDisplayName("Chidi Okafor", "chidi.okafor@gmail.com", []);
    expect(result.suspicious).toBe(false);
  });

  it("does not flag when there is no name on file", () => {
    expect(checkMentorDisplayName("", "someone@example.com", []).suspicious).toBe(false);
  });

  it("is case-insensitive and ignores punctuation/whitespace differences for the org-name match", () => {
    const result = checkMentorDisplayName("talentrah portal", "someone@example.com", ["Talentrah Portal"]);
    expect(result.suspicious).toBe(true);
  });
});
