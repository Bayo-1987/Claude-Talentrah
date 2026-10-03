import { describe, expect, it } from "vitest";
import { buildExpiryReminderEmail } from "@/lib/jobs/expiry-reminders/template";

const base = {
  firstName: "Ada",
  title: "Senior <b>Backend</b> Engineer",
  closesAt: "2026-10-05T12:00:00.000Z",
  extendUrl: "https://talentrah.test/extend-posting/abc_DEF-123",
  jobsUrl: "https://talentrah.test/employer/jobs",
};

describe("the closing reminder email", () => {
  const email = buildExpiryReminderEmail(base);

  it("names the posting and the closing date in the app's date format", () => {
    expect(email.subject).toContain("Senior <b>Backend</b> Engineer");
    expect(email.text).toContain("Senior <b>Backend</b> Engineer");
    expect(email.text).toContain("5 Oct 2026");
    expect(email.html).toContain("5 Oct 2026");
  });

  it("has one big 'Extend 30 days' link in both parts", () => {
    expect(email.text).toContain(base.extendUrl);
    expect(email.html).toContain(`href="${base.extendUrl}"`);
    expect(email.html).toContain("Extend 30 days");
  });

  it("escapes the title in the HTML", () => {
    expect(email.html).not.toContain("<b>Backend</b>");
    expect(email.html).toContain("&lt;b&gt;Backend&lt;/b&gt;");
  });

  it("says what happens if nothing is done, and does not call it a CV", () => {
    expect(email.text.toLowerCase()).toMatch(/close/);
    expect(email.text).not.toMatch(/\bCV\b/);
  });
});
