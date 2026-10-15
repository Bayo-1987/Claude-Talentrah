import { describe, expect, it } from "vitest";
import { assessmentPrintTitle, resumePrintTitle } from "@/lib/resume-builder/print-title";

describe("the saved file's name for an assessment response", () => {
  it("is <First>-<Last>-Assessment, by the same rules as the resume's", () => {
    expect(assessmentPrintTitle("Ada Obi")).toBe("Ada-Obi-Assessment");
    expect(assessmentPrintTitle("Ada Chinwe Obi")).toBe("Ada-Obi-Assessment");
    expect(assessmentPrintTitle("Ada\tObi")).toBe("Ada-Obi-Assessment");
    expect(assessmentPrintTitle('A/da O:bi*')).toBe("Ada-Obi-Assessment");
    expect(assessmentPrintTitle("")).toBe("Assessment");
    expect(assessmentPrintTitle(undefined)).toBe("Assessment");
  });
  it("the resume's title is exactly what it was (the shared rules are unchanged)", () => {
    expect(resumePrintTitle("Ada Obi")).toBe("Ada-Obi-Resume");
    expect(resumePrintTitle("Ada Chinwe Obi")).toBe("Ada-Obi-Resume");
    expect(resumePrintTitle("Ada\tObi")).toBe("Ada-Obi-Resume");
    expect(resumePrintTitle("")).toBe("Resume");
    expect(resumePrintTitle(null)).toBe("Resume");
  });
});
