/**
 * S12 (h) — the job page <title>: "<Role> at <Company> — <City or Remote> | Talentrah", at most 65 characters.
 *
 * Measured on production (S12 audit): the old "<Role> — <Company> — Talentrah" put the same string on every posting of
 * one role at one company, whatever the city, and ran long enough for Google to cut it mid-company. The place makes the
 * per-city postings of one role distinct; the length rule (65) drops the "| Talentrah" suffix FIRST, then " at <Company>"
 * (NOT the role: the company is what every sibling shares, the role and place are what tell them apart), then shortens the
 * role with an ellipsis, and only then the place.
 */
import { describe, expect, it } from "vitest";
import { buildJobPageTitle, JOB_TITLE_MAX } from "@/lib/seo/job-page-title";

const job = (over: Partial<Parameters<typeof buildJobPageTitle>[0]> = {}) => ({
  title: "Backend Engineer",
  company_name: "Zaria Digital",
  location: "Lagos, Lagos, Nigeria",
  work_type: "onsite" as string | null,
  ...over,
});

describe("the shape", () => {
  it.each([
    [job(), "Backend Engineer at Zaria Digital — Lagos | Talentrah"],
    [job({ location: "Remote", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote | Talentrah"],
    [job({ location: "Remote, Nigeria", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote, Nigeria | Talentrah"],
    [job({ location: "Remote, Lagos, Nigeria", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote, Nigeria | Talentrah"],
    [job({ location: "Remote, South Africa; Remote, Kenya", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote | Talentrah"],
    [job({ location: "Cameroon (CM)" }), "Backend Engineer at Zaria Digital — Cameroon | Talentrah"],
    [job({ location: "City, Country", work_type: null }), "Backend Engineer at Zaria Digital | Talentrah"],
    [job({ location: "Program Country", work_type: null }), "Backend Engineer at Zaria Digital | Talentrah"],
    [job({ location: "Cape Town, Western Cape, South Africa", work_type: "hybrid" }), "Backend Engineer at Zaria Digital — Cape Town | Talentrah"],
    [job({ location: "Lagos, Nigeria; Abuja, Nigeria" }), "Backend Engineer at Zaria Digital — Lagos | Talentrah"],
    [job({ location: "Ghana" }), "Backend Engineer at Zaria Digital — Ghana | Talentrah"],
  ])("%j", (input, want) => {
    expect(buildJobPageTitle(input)).toBe(want);
  });

  it("with no usable place the title simply has none, never a placeholder", () => {
    expect(buildJobPageTitle(job({ location: null, work_type: null }))).toBe("Backend Engineer at Zaria Digital | Talentrah");
    expect(buildJobPageTitle(job({ location: "  ", work_type: null }))).toBe("Backend Engineer at Zaria Digital | Talentrah");
  });

  it("an on-site role whose location is a bare city with no country still names the city", () => {
    expect(buildJobPageTitle(job({ location: "Lagos" }))).toBe("Backend Engineer at Zaria Digital — Lagos | Talentrah");
  });

  it("collapses ragged whitespace in the role and company", () => {
    expect(buildJobPageTitle(job({ title: "  Backend \n Engineer ", company_name: " Zaria   Digital " }))).toBe(
      "Backend Engineer at Zaria Digital — Lagos | Talentrah",
    );
  });
});

describe("the length rule", () => {
  it("is 65", () => {
    expect(JOB_TITLE_MAX).toBe(65);
  });

  it("keeps the suffix when everything fits, drops it first when it does not", () => {
    // 63 characters with the suffix: fits
    expect(buildJobPageTitle(job({ location: "Remote, Nigeria", work_type: "remote" }))).toBe("Backend Engineer at Zaria Digital — Remote, Nigeria | Talentrah");
    // 68 with it, 56 without
    const t = buildJobPageTitle(job({ title: "Senior Backend Engineer", company_name: "Zaria Digital Limited" }));
    expect(t).toBe("Senior Backend Engineer at Zaria Digital Limited — Lagos");
  });

  it("then drops ' at <Company>' before it touches the role", () => {
    const t = buildJobPageTitle(job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }));
    // "… at Moniepoint — Remote, South Africa" is 70; without the company it is 56
    expect(t).toBe("Head of Engineering, Supply Chain — Remote, South Africa");
  });

  it("then shortens the ROLE at a word boundary, keeping the place", () => {
    const t = buildJobPageTitle(
      job({ title: "Head of Engineering, Sales & Marketing Tools and Platform", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    );
    expect(t.length).toBeLessThanOrEqual(JOB_TITLE_MAX);
    expect(t.endsWith("… — Remote, South Africa")).toBe(true);
    expect(t.startsWith("Head of Engineering, Sales & Marketing")).toBe(true);
  });

  it("never cuts a word in half", () => {
    const t = buildJobPageTitle(job({ title: "Associate Director of Strategic Partnerships and Commercial Operations Excellence Programme", company_name: "Wave", location: "Remote, South Africa", work_type: "remote" }));
    const role = t.split("… —")[0]!;
    expect(role.split(" ").every((w) => /^(Associate|Director|of|Strategic|Partnerships|and|Commercial|Operations|Excellence|Programme)$/.test(w))).toBe(true);
  });

  it("is never longer than 65 for any title, however absurd", () => {
    const t = buildJobPageTitle(job({ title: "X".repeat(300), company_name: "Y".repeat(200), location: "Z".repeat(100) + ", Nigeria" }));
    expect(t.length).toBeLessThanOrEqual(JOB_TITLE_MAX);
    const u = buildJobPageTitle(job({ title: "Customer Success Manager", company_name: "A Very Long Company Name Holdings International Limited", location: "Lagos, Nigeria" }));
    expect(u.length).toBeLessThanOrEqual(JOB_TITLE_MAX);
  });
});

describe("uniqueness across a fixture set shaped like the live board", () => {
  // Taken from the live board's shapes (S12 audit): one employer posting the same role once per city, per applicant country,
  // and a family of roles sharing their first words. Every one must come out distinct and within 65.
  const rows = [
    job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Lagos, Nigeria" }),
    job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Abuja, Nigeria" }),
    job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Remote", work_type: "remote" }),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, Poland", work_type: "remote" }),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, Spain", work_type: "remote" }),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, Lagos, Nigeria", work_type: "remote" }),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, India; Remote, Nigeria; Remote, Poland", work_type: "remote" }),
    job({ title: "Head of Engineering, Sales & Marketing Tools", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Payment Gateway", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Field Verification", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Rewards", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Senior Software Engineer, Platform Infrastructure and Reliability", company_name: "Moniepoint", location: "Lagos, Nigeria" }),
    job({ title: "Senior Software Engineer, Platform Infrastructure and Reliability", company_name: "Moniepoint", location: "Nairobi, Kenya" }),
    job({ title: "Senior Data Engineer, Platform Security and Reliability", company_name: "Moniepoint", location: "Lagos, Nigeria" }),
    job({ title: "Client Project Manager / Refurbishment & Maintenance - Remote South Africa", company_name: "Optimal Group", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Finance Executive", company_name: "Optimal Group", location: "Johannesburg, Gauteng, South Africa" }),
    job({ title: "Finance Executive", company_name: "Optimal Group", location: "Cape Town, Western Cape, South Africa" }),
    job({ title: "Infrastructure Technician", company_name: "ikeja", location: "Philippi, Cape Town, Western Cape, South Africa" }),
    job({ title: "Business Relationship Manager (Imo)", company_name: "Moniepoint", location: "Imo, Nigeria" }),
    job({ title: "Business Relationship Manager (Ogun)", company_name: "Moniepoint", location: "Ogun, Nigeria" }),
    job({ title: "Field Officer", company_name: "Wave", location: "Cameroon (CM)" }),
    job({ title: "Field Officer", company_name: "Wave", location: "Niamey, Niger" }),
    job({ title: "Field Officer", company_name: "Wave", location: "Kinshasa, Democratic Republic of the Congo" }),
  ];

  it("every title is distinct and within 65", () => {
    const titles = rows.map(buildJobPageTitle);
    expect(new Set(titles).size, titles.join("\n")).toBe(rows.length);
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(JOB_TITLE_MAX);
  });
});

describe("the one limit, stated rather than hidden", () => {
  it("two long roles that differ only AFTER the point where the role must be cut, at one company in one place, can come out the same", () => {
    // Once the company is gone and the role is still too long, the role keeps its first ~40 characters. A difference later
    // than that is lost from the title (the H1, the description and the structured data keep it). Measured rare on the live board.
    const long = (tail: string) =>
      buildJobPageTitle(job({ title: `Senior Software Engineer, Platform Infrastructure and Site Reliability ${tail}`, company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }));
    expect(long("Lead")).toBe(long("Manager"));
  });
});
