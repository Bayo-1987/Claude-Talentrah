/**
 * The owner's decision 2 (6 Oct 2026): other people's data is NOT in the file. Only what the person gave us and what is about them is. Other parties are
 * reduced to a role or a first name, never contact details, and never an id that identifies them. A mentor's private notes about a mentee are the mentor's
 * own and stay out of the mentee's file; a mentee's contact details inside a mentor's own note stay out of the mentor's file.
 *
 * The fixture (tests/support/export-fixtures.ts) puts a distinct, searchable string for every such detail into the rows, and each test searches the WHOLE
 * downloaded text for them, so a leak under any key, in any table, fails.
 */
import { describe, expect, it } from "vitest";
import { maskContactDetails } from "@/lib/account-export/shape";
import {
  EMPLOYER,
  EMPLOYER_EMAIL,
  EMPLOYER_PHONE,
  MENTEE,
  MENTEE_EMAIL,
  MENTEE_PHONE,
  MENTOR,
  MENTOR_EMAIL,
  REFERRED,
  REVIEWER_NOTE,
  STAFF,
  STAFF_NOTE,
} from "../../support/export-fixtures";
import { runExport } from "../../support/run-export";

const mustNotAppear = (text: string, things: string[]) => {
  for (const t of things) expect(text, `the file contains ${t}`).not.toContain(t);
};

describe("a mentee's file", () => {
  it("has no mentor note, no mentor id, no mentor contact detail: the mentor is a role and a first name", async () => {
    const { text, file } = await runExport(MENTEE);
    mustNotAppear(text, [MENTOR, MENTOR_EMAIL, "Newer", "needs help with salary negotiation"]);
    const [session] = file.tables.mentorship_sessions;
    expect(session.mentor_role).toBe("the mentor");
    expect(session.mentor_first_name).toBe("Ada");
    expect(session.mentee_is_you).toBe(true);
    expect(session).not.toHaveProperty("mentor_notes");
    expect(session).not.toHaveProperty("mentor_id");
    expect(session.mentee_notes).toBe("I want to practise answers about my last role.");
  });

  it("does not include what the mentor earned from the session (the mentor's payout and the platform's commission)", async () => {
    const { file } = await runExport(MENTEE);
    const [session] = file.tables.mentorship_sessions;
    expect(session).not.toHaveProperty("mentor_payout_ngn");
    expect(session).not.toHaveProperty("platform_commission_ngn");
    expect(session.price_ngn).toBe(10000);
  });

  it("an employer's message to the person, with the employer's phone and email in it, is not in the file; the employer is a role", async () => {
    const { text, file } = await runExport(MENTEE);
    mustNotAppear(text, [EMPLOYER, EMPLOYER_EMAIL, EMPLOYER_PHONE, "Hi, call me on"]);
    const [request] = file.tables.talent_directory_contact_requests;
    expect(request.requested_by_role).toBe("an employer at the organisation");
    expect(request).not.toHaveProperty("message");
    expect(request).not.toHaveProperty("requested_by");
    expect(request.status).toBe("pending");
  });

  it("a reviewer's notes and payment, and a staff member's triage note and id, are not in the file", async () => {
    const { text, file } = await runExport(MENTEE);
    mustNotAppear(text, [STAFF, REVIEWER_NOTE, STAFF_NOTE]);
    const [verification] = file.tables.talent_verifications;
    expect(verification).not.toHaveProperty("reviewer_id");
    expect(verification).not.toHaveProperty("reviewer_notes");
    expect(verification).not.toHaveProperty("reviewer_payout_ngn");
    expect(verification.ai_feedback).toBe("Good structure.");
    expect(file.tables.feedback[0]).not.toHaveProperty("triage_note");
    expect(file.tables.feedback[0]).not.toHaveProperty("triaged_by");
  });

  it("a person they referred is a role, with no id and no name", async () => {
    const { text, file } = await runExport(MENTEE);
    mustNotAppear(text, [REFERRED]);
    const [referral] = file.tables.referrals;
    expect(referral.referrer_is_you).toBe(true);
    expect(referral.referred_user_role).toBe("the person who was referred");
    expect(referral).not.toHaveProperty("referred_user_first_name");
  });

  it("has the person's own email (their own contact detail) and nobody else's", async () => {
    const { text } = await runExport(MENTEE);
    expect(text).toContain(MENTEE_EMAIL);
    mustNotAppear(text, [MENTOR_EMAIL, EMPLOYER_EMAIL]);
  });
});

describe("a mentor's file", () => {
  it("has the mentor's own note, with the mentee's email address and phone number masked, and no mentee id or private note", async () => {
    const { text, file } = await runExport(MENTOR);
    mustNotAppear(text, [MENTEE, MENTEE_EMAIL, MENTEE_PHONE, "I want to practise answers"]);
    const [session] = file.tables.mentorship_sessions;
    expect(String(session.mentor_notes)).toContain("needs help with salary negotiation");
    expect(String(session.mentor_notes)).toContain("[email removed]");
    expect(String(session.mentor_notes)).toContain("[number removed]");
    expect(session).not.toHaveProperty("mentee_notes");
    expect(session).not.toHaveProperty("mentee_id");
    expect(session.mentee_role).toBe("the mentee");
    expect(session.mentee_first_name).toBe("Ngozi");
    expect(session.mentor_is_you).toBe(true);
  });

  it("has what the mentor earned from the session", async () => {
    const { file } = await runExport(MENTOR);
    const [session] = file.tables.mentorship_sessions;
    expect(session.mentor_payout_ngn).toBe(8500);
    expect(session.platform_commission_ngn).toBe(1500);
  });

  it("sees the review written about them as a role and a first name, with no reviewer id", async () => {
    const { text, file } = await runExport(MENTOR);
    mustNotAppear(text, [MENTEE]);
    const [review] = file.tables.mentorship_reviews;
    expect(review.reviewer_role).toBe("the mentee who wrote the review");
    expect(review.mentor_is_you).toBe(true);
    expect(review.review_text).toBe("Very helpful.");
  });

  it("the person who referred the mentor (a staff account in the fixture) is a role, not an id", async () => {
    const { text, file } = await runExport(MENTOR);
    mustNotAppear(text, [STAFF, STAFF_NOTE]);
    expect(file.tables.profiles[0].referred_by_role).toBe("the person who referred you");
    expect(file.tables.mentor_profiles[0]).not.toHaveProperty("review_note");
    expect(file.tables.mentor_profiles[0]).not.toHaveProperty("reviewed_by");
  });
});

describe("every query", () => {
  it("names its columns (never *) and filters on the person's id, except the first-name lookup of other parties", async () => {
    for (const user of [MENTEE, MENTOR]) {
      const { db } = await runExport(user);
      expect(db.queries.length).toBeGreaterThan(20);
      for (const q of db.queries) {
        expect(q.select, `${q.table} selects nothing or everything`).not.toMatch(/^\s*\*?\s*$/);
        if (q.table === "profiles" && q.filters.some((f) => f.startsWith("id in"))) continue; // first names only
        expect(q.filters.some((f) => f.includes(user)), `${q.table} is not filtered by the person: ${q.filters.join(" ")}`).toBe(true);
      }
      for (const q of db.queries.filter((x) => x.filters.some((f) => f.startsWith("id in")))) expect(q.select).toBe("id, first_name");
    }
  });

  it("never asks the database for a column the manifest does not export", async () => {
    const { db } = await runExport(MENTOR);
    const asked = db.queries.map((q) => `${q.table}: ${q.select}`).join("\n");
    for (const forbidden of ["payout_recipient_code", "payout_account_name", "authorization_code", "unsubscribe_token", "token_hash", "review_note", "reviewer_notes", "triage_note"]) {
      expect(asked, `a query asks for ${forbidden}`).not.toContain(forbidden);
    }
    // an employer's message to the person is not exported, while the person's own feedback message is
    expect(db.queries.find((q) => q.table === "talent_directory_contact_requests")!.select).not.toContain("message");
    expect(db.queries.find((q) => q.table === "feedback")!.select).toContain("message");
  });
});

describe("masking contact details in a person's own note", () => {
  it("removes email addresses, telephone numbers, @handles and links and keeps the words", () => {
    const masked = maskContactDetails("Call Ngozi on +234 803 000 1234 or 08030001234, mail ngozi@example.test, insta @ngozi_okafor, see https://linkedin.example/in/ngozi. Follow up Friday.");
    expect(masked).not.toMatch(/ngozi@|\+234|08030001234|@ngozi_okafor|linkedin/);
    expect(masked).toContain("Follow up Friday.");
    expect(masked).toContain("Call Ngozi on");
  });

  it("leaves ordinary numbers and dates alone", () => {
    expect(maskContactDetails("Session 3 of 5 on 2026-03-10, price 10000 naira")).toBe("Session 3 of 5 on 2026-03-10, price 10000 naira");
  });
});
