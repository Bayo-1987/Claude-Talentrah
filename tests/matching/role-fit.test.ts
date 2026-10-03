/**
 * A2 — the role-family check, as pure decisions (src/lib/matching/role-fit.ts), before it is wired into the scorer
 * (tests/matching/scorer-role-fit.test.ts).
 *
 * The module does not exist when this file is first committed, so it is loaded at runtime (loadModule).
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import type { RoleFamily } from "@/lib/matching/role-family";
import type { StructuredResume } from "@/lib/resume/types";

type Fit = "same" | "adjacent" | "different" | "unknown";
interface RoleFitModule {
  resumeRoleFamilies(resume: StructuredResume): RoleFamily[];
  roleFit(jobFamilies: RoleFamily[], resumeFamilies: RoleFamily[]): Fit;
  isBaselineTagScreenable(tag: string, jobFamilies: RoleFamily[]): boolean;
  BASELINE_TAGS: ReadonlySet<string>;
  ROLE_FIT_CAP: { different: number; unknown: number };
  capForRoleFit(score: number, fit: Fit): number;
}
const load = () => loadModule<RoleFitModule>("@/lib/matching/role-fit");

const resumeWith = (...titles: string[]): StructuredResume =>
  ({
    contact: {},
    experience: titles.map((title) => ({ title, company: "Co", startDate: "2020", endDate: "2024", description: "" })),
    education: [],
    skills: [],
    projects: [],
    certifications: [],
  }) as unknown as StructuredResume;

describe("resumeRoleFamilies — the union of the families of every experience title", () => {
  it("a product manager resume is product", async () => {
    const { resumeRoleFamilies } = await load();
    expect(resumeRoleFamilies(resumeWith("Product Manager"))).toEqual(["product"]);
  });

  it("several roles contribute every family they carry, once", async () => {
    const { resumeRoleFamilies } = await load();
    expect(resumeRoleFamilies(resumeWith("Product Manager", "Senior Product Manager", "Business Analyst")).slice().sort()).toEqual([
      "data",
      "product",
    ]);
  });

  it("no experience, or titles that classify as nothing, is no family (the resume is unclassified)", async () => {
    const { resumeRoleFamilies } = await load();
    expect(resumeRoleFamilies(resumeWith())).toEqual([]);
    expect(resumeRoleFamilies(resumeWith("Associate Consultant"))).toEqual([]);
    expect(resumeRoleFamilies({ contact: {}, education: [], skills: [], projects: [], certifications: [] } as unknown as StructuredResume)).toEqual([]);
  });
});

describe("roleFit — same, adjacent, different, or unknown", () => {
  it("same: any job family is any resume family", async () => {
    const { roleFit } = await load();
    expect(roleFit(["product", "engineering"], ["product"])).toBe("same");
  });

  it("adjacent: no shared family, but one job family sits next to one resume family", async () => {
    const { roleFit } = await load();
    expect(roleFit(["program"], ["product"])).toBe("adjacent");
    expect(roleFit(["design"], ["product"])).toBe("adjacent");
  });

  it("different: both classify and nothing is the same or adjacent (a product resume against a research/NGO job)", async () => {
    const { roleFit } = await load();
    expect(roleFit(["research_ngo"], ["product"])).toBe("different");
    expect(roleFit(["physical_engineering"], ["engineering", "qa", "it_infra", "data"])).toBe("different");
    expect(roleFit(["sales"], ["engineering"])).toBe("different");
  });

  it("unknown when either side is unclassified", async () => {
    const { roleFit } = await load();
    expect(roleFit([], ["product"])).toBe("unknown");
    expect(roleFit(["product"], [])).toBe("unknown");
    expect(roleFit([], [])).toBe("unknown");
  });

  it("adjacency is one hop only: product reaches program, but not research_ngo through program", async () => {
    const { roleFit } = await load();
    expect(roleFit(["research_ngo"], ["product"])).toBe("different");
  });
});

describe("the caps", () => {
  it("a different family caps at 59 (below the 60 display floor); an unknown one at 79 (Good); same and adjacent are untouched", async () => {
    const { capForRoleFit, ROLE_FIT_CAP } = await load();
    expect(ROLE_FIT_CAP).toEqual({ different: 59, unknown: 79 });
    expect(capForRoleFit(100, "different")).toBe(59);
    expect(capForRoleFit(100, "unknown")).toBe(79);
    expect(capForRoleFit(100, "same")).toBe(100);
    expect(capForRoleFit(92, "adjacent")).toBe(92);
  });

  it("a cap never RAISES a score", async () => {
    const { capForRoleFit } = await load();
    expect(capForRoleFit(40, "different")).toBe(40);
    expect(capForRoleFit(70, "unknown")).toBe(70);
  });
});

describe("baseline tags are screenable only in the families they are core for", () => {
  it("project management, agile, scrum and stakeholder management are core for program and product", async () => {
    const { isBaselineTagScreenable } = await load();
    for (const tag of ["project management", "agile", "scrum", "stakeholder management"]) {
      expect(isBaselineTagScreenable(tag, ["program"]), `${tag}/program`).toBe(true);
      expect(isBaselineTagScreenable(tag, ["product"]), `${tag}/product`).toBe(true);
      expect(isBaselineTagScreenable(tag, ["marketing"]), `${tag}/marketing`).toBe(false);
      expect(isBaselineTagScreenable(tag, ["research_ngo"]), `${tag}/research_ngo`).toBe(false);
      expect(isBaselineTagScreenable(tag, []), `${tag}/unclassified`).toBe(false);
    }
  });

  it("engineering does NOT make agile or scrum core", async () => {
    const { isBaselineTagScreenable } = await load();
    expect(isBaselineTagScreenable("agile", ["engineering"])).toBe(false);
    expect(isBaselineTagScreenable("scrum", ["engineering"])).toBe(false);
    // ... but a title that is engineering AND product still is (product makes it core).
    expect(isBaselineTagScreenable("agile", ["engineering", "product"])).toBe(true);
  });

  it("microsoft office and excel are core for operations only", async () => {
    const { isBaselineTagScreenable } = await load();
    for (const tag of ["microsoft office", "excel"]) {
      expect(isBaselineTagScreenable(tag, ["operations"])).toBe(true);
      expect(isBaselineTagScreenable(tag, ["product"])).toBe(false);
      expect(isBaselineTagScreenable(tag, ["finance"])).toBe(false);
      expect(isBaselineTagScreenable(tag, [])).toBe(false);
    }
  });

  it("any other tag is always screenable (this only gates the generic baseline tags)", async () => {
    const { isBaselineTagScreenable } = await load();
    expect(isBaselineTagScreenable("sql", [])).toBe(true);
    expect(isBaselineTagScreenable("python", ["marketing"])).toBe(true);
  });

  it("the baseline set is exactly the six named tags", async () => {
    const { BASELINE_TAGS } = await load();
    expect([...BASELINE_TAGS].sort()).toEqual(["agile", "excel", "microsoft office", "project management", "scrum", "stakeholder management"]);
  });
});
