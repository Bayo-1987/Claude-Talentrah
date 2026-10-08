/**
 * QA-EXCL: the one definition of "a QA account" (owner, 6-7 Oct 2026): an email containing "+qa-", or a name that starts with "QA ".
 *
 * Case rules are deliberate and pinned here: the email part is case-insensitive (mail addresses are), the NAME part is case-SENSITIVE, so a real
 * person called "Qa Hoang" or "Qasim" is never hidden from a list. A name that is exactly "QA" counts; "QAnon", "QA-Team" and "Qatar Airways" do not
 * (the prefix is "QA" followed by a space). The SQL twin (S3-21's public.is_qa_account) must use the same rule; the table below is its fixture list.
 */
import { describe, expect, it } from "vitest";
import { isQaAccount, isQaName, QA_EMAIL_MARKER } from "@/lib/profile/qa-account";

describe("isQaName: the name rule", () => {
  it.each(["QA Seeker", "QA Employer", "QA Mentor", "QA ", "  QA Seeker  ", "QA"])("%j is a QA name", (name) => {
    expect(isQaName(name)).toBe(true);
  });
  it.each(["Qa Hoang", "qa seeker", "Qasim", "QAnon", "QA-Team", "Qatar Airways", "Ada QA", "Aqa QA Seeker", "", "   ", null, undefined])(
    "%j is not a QA name",
    (name) => {
      expect(isQaName(name)).toBe(false);
    },
  );
});

describe("isQaName: trimming is SPACES ONLY, exactly as the SQL twin's btrim (S3-21's public.is_qa_account)", () => {
  it.each(["\tQA Seeker", "\nQA Seeker", "\u00a0QA Seeker", "QA\tSeeker", "QA\t", "QA\n", "\r\nQA Seeker", "\u2003QA Seeker"])(
    "%j is not a QA name (a tab, newline or no-break space is not trimmed)",
    (name) => {
      expect(isQaName(name)).toBe(false);
    },
  );
  it.each(["  QA Seeker", "QA Seeker  ", "   QA   ", "QA"])("%j is a QA name (spaces are trimmed)", (name) => {
    expect(isQaName(name)).toBe(true);
  });
  it("the same holds through isQaAccount's first/last/full-name paths", () => {
    expect(isQaAccount({ firstName: "\tQA", lastName: "Seeker" })).toBe(false);
    expect(isQaAccount({ firstName: "\t", lastName: "QA Seeker" })).toBe(false); // the full name is "\t QA Seeker": a leading tab
    expect(isQaAccount({ firstName: null, lastName: "\tQA Seeker" })).toBe(false); // no first name, so the full name IS the last name, with its leading tab
    expect(isQaAccount({ firstName: "  ", lastName: "QA Seeker" })).toBe(true); // spaces only: the full name trims to "QA Seeker"
    expect(isQaAccount({ displayName: "\u00a0QA Mentor" })).toBe(false);
    expect(isQaAccount({ leaderboardName: "QA Tester\t" })).toBe(true); // "QA Tester\t" still STARTS with "QA " (only the end differs)
  });
});

describe("isQaAccount: the account rule", () => {
  it("an email containing +qa- is a QA account, in any case", () => {
    expect(isQaAccount({ email: "hello+qa-seeker@talentrah.com" })).toBe(true);
    expect(isQaAccount({ email: "Hello+QA-Employer@Talentrah.com" })).toBe(true);
    expect(isQaAccount({ email: "someone+qa-1@gmail.com" })).toBe(true);
  });
  it("other plus-addresses and other 'qa' spellings are not", () => {
    for (const email of ["hello+qa@talentrah.com", "hello+qatest@talentrah.com", "hello+tag@talentrah.com", "qa-team@talentrah.com", "hello@talentrah.com", "a.qa-b@gmail.com"]) {
      expect(isQaAccount({ email }), email).toBe(false);
    }
  });
  it("the first name, the full visible name, the mentor display name and the leaderboard handle are each checked", () => {
    expect(isQaAccount({ firstName: "QA Seeker" })).toBe(true);
    expect(isQaAccount({ firstName: "QA", lastName: "Seeker" })).toBe(true); // stored as first "QA", last "Seeker": the full name "QA Seeker"
    expect(isQaAccount({ firstName: "QA", lastName: null })).toBe(true);
    expect(isQaAccount({ firstName: null, lastName: "QA Seeker" })).toBe(true); // no first name stored: the full visible name is the last name alone
    expect(isQaAccount({ firstName: "  ", lastName: "QA Seeker" })).toBe(true);
    expect(isQaAccount({ displayName: "QA Mentor" })).toBe(true);
    expect(isQaAccount({ leaderboardName: "QA Tester" })).toBe(true);
  });
  it("a real person is never a QA account, however similar", () => {
    expect(isQaAccount({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" })).toBe(false);
    expect(isQaAccount({ email: "qa.engineer@example.com", firstName: "Qasim", lastName: "Khan" })).toBe(false);
    expect(isQaAccount({ firstName: "Ada", lastName: "QA" })).toBe(false); // "QA" as a SURNAME is not a prefix
    expect(isQaAccount({ firstName: "Qa", lastName: "Hoang" })).toBe(false);
    expect(isQaAccount({})).toBe(false);
    expect(isQaAccount({ email: null, firstName: null, lastName: null, displayName: null })).toBe(false);
  });
  it("one marker constant is the source of the email rule (the SQL twin quotes the same string)", () => {
    expect(QA_EMAIL_MARKER).toBe("+qa-");
  });
});
