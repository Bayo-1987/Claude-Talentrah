/**
 * S12 (h) — the job page <title>: "<Role> at <Company> — <City or Remote> | Talentrah", about 65 characters.
 *
 * THE POLICY (founder, 2026-10-01): the COMPANY IS NEVER DROPPED — "Product Manager at Moniepoint" is what people search
 * for — and length is cosmetic while duplicate titles are not. When the title is too long it is trimmed in this order:
 *   1. the " | Talentrah" suffix;
 *   2. the place is the city or "Remote" (never "Remote, Poland" by default);
 *   3. the ROLE, at a word boundary (an ellipsis follows a whole word, never half of one).
 * Past that the title is simply allowed to run long. Duplicates are then removed where they remain: a posting whose title
 * equals a sibling's (same company, same role, same short place — the per-applicant-country remote postings) gets the
 * country added, and ONLY those. Siblings are passed in by the caller (one query per page render).
 */
import { describe, expect, it } from "vitest";
import { buildJobPageTitle, JOB_TITLE_MAX, type JobTitleSource } from "@/lib/seo/job-page-title";

const job = (over: Partial<JobTitleSource> = {}): JobTitleSource => ({
  title: "Backend Engineer",
  company_name: "Zaria Digital",
  location: "Lagos, Lagos, Nigeria",
  work_type: "onsite",
  ...over,
});

describe("the shape", () => {
  it.each([
    [job(), "Backend Engineer at Zaria Digital — Lagos | Talentrah"],
    [job({ location: "Remote", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote | Talentrah"],
    // a remote role's place is "Remote" however many countries it names, until a sibling forces the country in
    [job({ location: "Remote, Nigeria", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote | Talentrah"],
    [job({ location: "Remote, Lagos, Nigeria", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote | Talentrah"],
    [job({ location: "Remote, South Africa; Remote, Kenya", work_type: "remote" }), "Backend Engineer at Zaria Digital — Remote | Talentrah"],
    [job({ location: "Cape Town, Western Cape, South Africa", work_type: "hybrid" }), "Backend Engineer at Zaria Digital — Cape Town | Talentrah"],
    [job({ location: "Lagos, Nigeria; Abuja, Nigeria" }), "Backend Engineer at Zaria Digital — Lagos | Talentrah"],
    [job({ location: "Ghana" }), "Backend Engineer at Zaria Digital — Ghana | Talentrah"],
    [job({ location: "Cameroon (CM)" }), "Backend Engineer at Zaria Digital — Cameroon | Talentrah"],
    [job({ location: "City, Country", work_type: null }), "Backend Engineer at Zaria Digital | Talentrah"],
    [job({ location: "Program Country", work_type: null }), "Backend Engineer at Zaria Digital | Talentrah"],
    [job({ location: null, work_type: null }), "Backend Engineer at Zaria Digital | Talentrah"],
    [job({ location: "Lagos" }), "Backend Engineer at Zaria Digital — Lagos | Talentrah"],
  ])("%j", (input, want) => {
    expect(buildJobPageTitle(input)).toBe(want);
  });

  it("collapses ragged whitespace in the role and company", () => {
    expect(buildJobPageTitle(job({ title: "  Backend \n Engineer ", company_name: " Zaria   Digital " }))).toBe(
      "Backend Engineer at Zaria Digital — Lagos | Talentrah",
    );
  });
});

describe("trimming, in the founder's order", () => {
  it("is about 65", () => {
    expect(JOB_TITLE_MAX).toBe(65);
  });

  it("1. drops the ' | Talentrah' suffix first", () => {
    // 68 characters with the suffix, 56 without
    expect(buildJobPageTitle(job({ title: "Senior Backend Engineer", company_name: "Zaria Digital Limited" }))).toBe(
      "Senior Backend Engineer at Zaria Digital Limited — Lagos",
    );
  });

  it("3. then shortens the ROLE at a word boundary, and the company and the place stay whole", () => {
    const t = buildJobPageTitle(
      job({ title: "Head of Engineering, Sales & Marketing Tools and Platform Reliability", company_name: "Moniepoint", location: "Remote", work_type: "remote" }),
    );
    expect(t.length).toBeLessThanOrEqual(JOB_TITLE_MAX);
    expect(t.endsWith("… at Moniepoint — Remote")).toBe(true);
    expect(t.startsWith("Head of Engineering, Sales & Marketing")).toBe(true);
  });

  it("never cuts a word in half", () => {
    const words = "Associate Director of Strategic Partnerships and Commercial Operations Excellence Programme Delivery".split(" ");
    const t = buildJobPageTitle(job({ title: words.join(" "), company_name: "Wave", location: "Dakar, Senegal" }));
    const role = t.split("… at")[0]!;
    for (const w of role.split(" ")) expect(words, w).toContain(w);
  });

  it("the COMPANY IS NEVER DROPPED, however long it or the role is", () => {
    const companies = ["Moniepoint", "International Institute of Tropical Agriculture(IITA)", "A Very Long Company Name Holdings International Limited Group", "Y".repeat(120)];
    const roles = ["Analyst", "Head of Engineering, Sales & Marketing Tools and Platform Reliability", "X ".repeat(60).trim()];
    for (const company_name of companies) {
      for (const title of roles) {
        for (const location of ["Lagos, Nigeria", "Remote, South Africa", "Nairobi, Nairobi County, Kenya", null]) {
          const t = buildJobPageTitle(job({ title, company_name, location, work_type: location?.startsWith("Remote") ? "remote" : "onsite" }));
          expect(t, `${title} | ${company_name} | ${location}`).toContain(` at ${company_name}`);
        }
      }
    }
  });

  it("a title is allowed to run past 65 rather than lose its company (length is cosmetic)", () => {
    const t = buildJobPageTitle(job({ title: "Customer Success Manager", company_name: "A Very Long Company Name Holdings International Limited Group", location: "Lagos, Nigeria" }));
    expect(t).toContain("A Very Long Company Name Holdings International Limited Group");
  });
});

describe("duplicates: the country is added to the colliding postings only", () => {
  const supply = (location: string, over: Partial<JobTitleSource> = {}) =>
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location, work_type: "remote", ...over });

  it("one posting per applicant country: each says its country, because each would otherwise be the same title", () => {
    const rows = [supply("Remote, Poland"), supply("Remote, Spain"), supply("Remote, South Africa"), supply("Remote, Lagos, Nigeria")];
    const titles = rows.map((r) => buildJobPageTitle(r, rows.filter((o) => o !== r)));
    expect(titles).toEqual([
      "Head of Engineering, Supply Chain at Moniepoint — Remote, Poland",
      "Head of Engineering, Supply Chain at Moniepoint — Remote, Spain",
      "Head of Engineering, Supply Chain at Moniepoint — Remote, South Africa",
      "Head of Engineering, Supply Chain at Moniepoint — Remote, Nigeria",
    ]);
  });

  it("a remote-typed posting whose location is a place, not 'Remote': its country is the last token (live: Reliance Health)", () => {
    const placed = job({ title: "Reliance Care Officer (Arabic Speaking)", company_name: "Reliance Health", location: "Lagos, Lagos, Nigeria", work_type: "remote" });
    const bare = job({ title: "Reliance Care Officer (Arabic Speaking)", company_name: "Reliance Health", location: "Remote", work_type: "remote" });
    const country = job({ title: "Sales Excellence Associate (Nigeria)", company_name: "Reliance Health", location: "Nigeria", work_type: "remote" });
    const bare2 = job({ title: "Sales Excellence Associate (Nigeria)", company_name: "Reliance Health", location: "Remote", work_type: "remote" });
    expect(buildJobPageTitle(placed, [bare])).toBe("Reliance Care Officer (Arabic Speaking) at Reliance Health — Remote, Nigeria");
    expect(buildJobPageTitle(bare, [placed])).toBe("Reliance Care Officer (Arabic Speaking) at Reliance Health — Remote");
    expect(buildJobPageTitle(country, [bare2])).toBe("Sales Excellence Associate (Nigeria) at Reliance Health — Remote, Nigeria");
    expect(buildJobPageTitle(bare2, [country])).toBe("Sales Excellence Associate (Nigeria) at Reliance Health — Remote");
  });

  it("a posting that collides with nothing keeps the short place", () => {
    const other = job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Lagos, Nigeria" });
    expect(buildJobPageTitle(supply("Remote, Poland"), [other])).toBe("Head of Engineering, Supply Chain at Moniepoint — Remote | Talentrah".replace(" | Talentrah", ""));
  });

  it("an on-site collision gets its country too (the same role in two cities of one name)", () => {
    const a = job({ title: "Field Officer", company_name: "Wave", location: "Kinshasa, Democratic Republic of the Congo" });
    const b = job({ title: "Field Officer", company_name: "Wave", location: "Kinshasa, Congo" });
    expect(buildJobPageTitle(a, [b])).toContain("Kinshasa, Democratic Republic of the Congo");
    expect(buildJobPageTitle(b, [a])).toContain("Kinshasa, Congo");
  });

  it("a different company's identical role is not a collision", () => {
    const other = job({ title: "Head of Engineering, Supply Chain", company_name: "Wave", location: "Remote, Poland", work_type: "remote" });
    expect(buildJobPageTitle(supply("Remote, Poland"), [other])).not.toContain("Remote, Poland");
  });

  it("two truly identical postings still come out the same: nothing a title can add (the supersession migration's job)", () => {
    const a = supply("Remote, Poland");
    const b = supply("Remote, Poland");
    expect(buildJobPageTitle(a, [b])).toBe(buildJobPageTitle(b, [a]));
  });
});

describe("the duplicate-title count on a fixture set shaped like the live board", () => {
  const rows: JobTitleSource[] = [
    job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Lagos, Nigeria" }),
    job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Abuja, Nigeria" }),
    job({ title: "Customer Success Associate", company_name: "Moniepoint", location: "Remote", work_type: "remote" }),
    ...["Poland", "Spain", "South Africa", "Kenya", "Pakistan", "Portugal", "India"].map((c) =>
      job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: `Remote, ${c}`, work_type: "remote" }),
    ),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, Lagos, Nigeria", work_type: "remote" }),
    job({ title: "Head of Engineering, Supply Chain", company_name: "Moniepoint", location: "Remote, India; Remote, Nigeria; Remote, Poland", work_type: "remote" }),
    job({ title: "Head of Engineering, Sales & Marketing Tools", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Sales & Marketing Tools", company_name: "Moniepoint", location: "Remote, Spain", work_type: "remote" }),
    job({ title: "Head of Engineering, Payment Gateway", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Field Verification", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Head of Engineering, Rewards", company_name: "Moniepoint", location: "Remote, South Africa", work_type: "remote" }),
    job({ title: "Senior Software Engineer, Platform Infrastructure and Reliability", company_name: "Moniepoint", location: "Lagos, Nigeria" }),
    job({ title: "Senior Software Engineer, Platform Infrastructure and Reliability", company_name: "Moniepoint", location: "Nairobi, Kenya" }),
    job({ title: "Senior Data Engineer, Platform Security and Reliability", company_name: "Moniepoint", location: "Lagos, Nigeria" }),
    job({ title: "Finance Executive", company_name: "Optimal Group", location: "Johannesburg, Gauteng, South Africa" }),
    job({ title: "Finance Executive", company_name: "Optimal Group", location: "Cape Town, Western Cape, South Africa" }),
    job({ title: "Infrastructure Technician", company_name: "ikeja", location: "Philippi, Cape Town, Western Cape, South Africa" }),
    job({ title: "Business Relationship Manager (Imo)", company_name: "Moniepoint", location: "Imo, Nigeria" }),
    job({ title: "Business Relationship Manager (Ogun)", company_name: "Moniepoint", location: "Ogun, Nigeria" }),
    job({ title: "Field Officer", company_name: "Wave", location: "Cameroon (CM)" }),
    job({ title: "Field Officer", company_name: "Wave", location: "Niamey, Niger" }),
    job({ title: "Field Officer", company_name: "Wave", location: "Kinshasa, Democratic Republic of the Congo" }),
  ];
  const titles = rows.map((r) => buildJobPageTitle(r, rows.filter((o) => o !== r && o.company_name === r.company_name)));

  it("has no duplicate titles", () => {
    const seen = new Map<string, number>();
    for (const t of titles) seen.set(t, (seen.get(t) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([t]) => t);
    expect(dupes).toEqual([]);
    expect(new Set(titles).size).toBe(rows.length);
  });

  it("every title keeps its company", () => {
    rows.forEach((r, i) => expect(titles[i], titles[i]).toContain(` at ${r.company_name}`));
  });

  it("the country appears only where a sibling would otherwise collide", () => {
    const withCountry = rows.filter((_, i) => /Remote, /.test(titles[i]!)).length;
    // the 7 per-country Supply Chain postings, the 'Remote, Lagos, Nigeria' one, and the two Sales & Marketing Tools ones
    // that differ only by country; nothing else
    expect(withCountry).toBe(10);
  });
});

describe("a shortened role cannot rebuild a collision", () => {
  it("two long roles that differ only after the cut point are separated by the unshortened form, once they collide", () => {
    const long = (tail: string) =>
      job({ title: `Senior Software Engineer, Platform Infrastructure and Site Reliability Engineering Operations ${tail}`, company_name: "Moniepoint", location: "Remote", work_type: "remote" });
    const a = long("Lead");
    const b = long("Manager");
    expect(buildJobPageTitle(a)).toBe(buildJobPageTitle(b)); // alone, each is cut at the same word
    const ta = buildJobPageTitle(a, [b]);
    const tb = buildJobPageTitle(b, [a]);
    expect(ta).not.toBe(tb);
    expect(ta).toContain("Operations Lead");
    expect(tb).toContain("Operations Manager");
  });
});
