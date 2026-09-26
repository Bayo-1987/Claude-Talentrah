/**
 * send-465's "you got hired" email template — pure, no I/O, matches this
 * repo's own convention for template functions (same shape as
 * proactive-match-alert-template.test.ts).
 *
 * `sendHiredMomentEmail` resolves job title/company from EITHER a real
 * `job_postings` row OR a manual tracker entry's `manual_job_snapshot` — see
 * that file's own header — but the template itself doesn't know or care
 * which path produced its `jobTitle`/`companyName` strings. So this file
 * proves both are correct, non-empty copy when given typical values for
 * either path, plus the two things a regression here is most likely to
 * break: the referral CTA link, and the mentorship CTA link.
 */
import { describe, expect, it } from "vitest";
import { buildHiredMomentEmail } from "@/lib/notifications/hired-moment/template";

describe("buildHiredMomentEmail", () => {
  it("produces correct, non-empty copy for a real-posting-derived job title/company", () => {
    const email = buildHiredMomentEmail({
      firstName: "Ada",
      jobTitle: "Senior Backend Engineer",
      companyName: "Verified Co",
      referralUrl: "https://talentrah.com/signup?ref=ADA123",
    });

    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.subject).toContain("Senior Backend Engineer");
    expect(email.text).toContain("Ada");
    expect(email.text).toContain("Senior Backend Engineer");
    expect(email.text).toContain("Verified Co");
    expect(email.html).toContain("Senior Backend Engineer");
    expect(email.html).toContain("Verified Co");
  });

  it("produces correct, non-empty copy for a manual-snapshot-derived job title/company", () => {
    // Exactly the shape addManualEntryAction writes for a manual tracker
    // entry: companyName/title with no underlying job_postings row at all.
    const email = buildHiredMomentEmail({
      firstName: null,
      jobTitle: "Chief Nobody",
      companyName: "Invented Ltd",
      referralUrl: "https://talentrah.com/signup?ref=XYZ789",
    });

    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.subject).toContain("Chief Nobody");
    expect(email.text).toContain("Chief Nobody");
    expect(email.text).toContain("Invented Ltd");
    expect(email.html).toContain("Chief Nobody");
    expect(email.html).toContain("Invented Ltd");
  });

  it("greets by first name when present, and falls back to a neutral greeting otherwise", () => {
    const withName = buildHiredMomentEmail({
      firstName: "Bo",
      jobTitle: "Analyst",
      companyName: "Acme",
      referralUrl: "https://talentrah.com/signup?ref=T1",
    });
    const withoutName = buildHiredMomentEmail({
      firstName: null,
      jobTitle: "Analyst",
      companyName: "Acme",
      referralUrl: "https://talentrah.com/signup?ref=T1",
    });

    expect(withName.text).toContain("Hi Bo,");
    expect(withoutName.text).toContain("Hi,");
    expect(withoutName.text).not.toContain("Hi null");
    expect(withoutName.text).not.toContain("Hi undefined");
  });

  it("carries the referral link through to both text and html", () => {
    const referralUrl = "https://talentrah.com/signup?ref=UNIQUECODE1";
    const email = buildHiredMomentEmail({
      firstName: "Ada",
      jobTitle: "Engineer",
      companyName: "Acme",
      referralUrl,
    });

    expect(email.text).toContain(referralUrl);
    expect(email.html).toContain(referralUrl);
  });

  it("includes a mentorship CTA link, distinct from the referral link", () => {
    const email = buildHiredMomentEmail({
      firstName: "Ada",
      jobTitle: "Engineer",
      companyName: "Acme",
      referralUrl: "https://talentrah.com/signup?ref=ADA1",
    });

    expect(email.text).toMatch(/\/mentorship\b/);
    expect(email.html).toMatch(/\/mentorship\b/);
  });

  it("does NOT reuse HiredReferralBanner's exact sentence verbatim (CLAUDE.md's own no-repeated-sentence rule)", () => {
    const email = buildHiredMomentEmail({
      firstName: "Ada",
      jobTitle: "Engineer",
      companyName: "Acme",
      referralUrl: "https://talentrah.com/signup?ref=ADA1",
    });

    const bannerSentence =
      "that's huge. If you know someone else job-hunting, this is the best time to send them your link — you'll both be glad you did.";
    expect(email.text).not.toContain(bannerSentence);
    expect(email.html).not.toContain(bannerSentence);
  });

  it("stays short: at most a handful of short paragraphs, not a report", () => {
    const email = buildHiredMomentEmail({
      firstName: "Ada",
      jobTitle: "Engineer",
      companyName: "Acme",
      referralUrl: "https://talentrah.com/signup?ref=ADA1",
    });

    // Blank-line-separated blocks in the plain-text version is a reasonable
    // proxy for "how many paragraphs" without coupling this test to the
    // exact HTML markup.
    const blocks = email.text.split("\n\n").filter((b) => b.trim().length > 0);
    expect(blocks.length).toBeLessThanOrEqual(5);
  });
});
