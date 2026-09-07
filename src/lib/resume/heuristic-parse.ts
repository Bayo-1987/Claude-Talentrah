import type { ResumeLink, StructuredResume } from "./types";

const SECTION_PATTERNS: Record<string, RegExp> = {
  summary: /^(summary|profile|objective|about)$/i,
  experience: /^(experience|work experience|employment|employment history)$/i,
  education: /^education$/i,
  /*
   * WIDER THAN THE OTHER SECTIONS, on purpose.
   *
   * This matched exactly three strings — `skills`, `technical skills`,
   * `core competencies` — and anything else left the section absent, which
   * yields `skills: []` rather than an error. One of the three real uploaded
   * resumes on production is in that state: its experience and education
   * parsed, its skills did not, and it scores near-zero against the whole
   * board as a result. See issue #139.
   *
   * The headings below are the ordinary ways people label this section. The
   * optional qualifier covers "Key Skills" / "Technical Proficiencies" /
   * "Relevant Skills"; the optional tail covers "Skills & Interests" and
   * "Skills and Abilities", which are common and previously missed entirely.
   *
   * Deliberately still anchored and still a heading test. Loosening this to a
   * substring match would classify a BULLET containing the word "skills" as
   * the start of a section and swallow the rest of the resume into it.
   */
  skills:
    /^(?:areas of (?:expertise|competence)|(?:(?:technical|core|key|professional|relevant|additional|other|primary)\s+)?(?:skills?|competenc(?:y|ies)|expertise|proficienc(?:y|ies)|skill set)(?:\s*(?:&|and)\s*(?:interests?|abilities|tools|competenc(?:y|ies)|expertise))?)$/i,
  projects: /^projects?$/i,
  certifications: /^(certifications?|certificates?)$/i,
};

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

/*
 * LinkedIn/GitHub get their own recognised label; anything else that reads
 * as a real URL becomes "Website" — deliberately generic, never guessed at
 * more specifically than the resume itself says. Scoped to actual URLs
 * (an explicit scheme, or one of these two well-known hosts) rather than any
 * bare domain-looking string, so an email's domain or a company name that
 * happens to contain a dot is never misread as a link.
 */
const LINK_RE = /\bhttps?:\/\/[^\s,;)]+|\b(?:www\.)?(?:linkedin\.com|github\.com)\/[^\s,;)]+/gi;

/** URLs the resume text actually contains, deduped and labeled — never invented. */
function extractLinks(rawText: string): ResumeLink[] {
  const matches = rawText.match(LINK_RE) ?? [];
  const seen = new Set<string>();
  const links: ResumeLink[] = [];
  for (const match of matches) {
    // Trailing punctuation is sentence structure, not part of the URL —
    // "see my work at github.com/ada." should not keep the period.
    const url = match.replace(/[.,;:]+$/, "");
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const label = /linkedin\.com/i.test(url) ? "LinkedIn" : /github\.com/i.test(url) ? "GitHub" : "Website";
    links.push({ label, url });
  }
  return links;
}

/*
 * Bullet markers as people actually type them in a plain-text/copy-pasted
 * resume. Requires the marker AND at least one space after it, so a line
 * that merely starts with a hyphen as part of a word (there are none in
 * practice, but "e-commerce" is the shape being guarded against) can't
 * match on its own — the space is what makes it a list marker rather than
 * punctuation.
 */
const BULLET_LINE_RE = /^[•●▪◦‣∙·*-]\s+/;

/**
 * Splits an experience block's trailing lines (everything after title/
 * company) into either `bullets` or `description` — never both, and never
 * invented. Only classified as bulleted when EVERY remaining line actually
 * carries a bullet marker; a block that mixes bulleted and plain lines, or
 * has none at all, is treated as ordinary prose and joined exactly as
 * before this field existed — that's what keeps a resume with no bulleted
 * experience parsing byte-identically to how it did before `bullets`
 * existed.
 */
function extractNarrative(lines: string[]): { description?: string; bullets?: string[] } {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return {};

  const isBulleted = nonEmpty.every((l) => BULLET_LINE_RE.test(l.trim()));
  if (isBulleted) {
    const bullets = nonEmpty
      .map((l) => l.trim().replace(BULLET_LINE_RE, "").trim())
      .filter((l) => l.length > 0);
    if (bullets.length > 0) return { bullets };
  }

  return { description: nonEmpty.join(" ") };
}

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
    ...extractNarrative(block.slice(2)),
  }));

  const education = splitIntoBlocks(sectionText.education ?? []).map((block) => ({
    school: block[0] ?? "",
    degree: block[1],
  }));

  const projects = splitIntoBlocks(sectionText.projects ?? []).map((b) => b.join(" "));
  const certifications = (sectionText.certifications ?? []).filter((l) => l !== "");
  const summary = (sectionText.summary ?? []).join(" ").trim() || undefined;
  // Scanned over the WHOLE document, not just a section — a LinkedIn/GitHub
  // URL is as likely to sit in the header next to the email as under any
  // heading, and there is no reliable "Links" heading to anchor a section on.
  const links = extractLinks(rawText);

  const resume: StructuredResume = {
    contact: { name, email, phone },
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    ...(links.length > 0 ? { links } : {}),
  };

  const confidence: "high" | "low" =
    !!email && skills.length > 0 && experience.length > 0 ? "high" : "low";

  return { resume, confidence };
}
