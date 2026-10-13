import { describe, expect, it } from "vitest";
import { buildDigestEmail, buildInstantEmail } from "@/lib/employer/new-applicants/emails";

describe("buildInstantEmail: name, job and a link, nothing else", () => {
  const email = buildInstantEmail({ applicantName: "Joy Akindele", jobTitle: "Growth Marketer", applicantsUrl: "https://talentrah.test/employer/jobs/j1/applicants", settingsUrl: "https://talentrah.test/employer/jobs" });

  it("names the applicant and the job and links to the applicants page", () => {
    expect(email.subject).toBe("New applicant for Growth Marketer");
    expect(email.text).toContain("Joy Akindele applied for Growth Marketer.");
    expect(email.text).toContain("https://talentrah.test/employer/jobs/j1/applicants");
    expect(email.html).toContain('href="https://talentrah.test/employer/jobs/j1/applicants"');
  });

  it("says where to change how often these come, and carries no address, phone, score or resume", () => {
    expect(email.text).toContain("https://talentrah.test/employer/jobs");
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
      expect(part).not.toMatch(/\b(phone|resume|score|%)\b/i);
    }
  });

  it("escapes markup in a name or a title", () => {
    const e = buildInstantEmail({ applicantName: "<b>Joy</b>", jobTitle: "A & B <i>role</i>", applicantsUrl: "https://t.test/a", settingsUrl: "https://t.test/s" });
    expect(e.html).not.toContain("<b>Joy</b>");
    expect(e.html).not.toContain("<i>role</i>");
    expect(e.html).toContain("A &amp; B");
  });

  it("an applicant with no name is 'A new applicant'", () => {
    expect(buildInstantEmail({ applicantName: "", jobTitle: "J", applicantsUrl: "u", settingsUrl: "s" }).text).toContain("A new applicant applied for J.");
  });
});

describe("buildDigestEmail", () => {
  const group = (jobTitle: string, jobId: string, names: string[], count = names.length) => ({ jobTitle, jobId, names, count, applicantsUrl: `https://t.test/employer/jobs/${jobId}/applicants` });

  it("counts every applicant in the subject and lists each job with its names and a link", () => {
    const email = buildDigestEmail({ groups: [group("Growth Marketer", "j1", ["Joy A.", "Tunde B."]), group("Designer", "j2", ["Ada C."])], settingsUrl: "https://t.test/employer/jobs" });
    expect(email.subject).toBe("3 new applicants on Talentrah");
    expect(email.text).toContain("Growth Marketer: 2 new (Joy A., Tunde B.)");
    expect(email.text).toContain("Designer: 1 new (Ada C.)");
    expect(email.text).toContain("https://t.test/employer/jobs/j1/applicants");
    expect(email.text).toContain("https://t.test/employer/jobs/j2/applicants");
  });

  it("one applicant is singular", () => {
    expect(buildDigestEmail({ groups: [group("J", "j", ["A"])], settingsUrl: "s" }).subject).toBe("1 new applicant on Talentrah");
  });

  it("a long list is cut at 10 names with 'and N more'", () => {
    const names = Array.from({ length: 14 }, (_, i) => `P${i + 1}`);
    const email = buildDigestEmail({ groups: [group("J", "j", names, 14)], settingsUrl: "s" });
    expect(email.text).toContain("P10");
    expect(email.text).not.toContain("P11");
    expect(email.text).toContain("and 4 more");
  });

  it("carries no address, phone, score or resume", () => {
    const email = buildDigestEmail({ groups: [group("J", "j", ["Joy A."])], settingsUrl: "https://t.test/s" });
    for (const part of [email.subject, email.text, email.html]) expect(part).not.toMatch(/@[a-z0-9-]+\.[a-z]|\b(phone|resume|score)\b/i);
  });
});
