import { describe, expect, it } from "vitest";
import { normalizeMessage } from "@/lib/employer/applicant-messages/normalize";
import { BODY_MAX, SUBJECT_MAX } from "@/lib/employer/applicant-messages/constants";

describe("normalizeMessage: what an employer may send (plain text, one-line subject)", () => {
  it("trims the subject and the body and keeps ordinary text as typed", () => {
    expect(normalizeMessage({ subject: "  Interview for Growth Marketer  ", body: "  Hi Joy,\n\nThanks.  " })).toEqual({
      ok: true,
      subject: "Interview for Growth Marketer",
      body: "Hi Joy,\n\nThanks.",
    });
  });

  it("a subject can never carry a line break (header injection): CR, LF and tabs become spaces", () => {
    const result = normalizeMessage({ subject: "Hello\r\nBcc: someone@example.com", body: "x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject).not.toMatch(/[\r\n]/);
      expect(result.subject).toBe("Hello Bcc: someone@example.com");
    }
  });

  it("strips control and bidirectional-override characters from both fields", () => {
    const result = normalizeMessage({ subject: "Hi\u0000‮ there", body: "Line\u0007 one⁦ hidden⁩" });
    expect(result).toEqual({ ok: true, subject: "Hi there", body: "Line one hidden" });
  });

  it("normalises Windows line endings and squeezes runs of blank lines to one blank line", () => {
    const result = normalizeMessage({ subject: "s", body: "a\r\n\r\n\r\n\r\nb" });
    expect(result).toEqual({ ok: true, subject: "s", body: "a\n\nb" });
  });

  it("refuses an empty subject or an empty body (whitespace only counts as empty)", () => {
    expect(normalizeMessage({ subject: "   ", body: "x" })).toMatchObject({ ok: false });
    expect(normalizeMessage({ subject: "s", body: " \n\t " })).toMatchObject({ ok: false });
  });

  it("refuses a subject over the limit and a body over the limit, accepts exactly the limit", () => {
    expect(normalizeMessage({ subject: "s".repeat(SUBJECT_MAX), body: "b".repeat(BODY_MAX) }).ok).toBe(true);
    expect(normalizeMessage({ subject: "s".repeat(SUBJECT_MAX + 1), body: "b" })).toMatchObject({ ok: false });
    expect(normalizeMessage({ subject: "s", body: "b".repeat(BODY_MAX + 1) })).toMatchObject({ ok: false });
  });

  it("never throws on odd input", () => {
    expect(normalizeMessage({ subject: undefined as unknown as string, body: null as unknown as string })).toMatchObject({ ok: false });
  });
});
