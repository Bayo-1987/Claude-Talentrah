/**
 * The role-family classifier (A2's input): which families a job title belongs to, and which families sit next to which.
 *
 * It is MULTI-LABEL: a title can carry several families ("Technical Support Consultant, Networking" is it_infra AND customer).
 * The 40 titles below are real production titles from the 40-title run that found the misclassifications before A2 was built,
 * kept UNGROUPED and PINNED: one row per title with its expected families, so any future keyword change shows up as a test diff
 * and a reviewer can see exactly which titles it moved. The rows marked (fixed) are the ones the run showed to be wrong and the
 * owner approved correcting (2026-10-02).
 *
 * The module does not exist when this file is first committed, so it is loaded at runtime (loadModule).
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

type Family =
  | "education"
  | "qa"
  | "it_infra"
  | "marketing"
  | "product"
  | "program"
  | "design"
  | "data"
  | "engineering"
  | "physical_engineering"
  | "sales"
  | "customer"
  | "finance"
  | "hr"
  | "legal"
  | "operations"
  | "research_ngo";
interface RoleFamilyModule {
  classifyRoleFamilies(title: string): Family[];
  ROLE_FAMILIES: Family[];
  areAdjacent(a: Family, b: Family): boolean;
  ADJACENCY: Array<[Family, Family]>;
}
const load = () => loadModule<RoleFamilyModule>("@/lib/matching/role-family");
const fams = async (title: string) => (await load()).classifyRoleFamilies(title).slice().sort();

/** [title, expected families]. Not grouped; the order is the order of the production run. */
const FORTY: Array<[string, Family[]]> = [
  ["(English C1, remote) Technical Support Consultant, Networking", ["customer", "it_infra"]],
  ["Burundi Gender and Youth Inclusion Senior Specialist (Fixed-Term)", ["research_ngo"]],
  ["Client Project Manager / Refurbishment & Maintenance - Remote South Africa", ["program"]],
  ["Customer Success Manager", ["customer"]],
  ["Head of Brand & Product Marketing", ["marketing", "product"]], // (fixed) "product marketing" adds product
  ["Learning Experience Designer", ["education"]],
  ["Primary School Education Program Lead - SPARK Theresa Park - 2026", ["education", "program"]],
  ["Product Designer", ["design"]],
  ["Scrum Master", ["program"]],
  ["Senior Business Analyst", ["data", "product"]], // (fixed) "business analyst" is product and data
  ["Senior Data Analyst - Fraud", ["data"]],
  ["Senior Learning Experience Designer", ["education"]],
  ["Senior Programme Manager", ["program"]],
  ["Technical Product Manager - DevEx", ["engineering", "product"]],
  ["2 X Sales Intern - 12 Months Fixed Term Contract Pinetown KZN", ["sales"]],
  ["Agent Liquidity Regional Lead", ["operations"]],
  ["Agent Operations Territory Lead", ["operations"]],
  ["Associate Consultant", []],
  ["Business Relationship Manager (Ogun)", ["customer", "sales"]], // (fixed) customer and sales
  ["Chief Academics and Innovation Officer", ["education"]],
  ["E-Payment Settlement Officer", ["finance"]], // (fixed) "settlement" is finance
  ["First Line Support Consultant - Cape Town, South Africa", ["customer"]],
  ["Founding Product Lead", ["product"]],
  ["Global CRM & Lifecycle Marketing Manager", ["marketing"]],
  ["Head, Business Kenya", []],
  ["Key Account Manager (Appliances) -Jumia (Full Time", ["sales"]],
  ["Kitchen Steward", []],
  ["Lifecycle Marketing Manager", ["marketing"]],
  ["Managing Director - Travel & Tours Operations (Abuja)", ["operations"]],
  ["Offline Customer Support Officer (Abuja)", ["customer"]],
  ["Regional Facilities Manager, North Central", ["operations"]], // (fixed) "facilities" is operations
  ["Senior Compensation Analyst", ["finance", "hr"]], // (fixed) bare "analyst" is not data; "compensation" is hr and finance
  ["Senior Mobile Engineer", ["engineering"]],
  ["Senior Recruiter, Expansion", ["hr"]],
  ["Southern Africa Luxury Safari Specialist", []],
  ["Staff Product Designer", ["design"]],
  ["Talent Acquisition Specialist - Jumia (Full Time)", ["hr"]],
  ["Technical Warehouse Assistant", ["operations"]], // (fixed) "warehouse" is operations
  ["Tupande Contract Management Specialists & Senior Specialist", ["legal", "operations"]], // (fixed) "contract management"
  ["Tupande Mechanical Maintenance Engineer / Specialist (Fixed-Term)", ["physical_engineering"]], // (fixed) physical, not software, engineering
];

describe("the 40 real titles, ungrouped: expected families", () => {
  it("is exactly 40 titles, each once (the table is not quietly shortened)", () => {
    expect(FORTY).toHaveLength(40);
    expect(new Set(FORTY.map(([t]) => t)).size).toBe(40);
  });

  for (const [title, expected] of FORTY) {
    it(`${title}  ->  ${expected.length ? expected.join(" + ") : "(unclassified)"}`, async () => {
      expect(await fams(title)).toEqual(expected.slice().sort());
    });
  }
});

describe("each approved keyword fix, beyond the table", () => {
  const cases: Array<[string, Family[]]> = [
    // product marketing adds product
    ["Product Marketing Manager", ["marketing", "product"]],
    // business analyst is product and data; bare analyst is not data
    ["Business Analyst", ["data", "product"]],
    ["Analyst", []],
    ["Financial Analyst", ["finance"]],
    ["Operations Analyst", ["operations"]],
    ["Credit Analyst", ["finance"]],
    // data needs "data", "analytics" or "business intelligence"
    ["Data Analyst", ["data"]],
    ["Analytics Lead", ["data"]],
    ["Business Intelligence Analyst", ["data"]],
    // settlement is finance; compensation is hr and finance
    ["Settlement Officer", ["finance"]],
    ["Compensation and Benefits Manager", ["finance", "hr"]],
    // facilities and warehouse are operations; contract management is legal and operations
    ["Facilities Coordinator", ["operations"]],
    ["Warehouse Supervisor", ["operations"]],
    ["Contract Management Specialist", ["legal", "operations"]],
    // business relationship manager is customer and sales
    ["Business Relationship Manager", ["customer", "sales"]],
    // physical engineering is its own family and is not software engineering
    ["Mechanical Engineer", ["physical_engineering"]],
    ["Civil Engineer", ["physical_engineering"]],
    ["Electrical Engineer", ["physical_engineering"]],
    ["Maintenance Engineer", ["physical_engineering"]],
    ["Software Engineer", ["engineering"]],
    ["Engineering Manager", ["engineering"]],
    ["Senior Data Engineer", ["data", "engineering"]],
    ["Mechanical Engineering Technician", ["physical_engineering"]],
    // a title that merely MENTIONS maintenance is not an engineer role
    ["Facilities Maintenance Supervisor", ["operations"]],
    // "automation" is left out of physical engineering: it is read in context
    ["Test Automation Engineer", ["engineering", "qa"]],
    ["Marketing Automation Specialist", ["marketing"]],
    ["Automation Engineer", ["engineering"]],
  ];
  for (const [title, expected] of cases) {
    it(`${title}  ->  ${expected.length ? expected.join(" + ") : "(unclassified)"}`, async () => {
      expect(await fams(title)).toEqual(expected.slice().sort());
    });
  }
});

describe("adjacency", () => {
  it("the families are exactly the sixteen from the design plus physical_engineering", async () => {
    const { ROLE_FAMILIES } = await load();
    expect(ROLE_FAMILIES.slice().sort()).toEqual(
      [
        "education", "qa", "it_infra", "marketing", "product", "program", "design", "data", "engineering",
        "physical_engineering", "sales", "customer", "finance", "hr", "legal", "operations", "research_ngo",
      ].sort(),
    );
  });

  it("is symmetric, and a family is not 'adjacent' to itself (equality is a separate, stronger match)", async () => {
    const { ADJACENCY, areAdjacent, ROLE_FAMILIES } = await load();
    expect(ADJACENCY.length).toBeGreaterThan(0);
    for (const [a, b] of ADJACENCY) {
      expect(areAdjacent(a, b), `${a}->${b}`).toBe(true);
      expect(areAdjacent(b, a), `${b}->${a}`).toBe(true);
    }
    for (const f of ROLE_FAMILIES) expect(areAdjacent(f, f)).toBe(false);
  });

  it("holds exactly the approved pairs", async () => {
    const { ADJACENCY } = await load();
    const key = (a: string, b: string) => [a, b].sort().join("~");
    expect(ADJACENCY.map(([a, b]) => key(a, b)).sort()).toEqual(
      [
        ["product", "program"], ["product", "design"], ["product", "data"], ["program", "operations"],
        ["engineering", "qa"], ["engineering", "it_infra"], ["engineering", "data"], ["qa", "it_infra"],
        ["sales", "marketing"], ["sales", "customer"], ["customer", "operations"],
        ["research_ngo", "program"], ["research_ngo", "data"],
      ]
        .map(([a, b]) => key(a, b))
        .sort(),
    );
  });

  it("physical engineering has NO adjacency to software engineering, qa, it_infra or data (or to anything else)", async () => {
    const { areAdjacent, ROLE_FAMILIES } = await load();
    for (const other of ROLE_FAMILIES) {
      expect(areAdjacent("physical_engineering", other), `physical_engineering~${other}`).toBe(false);
      expect(areAdjacent(other, "physical_engineering"), `${other}~physical_engineering`).toBe(false);
    }
  });

  it("product and marketing are deliberately NOT adjacent (so a marketing resume does not reach product roles by adjacency)", async () => {
    const { areAdjacent } = await load();
    expect(areAdjacent("product", "marketing")).toBe(false);
  });
});
