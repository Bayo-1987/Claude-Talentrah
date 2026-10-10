import { describe, expect, it } from "vitest";
import { buildTemplate } from "@/lib/employer/applicant-messages/templates";
import { MESSAGE_TEMPLATE_KINDS, BODY_MAX, SUBJECT_MAX } from "@/lib/employer/applicant-messages/constants";
import { normalizeMessage } from "@/lib/employer/applicant-messages/normalize";

const ctx = { candidateFirstName: "Joy", jobTitle: "Growth Marketer", orgName: "Zimcrest", senderFirstName: "Tolu" };

describe("buildTemplate: the three starting points an employer edits before sending", () => {
  it("each template greets the candidate by first name, names the job, and signs with the sender and organisation", () => {
    for (const kind of MESSAGE_TEMPLATE_KINDS) {
      const { subject, body } = buildTemplate(kind, ctx);
      expect(subject, kind).toContain("Growth Marketer");
      expect(body, kind).toMatch(/^Hi Joy,/);
      expect(body, kind).toContain("Tolu, Zimcrest");
    }
  });

  it("the interview invite asks for times and promises nothing (no date, no salary, no offer)", () => {
    const { body } = buildTemplate("invite_interview", ctx);
    expect(body).toMatch(/times that work/i);
    expect(body).not.toMatch(/salary|offer|\bhired\b|guarantee|₦|\$\d/i);
  });

  it("'Not moving forward' is a courteous close, with no reason invented for the candidate", () => {
    const { body } = buildTemplate("not_moving_forward", ctx);
    expect(body).toMatch(/not (be )?moving forward|won't be moving forward|decided not to/i);
    expect(body).not.toMatch(/because|reason|unfortunately your (skills|experience)/i);
  });

  it("every template passes the same validation the send does, even with a long job title and organisation name", () => {
    for (const kind of MESSAGE_TEMPLATE_KINDS) {
      const { subject, body } = buildTemplate(kind, { ...ctx, jobTitle: "J".repeat(120), orgName: "O".repeat(60) });
      expect(normalizeMessage({ subject, body }).ok, kind).toBe(true);
      expect(subject.length).toBeLessThanOrEqual(SUBJECT_MAX);
      expect(body.length).toBeLessThanOrEqual(BODY_MAX);
    }
  });

  it("falls back to a plain greeting when the candidate has no first name", () => {
    const { body } = buildTemplate("request_info", { ...ctx, candidateFirstName: null });
    expect(body).toMatch(/^Hi there,/);
  });
});
