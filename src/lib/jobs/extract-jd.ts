import type { StructuredJD, WorkType, SeniorityLevel } from "./types";

/** Small curated vocabulary — enough to drive M3's algorithmic match scoring
 * without needing an LLM call per job at ingestion time. Extend as needed. */
const SKILL_VOCABULARY = [
  "javascript",
  "typescript",
  "python",
  "java",
  "sql",
  "react",
  "node.js",
  "next.js",
  "aws",
  "gcp",
  "azure",
  "kubernetes",
  "docker",
  "graphql",
  "rest api",
  "product management",
  "agile",
  "scrum",
  "stakeholder management",
  "data analysis",
  "figma",
  "ui/ux",
  "sales",
  "business development",
  "customer success",
  "salesforce",
  "hubspot",
  "digital marketing",
  "seo",
  "content marketing",
  "financial modeling",
  "accounting",
  "compliance",
  "risk management",
  "recruiting",
  "hr",
  "payroll",
  "supply chain",
  "logistics",
  "operations",
  "project management",
  "leadership",
  "communication",
  "negotiation",
  "excel",
  "power bi",
  "tableau",
];

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Some ATS APIs (Greenhouse) return the description as HTML-entity-encoded
 * HTML — i.e. the tags themselves are escaped (`&lt;p&gt;`), not real markup
 * — so entities must be decoded before tags can be stripped, not after.
 */
export function stripHtml(html: string): string {
  const decoded = decodeHtmlEntities(html);
  return decoded
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractResponsibilities(plainText: string): string[] {
  return plainText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("• "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 10 && l.length < 200)
    .slice(0, 8);
}

export function extractStructuredJd(plainText: string): StructuredJD {
  const lower = plainText.toLowerCase();
  const skills = SKILL_VOCABULARY.filter((skill) =>
    new RegExp(`\\b${skill.replace(/[.+]/g, "\\$&")}\\b`, "i").test(lower),
  );

  return {
    skills,
    keywords: skills, // same vocabulary hit-list doubles as keywords for now
    responsibilities: extractResponsibilities(plainText),
  };
}

export function inferWorkType(title: string, location: string | undefined): WorkType | undefined {
  const text = `${title} ${location ?? ""}`.toLowerCase();
  if (text.includes("remote")) return "remote";
  if (text.includes("hybrid")) return "hybrid";
  return undefined;
}

export function inferSeniority(title: string): SeniorityLevel | undefined {
  const text = title.toLowerCase();
  if (/\b(chief|vp|vice president|executive|director)\b/.test(text)) return "executive";
  if (/\b(lead|principal|staff|head of)\b/.test(text)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(text)) return "senior";
  if (/\b(intern|internship|graduate|entry)\b/.test(text)) return "entry";
  if (/\b(junior|jr\.?)\b/.test(text)) return "entry";
  return "mid";
}
