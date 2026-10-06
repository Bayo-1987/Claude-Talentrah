/**
 * Owner request, 6 Oct 2026, rule 4: the "Real human mentors" section that follows Meet Farah now owns the moments ("negotiating an offer", "a final round") and the human-judgment point. Meet Farah used to say the same
 * thing in its second paragraph, so a visitor read it twice in a row. The smallest edit that removes the overlap: Meet Farah keeps ONE short sentence that Farah points to a human when a human is the better call, and loses the two
 * examples and the closing aphorism. Nothing else in the section changes.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MeetFarahSection } from "@/components/marketing/meet-farah-section";
import { MentorshipSection } from "@/components/marketing/mentorship-section";

const textOf = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Meet Farah and the mentor section do not say the same thing", () => {
  const farah = textOf(MeetFarahSection());
  const mentors = textOf(MentorshipSection());

  it("Meet Farah no longer carries the two example moments or the closing line", () => {
    expect(farah).not.toMatch(/negotiating a real offer/i);
    expect(farah).not.toMatch(/final-round interview/i);
    expect(farah).not.toMatch(/worth a human/i);
  });
  it("Meet Farah still tells the visitor that Farah points to a real mentor when a human is the better call", () => {
    expect(farah).toContain("When a human is the better call, Farah will tell you plainly and connect you with a real mentor.");
  });
  it("the first paragraph and the heading of Meet Farah are untouched", () => {
    expect(farah).toContain("Meet Farah.");
    expect(farah).toContain("Farah is the AI behind every match, tailored resume, and interview-prep session on Talentrah");
    expect(farah).toContain("tell you exactly what's missing before you apply.");
  });
  it("the moments now live in the mentor section only", () => {
    expect(mentors).toContain("Negotiating an offer or preparing for a final round");
  });
});
