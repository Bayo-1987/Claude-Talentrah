import { describe, expect, it } from "vitest";
import { buildRelayEmail } from "@/lib/employer/applicant-messages/relay-email";

const base = { orgName: "Zimcrest", subject: "Interview for Growth Marketer at Zimcrest", body: "Hi Joy,\n\nWe'd like to talk.\n\nBest regards,\nTolu, Zimcrest" };

describe("buildRelayEmail: the candidate sees the employer's words and Talentrah's footer, and nothing else", () => {
  it("the text part is the body followed by the footer that says who sent it, where replies go and how to report it", () => {
    const { text, subject } = buildRelayEmail(base);
    expect(subject).toBe(base.subject);
    expect(text.startsWith(base.body)).toBe(true);
    expect(text).toContain("Sent by Talentrah on behalf of Zimcrest");
    expect(text).toContain("reply goes to them");
    expect(text).toMatch(/report|unwelcome/i);
  });

  it("the HTML part escapes markup from the employer: it is plain text, never HTML", () => {
    const { html } = buildRelayEmail({ ...base, body: "Hi <b>Joy</b> <script>alert(1)</script> & co" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Joy</b>");
    expect(html).toContain("&lt;b&gt;Joy&lt;/b&gt;");
    expect(html).toContain("&amp; co");
  });

  it("a link typed by the employer stays text: no anchor is made from the body", () => {
    const { html } = buildRelayEmail({ ...base, body: "See https://evil.example/login now" });
    expect(html).toContain("https://evil.example/login");
    expect(html).not.toMatch(/href="https:\/\/evil\.example/);
  });

  it("line breaks and paragraphs survive in the HTML part", () => {
    const { html } = buildRelayEmail(base);
    expect(html).toContain("<br");
    expect((html.match(/<p /g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("the organisation name is escaped where it appears in the footer", () => {
    const { html } = buildRelayEmail({ ...base, orgName: "Evil <i>Co</i>" });
    expect(html).not.toContain("<i>Co</i>");
  });
});
