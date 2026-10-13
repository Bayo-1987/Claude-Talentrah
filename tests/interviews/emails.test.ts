import { describe, expect, it } from "vitest";
import { buildInvitationEmail, buildConfirmationEmail, buildCancellationEmail, buildNoneWorkEmail } from "@/lib/interviews/emails";

describe("buildInvitationEmail (to the candidate)", () => {
  const email = buildInvitationEmail({ orgName: "Zimcrest", jobTitle: "Growth Marketer", kind: "video", note: "Bring a laptop.", slotCount: 3, durationMinutes: 45, pickUrl: "https://t.test/interviews/o1" });

  it("says who invites them to what, how long, how many times are offered, and links to the signed-in page", () => {
    expect(email.subject).toBe("Zimcrest invited you to interview for Growth Marketer");
    expect(email.text).toContain("3 times");
    expect(email.text).toContain("45 minutes");
    expect(email.text).toContain("Video call");
    expect(email.text).toContain("Bring a laptop.");
    expect(email.text).toContain("https://t.test/interviews/o1");
    expect(email.html).toContain('href="https://t.test/interviews/o1"');
  });

  it("lists no times itself (they are shown on the page in the candidate's own zone) and no address", () => {
    expect(email.text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(email.text + email.html).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });

  it("escapes markup in the names and the note", () => {
    const e = buildInvitationEmail({ orgName: "<b>Z</b>", jobTitle: "J", kind: "phone", note: "<script>x</script>", slotCount: 2, durationMinutes: 30, pickUrl: "https://t.test/i" });
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>Z</b>");
  });
});

describe("buildConfirmationEmail", () => {
  const base = { whenText: "Mon, 26 Oct 2026, 10:00 to 10:45 GMT+1", utcText: "09:00 UTC", kind: "video" as const, note: null as string | null, pageUrl: "https://t.test/x" };

  it("tells the candidate the time and what is attached, naming the organisation and job", () => {
    const e = buildConfirmationEmail({ ...base, audience: "candidate", orgName: "Zimcrest", jobTitle: "Growth Marketer", otherName: "Zimcrest" });
    expect(e.subject).toBe("Interview confirmed: Growth Marketer at Zimcrest");
    expect(e.text).toContain("Mon, 26 Oct 2026, 10:00 to 10:45 GMT+1");
    expect(e.text).toContain("09:00 UTC");
    expect(e.text).toMatch(/calendar/i);
  });

  it("tells the employer which applicant booked", () => {
    const e = buildConfirmationEmail({ ...base, audience: "employer", orgName: "Zimcrest", jobTitle: "Growth Marketer", otherName: "Joy Akindele" });
    expect(e.text).toContain("Joy Akindele booked");
    expect(e.subject).toContain("Joy Akindele");
  });
});

describe("buildCancellationEmail (to the candidate, neutral)", () => {
  it("gives no reason and says nothing about fit or the decision", () => {
    const e = buildCancellationEmail({ orgName: "Zimcrest", jobTitle: "Growth Marketer", whenText: "Mon, 26 Oct 2026, 10:00 GMT+1" });
    expect(e.text).toContain("has been cancelled");
    expect(e.text).toContain("Zimcrest");
    expect(e.text + e.subject).not.toMatch(/fit|reject|unfortunately|decid|not moving|because|reason/i);
  });
});

describe("buildNoneWorkEmail (to the employer)", () => {
  it("says the candidate could not make any offered time and links to the schedule page", () => {
    const e = buildNoneWorkEmail({ candidateName: "Joy Akindele", jobTitle: "Growth Marketer", scheduleUrl: "https://t.test/s" });
    expect(e.subject).toContain("Joy Akindele");
    expect(e.text).toMatch(/none of the times|can't make any|could not make any/i);
    expect(e.text).toContain("https://t.test/s");
  });
});
