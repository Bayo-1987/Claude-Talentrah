import type { StructuredResume } from "./types";

const SECTION_PATTERNS: Record<string, RegExp> = {
  summary: /^(summary|profile|objective|about)$/i,
  experience: /^(experience|work experience|employment|employment history)$/i,
  education: /^education$/i,
  skills: /^(skills|technical skills|core competencies)$/i,
  projects: /^projects?$/i,
  certifications: /^(certifications?|certificates?)$/i,
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

function matchSection(line: string): keyof typeof SECTION_PATTERNS | null {
  const trimmed = line.trim().replace(/[:\-–]+$/, "");
  for (const [section, pattern] of Object.entries(SECTION_PATTERNS)) {
    if (pattern.test(trimmed)) return section as keyof typeof SECTION_PATTERNS;
  }
  return null;
}

function splitIntoBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/**
 * Best-effort, regex/section-header based extraction. Resumes are wildly
 * inconsistent in formatting, so this intentionally does the easy 80% (email,
 * phone, skills list, section boundaries) and leaves per-entry
 * experience/education structuring loose — confidence comes back "low"
 * whenever that matters, so the caller can fall back to Claude.
 */
export function heuristicParseResume(rawText: string): {
  resume: StructuredResume;
  confidence: "high" | "low";
} {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim());
  const nonEmptyLines = lines.filter((l) => l !== "");

  const email = rawText.match(EMAIL_RE)?.[0];
  const phone = rawText.match(PHONE_RE)?.[0];
  const name =
    nonEmptyLines[0] && nonEmptyLines[0].length < 60 && !EMAIL_RE.test(nonEmptyLines[0])
      ? nonEmptyLines[0]
      : undefined;

  const sectionStarts: { section: keyof typeof SECTION_PATTERNS; index: number }[] = [];
  lines.forEach((line, i) => {
    const section = matchSection(line);
    if (section) sectionStarts.push({ section, index: i });
  });

  const sectionText: Partial<Record<keyof typeof SECTION_PATTERNS, string[]>> = {};
  sectionStarts.forEach(({ section, index }, i) => {
    const end = sectionStarts[i + 1]?.index ?? lines.length;
    sectionText[section] = lines.slice(index + 1, end);
  });

  const skills = (sectionText.skills ?? [])
    .join(" ")
    .split(/[,•|;•]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40)
    .slice(0, 40);

  const experience = splitIntoBlocks(sectionText.experience ?? []).map((block) => ({
    title: block[0] ?? "",
    company: block[1] ?? "",
    description: block.slice(2).join(" "),
  }));

  const education = splitIntoBlocks(sectionText.education ?? []).map((block) => ({
    school: block[0] ?? "",
    degree: block[1],
  }));

  const projects = splitIntoBlocks(sectionText.projects ?? []).map((b) => b.join(" "));
  const certifications = (sectionText.certifications ?? []).filter((l) => l !== "");
  const summary = (sectionText.summary ?? []).join(" ").trim() || undefined;

  const resume: StructuredResume = {
    contact: { name, email, phone },
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
  };

  const confidence: "high" | "low" =
    !!email && skills.length > 0 && experience.length > 0 ? "high" : "low";

  return { resume, confidence };
}
