/**
 * NEW-APPLICANT-NOTICE-UX-1 (copy and layout only; wording approved by the owner 13 Oct). The strings are asserted LITERALLY, so any change to the approved words is a visible test change.
 *  1. the setting's label, the help line, the three plain option names and the help for the selected option render;
 *  2. the "Saved" message appears after a save and NOT before; a failed save shows "Couldn't save. Try again." and never Saved;
 *  3. each email carries its approved footer, with a link to /employer/jobs (text and html);
 *  4. the stored values are exactly instant | digest | off, unchanged.
 * No clock time or timezone anywhere ("each morning" only).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewApplicantNoticeView } from "@/components/employer/new-applicant-notice-select";
import { NOTICE_LABELS, NOTICE_MODES, NOTICE_OPTION_HELP } from "@/lib/employer/new-applicants/notice-mode";
import { buildDigestEmail, buildInstantEmail } from "@/lib/employer/new-applicants/emails";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const view = (over: Partial<Parameters<typeof NewApplicantNoticeView>[0]> = {}) =>
  renderToStaticMarkup(<NewApplicantNoticeView mode="instant" saved={false} error={null} pending={false} onChange={() => {}} {...over} />);

describe("1. the setting: label, help line, plain option names and the selected option's help", () => {
  it("shows the approved label, help line and option names, with the stored values on the options", () => {
    const html = view();
    expect(html).toContain("Emails about new applicants");
    expect(html).toContain("Choose how we tell you when people apply to your jobs.");
    expect(html).toContain('value="instant"');
    expect(html).toContain('value="digest"');
    expect(html).toContain('value="off"');
    expect(NOTICE_LABELS).toEqual({ instant: "Quick alert, then daily summary", digest: "Daily summary only", off: "No emails" });
    for (const m of NOTICE_MODES) expect(html).toContain(esc(NOTICE_LABELS[m]));
  });
  it("shows the approved help for whichever option is selected", () => {
    expect(NOTICE_OPTION_HELP).toEqual({
      instant: "One email when a job gets its first new applicant. After that, one summary each morning.",
      digest: "One email each morning listing new applicants.",
      off: "You'll still see applicants on your Applicants page.",
    });
    for (const m of NOTICE_MODES) {
      const html = view({ mode: m });
      expect(html).toContain(esc(NOTICE_OPTION_HELP[m]));
      for (const other of NOTICE_MODES.filter((x) => x !== m)) expect(html).not.toContain(esc(NOTICE_OPTION_HELP[other]));
    }
  });
  it("promises no clock time or timezone anywhere in the setting", () => {
    const all = [view(), ...NOTICE_MODES.map((m) => view({ mode: m }))].join(" ").replace(/<[^>]+>/g, " ");
    expect(all).not.toMatch(/\b\d{1,2}[:.]\d{2}\b|\b(UTC|GMT|WAT|am|pm)\b|\bseconds?\b|\bminutes?\b/i);
  });
  it("links the help lines to the control for assistive technology", () => {
    const html = view();
    expect(html).toMatch(/aria-describedby="new-applicant-notice-help new-applicant-notice-option-help"/);
    expect(html).toMatch(/id="new-applicant-notice-help"/);
    expect(html).toMatch(/id="new-applicant-notice-option-help"/);
  });
});

describe("2. the Saved message", () => {
  it("is absent until a save has gone through", () => {
    expect(view({ saved: false })).not.toContain("Saved");
  });
  it("appears, as a status the screen reader announces, after a save", () => {
    expect(view({ saved: true })).toMatch(/role="status"[^>]*>Saved</);
  });
  it("a failed save shows the approved sentence as an alert and never 'Saved'", async () => {
    const { NOTICE_SAVE_FAILED } = await import("@/lib/employer/new-applicants/notice-mode");
    expect(NOTICE_SAVE_FAILED).toBe("Couldn't save. Try again.");
    const html = view({ saved: false, error: NOTICE_SAVE_FAILED });
    expect(html).toContain(esc("Couldn't save. Try again."));
    expect(html).toMatch(/role="alert"/);
    expect(html).not.toContain(">Saved<");
  });
  it("the Server Action returns that same sentence when the write fails, and keeps its other refusals", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "../../../src/lib/employer/new-applicant-notice-actions.ts"), "utf8");
    expect(src).toContain("return { ok: false, error: NOTICE_SAVE_FAILED };");
    expect(src).toContain('{ ok: false, error: "Choose instant, daily digest or off." }');
    expect(src).toContain('{ ok: false, error: "Sign in again to change this." }');
  });
});

describe("3. the approved footer in each email", () => {
  const instant = buildInstantEmail({ applicantName: "Joy Akindele", jobTitle: "Growth Marketer", applicantsUrl: "https://t.test/a", settingsUrl: "https://t.test/employer/jobs" });
  const group = { jobId: "j1", jobTitle: "Growth Marketer", count: 1, names: ["Joy Akindele"], applicantsUrl: "https://t.test/a" };
  const digest = buildDigestEmail({ groups: [group], settingsUrl: "https://t.test/employer/jobs" });

  it("the instant email: 'You get a quick alert for the first new applicant on each job, then a daily summary.' + the link", () => {
    expect(instant.text).toContain("You get a quick alert for the first new applicant on each job, then a daily summary. Change this in your jobs settings: https://t.test/employer/jobs");
    expect(instant.html).toContain('You get a quick alert for the first new applicant on each job, then a daily summary. <a href="https://t.test/employer/jobs">Change this in your jobs settings</a>');
  });
  it("the digest email: 'The daily summary lists names and counts, never contact details.' + the link", () => {
    expect(digest.text).toContain("The daily summary lists names and counts, never contact details. Change how often we email you: https://t.test/employer/jobs");
    expect(digest.html).toContain('The daily summary lists names and counts, never contact details. <a href="https://t.test/employer/jobs">Change how often we email you</a>');
  });
  it("both links go to /employer/jobs when built by the senders", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["instant.ts", "digest.ts"]) {
      const src = readFileSync(join(__dirname, "../../../src/lib/employer/new-applicants", f), "utf8");
      expect(src, f).toContain('settingsUrl: absoluteUrl("/employer/jobs")');
    }
  });
  it("no clock time or timezone in either footer, and subjects are untouched", () => {
    for (const e of [instant, digest]) expect(`${e.text} ${e.html}`).not.toMatch(/\b\d{1,2}[:.]\d{2}\b|\bUTC\b/);
    expect(instant.subject).toBe("New applicant for Growth Marketer");
    expect(digest.subject).toBe("1 new applicant on Talentrah");
  });
});

describe("4. nothing stored changes", () => {
  it("the stored values are exactly instant, digest and off, in that order", () => {
    expect([...NOTICE_MODES]).toEqual(["instant", "digest", "off"]);
  });
});
