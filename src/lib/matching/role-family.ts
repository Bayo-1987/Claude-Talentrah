/**
 * Role families: which kind of job a title is, as a MULTI-LABEL set, and which families sit next to which.
 *
 * This is A2's input (the family check that stops a product-manager resume reading as an "Excellent" match for a gender-and-youth
 * inclusion specialist because both name only generic skill tags). It decides nothing by itself: it classifies a title and says
 * which pairs of families are adjacent. The match scorer will build on it.
 *
 * WHY MULTI-LABEL. A title is often two things at once: "Technical Support Consultant, Networking" is it_infra AND customer,
 * "Head of Brand & Product Marketing" is marketing AND product. Forcing one label would make the check wrong in one direction or
 * the other, so each family is matched independently.
 *
 * WHAT IS PINNED. tests/matching/role-family.test.ts holds the 40 real production titles, ungrouped, with their expected
 * families, so a keyword change shows up as a test diff. The rules below carry the corrections that run found, each approved by the
 * owner on 2026-10-02:
 *   - "product marketing" adds product; "business analyst" is product AND data; a bare "analyst" is NOT data (data needs
 *     "data", "analytics" or "business intelligence");
 *   - "settlement" is finance; "compensation" is hr and finance;
 *   - "facilities" and "warehouse" are operations; "contract management" is legal and operations;
 *   - "business relationship manager" is customer and sales;
 *   - physical engineering (mechanical, civil, electrical, maintenance) is its own family, NOT software engineering, and has no
 *     adjacency to engineering, qa, it_infra or data. "Automation" is read in context ("test automation" is qa, "marketing
 *     automation" is marketing), not as a physical-engineering keyword. A title only counts as physical engineering when it is an
 *     engineer or technician role: "Refurbishment & Maintenance" in a project manager's title is not.
 */
export const ROLE_FAMILIES = [
  "education",
  "qa",
  "it_infra",
  "marketing",
  "product",
  "program",
  "design",
  "data",
  "engineering",
  "physical_engineering",
  "sales",
  "customer",
  "finance",
  "hr",
  "legal",
  "operations",
  "research_ngo",
] as const;

export type RoleFamily = (typeof ROLE_FAMILIES)[number];

const EDUCATION_PHRASES = /learning experience|instructional design/;
const PHYSICAL_KEYWORD = /\b(mechanical|civil|electrical|maintenance)\b/;
const ENGINEER_ROLE = /\b(engineer(s|ing)?|technician)\b/;

const RULES: Record<Exclude<RoleFamily, "design" | "engineering" | "physical_engineering">, RegExp> = {
  education: /learning experience|instructional design|curriculum|teacher|trainer|lecturer|instructor|tutor|education|academic|school/,
  qa: /\b(qa|sdet)\b|quality assurance|quality engineer|test engineer|\btester\b|test automation|engineer in test/,
  it_infra:
    /\bit (admin(istrators?)?|support|systems)\b|systems? admin|sysadmin|network(ing)? (engineer|admin)|networking|devops|site reliability|\bsre\b|help ?desk|desktop support|cloud (engineer|architect)|security engineer|database admin/,
  marketing: /marketing|\bseo\b|brand|growth|social media|copywriter|content|communications|community|public relations|campaign/,
  product:
    /product (manager|owner|lead|director|operations|analyst|management)|head of product|chief product|vp product|group product|product marketing|business analyst/,
  program: /program(me)? (manager|director|lead|coordinator)|project (manager|coordinator|lead)|scrum master|delivery manager|\bpmo\b|agile coach|release manager/,
  data: /\bdata\b|analytics|scientist|machine learning|\bml\b|\bbi\b|business intelligence|statistician|business analyst/,
  sales: /sales|account (executive|manager)|key account|business development|partnerships?|revenue|business relationship/,
  customer: /customer|client success|support (specialist|agent|representative|officer|consultant)|technical support|success manager|service desk|business relationship/,
  finance: /financ|account(ant|ing)|audit|\btax\b|treasur|payroll|bookkeep|controller|credit|risk|wire transfer|investor relations|compensation/,
  hr: /\bhr\b|human resources|recruit|talent|people (partner|operations|manager)|compensation/,
  legal: /legal|counsel|compliance|paralegal|contract management/,
  operations:
    /operations|operational|logistics|supply chain|procurement|office manager|administrat|implementation|liquidity|coordinator|facilities|warehouse|contract management/,
  research_ngo:
    /research|evaluation|\bm ?& ?e\b|\bmel\b|impact|policy|programme officer|program officer|inclusion|field (officer|agent)|agronom|extension|gender/,
};

/**
 * Rules that add families on context a single keyword cannot carry (owner-approved 2026-10-02). `unless` suppresses a rule when
 * the title also matches it.
 */
const IT_WORD = "(cloud|network(ing)?|it|devops|platform)";
export const EXTRA_RULES: Array<{ families: RoleFamily[]; pattern: RegExp; unless?: RegExp }> = [
  // "infrastructure" is IT only beside an IT word: "Civil Infrastructure Design Engineer" is not.
  {
    families: ["it_infra"],
    pattern: new RegExp(`\\b${IT_WORD}\\b.*\\binfrastructure\\b|\\binfrastructure\\b.*\\b${IT_WORD}\\b`),
  },
  // Sits between business requirements and IT systems.
  { families: ["it_infra", "product"], pattern: /\bsystems? analyst\b/ },
  // "database" counts as data and as it_infra, as a whole word (so "Database Administrator" and "Database Management" are both).
  { families: ["data", "it_infra"], pattern: /\bdatabases?\b/ },
  // These analyst roles are finance; a bare "analyst" and "strategy analyst" are not classified.
  { families: ["finance"], pattern: /\b(fraud|portfolio|investment)\b.*\banalyst\b/ },
  // Settlement is finance, except in a legal/conveyancing title, where it is a legal term.
  { families: ["finance"], pattern: /settlement/, unless: /legal|conveyanc/ },
  // AML and transaction monitoring are finance + legal (compliance), not research/M&E.
  { families: ["finance", "legal"], pattern: /\baml\b|transaction monitoring|anti-money/ },
];

const DESIGN = /\b(ux|ui)\b|ux\/ui|ui\/ux|designer|design lead|creative director|interaction designer/;
const SOFTWARE_ENGINEERING =
  /developer|programmer|software|full ?stack|backend|back-end|front ?end|mobile dev|technical lead|architect|android|\bios\b|technical product/;

/**
 * The patterns themselves, exposed so a one-off re-run against production titles can use the very same expressions in SQL (convert
 * `\b` to Postgres' `\y`) rather than a hand-copied second set. Not for runtime use: call classifyRoleFamilies.
 */
export const ROLE_FAMILY_PATTERNS = { ...RULES, design: DESIGN, softwareEngineering: SOFTWARE_ENGINEERING };

/** The families a title belongs to, in ROLE_FAMILIES order. Empty when nothing recognisable is in it (genuinely vague or out of scope). */
export function classifyRoleFamilies(title: string): RoleFamily[] {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  const found = new Set<RoleFamily>();

  for (const family of Object.keys(RULES) as Array<keyof typeof RULES>) {
    if (RULES[family].test(t)) found.add(family);
  }
  for (const rule of EXTRA_RULES) {
    if (rule.pattern.test(t) && !(rule.unless && rule.unless.test(t))) rule.families.forEach((f) => found.add(f));
  }
  if (DESIGN.test(t) && !EDUCATION_PHRASES.test(t)) found.add("design");

  const physical = PHYSICAL_KEYWORD.test(t) && ENGINEER_ROLE.test(t);
  if (physical) found.add("physical_engineering");
  // "engineer" alone is software engineering unless the title is a physical-engineering role.
  if (SOFTWARE_ENGINEERING.test(t) || (/\bengineer(s|ing)?\b/.test(t) && !physical)) found.add("engineering");

  return ROLE_FAMILIES.filter((f) => found.has(f));
}

/**
 * The adjacent pairs (symmetric). Adjacent means "close enough that a resume in one reads as plausibly relevant to a job in the
 * other"; equality is a separate, stronger match. physical_engineering appears in none of them, and product and marketing are
 * deliberately not adjacent.
 */
export const ADJACENCY: Array<[RoleFamily, RoleFamily]> = [
  ["product", "program"],
  ["product", "design"],
  ["product", "data"],
  ["program", "operations"],
  ["engineering", "qa"],
  ["engineering", "it_infra"],
  ["engineering", "data"],
  ["qa", "it_infra"],
  ["sales", "marketing"],
  ["sales", "customer"],
  ["customer", "operations"],
  ["research_ngo", "program"],
  ["research_ngo", "data"],
];

export function areAdjacent(a: RoleFamily, b: RoleFamily): boolean {
  return ADJACENCY.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
