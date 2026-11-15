/**
 * FEED-PERF-2 F0: the fixed inputs of the scoring golden test. Resumes and jobs are written out (no randomness) so the fixture generated from the code as it was stays valid.
 * Every value is invented. The resumes cover the shapes expandResumeSkills has to survive: prose entries, separators, mixed case, duplicates, blanks, non-strings, an empty list,
 * a null list and a list that is missing altogether (a stored resume is an unvalidated blob).
 */
import { SKILL_VOCABULARY } from "@/lib/jobs/extract-jd";
import type { StructuredResume } from "@/lib/resume/types";

const base = (over: Record<string, unknown>) => ({ contact: {}, education: [], projects: [], certifications: [], experience: [{ title: "Software Engineer", company: "Acme", bullets: [] }], skills: [], ...over }) as unknown as StructuredResume;

export const GOLDEN_RESUMES: { name: string; resume: StructuredResume }[] = [
  { name: "prose entries", resume: base({ skills: ["SAFe Agile", "Cloud (AWS, Azure)", "Product (UI/ UX) Design", "React.js", "Node", "SQL", "Customer service"] }) },
  { name: "skills key missing", resume: base({ skills: undefined }) },
  { name: "skills null", resume: base({ skills: null }) },
  { name: "empty skills", resume: base({ skills: [] }) },
  { name: "duplicate and mixed-case skills", resume: base({ skills: ["Python", "python", "PYTHON", "  Python ", "SQL", "sql", "Sql", "Excel", "EXCEL"] }) },
  { name: "non-string entries", resume: base({ skills: ["Java", 7, null, { skill: "Go" }, undefined, ["Rust"], "Docker"] }) },
  { name: "separators", resume: base({ skills: ["Python/Django", "AWS; Azure | GCP", "HTML, CSS, JavaScript", "Machine Learning & Data Science"] }) },
  { name: "blank entries", resume: base({ skills: ["", "   ", "\t", "Sales", ""] }) },
  { name: "no experience", resume: base({ experience: undefined, skills: ["Accounting", "Excel", "Communication", "Leadership"] }) },
  { name: "executive title", resume: base({ experience: [{ title: "Chief Operating Officer", company: "Beta", bullets: [] }], skills: ["Project Management", "Operations", "Leadership", "Finance", "Agile"] }) },
];

const vocab = [...SKILL_VOCABULARY] as string[];
const slice = (from: number, n: number) => Array.from({ length: n }, (_, i) => vocab[(from + i) % vocab.length]);
const SENIORITIES = ["entry", "mid", "senior", "lead", "executive", undefined] as const;
const TITLES: Array<string | undefined> = [
  "Senior Software Engineer", "Frontend Developer", "Data Analyst", "Product Manager", "Customer Support Representative", "Sales Executive", "Accountant", "Financial Analyst",
  "HR Business Partner", "Marketing Manager", "UX Designer", "Project Manager", "Operations Lead", "Registered Nurse", "DevOps Engineer", "Administrative Assistant",
  "Head of Engineering", "Intern, Marketing", "Chief Operating Officer", undefined,
];

export type GoldenJob = { id: string; title: string | undefined; seniority: (typeof SENIORITIES)[number]; skills: string[] };

const SPECIAL: string[][] = [
  [], // no skills at all
  ["communication", "leadership", "operations"], // only non-screenable tags
  ["project management", "agile", "customer service"], // baseline tags
  ["AWS", "Agile", "SQL"], // mixed-case job skills
  ["python", "python", "sql", "sql", "excel"], // duplicates
];

export const GOLDEN_JOBS: GoldenJob[] = Array.from({ length: 50 }, (_, i) => ({
  id: `job-${String(i).padStart(3, "0")}`,
  title: TITLES[i % TITLES.length],
  seniority: SENIORITIES[i % SENIORITIES.length],
  skills: i < 10 ? SPECIAL[i % SPECIAL.length] : slice(i * 3, 2 + (i % 8)),
}));
