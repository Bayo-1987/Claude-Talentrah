import "server-only";
import { splitAchievements } from "@/lib/resume/achievements";
import { getExperienceBullets, type ResumeExperienceEntry, type StructuredResume } from "@/lib/resume/types";
import { isSameSkill, normaliseSkills } from "./normalise";
import type { ProposedAddition } from "./types";

/**
 * Merges only the additions the candidate explicitly accepted into their
 * resume — the one and only path anything from `proposedAdditions` can
 * reach a saved resume through. Called from the accept-additions route,
 * never automatically.
 *
 * `experience` replacement is a full-description REPLACE, not an append —
 * see the `text` field's own schema description in tailor.ts for why: a
 * model-declared addition and a backstop-caught one need the same accept
 * semantics, and "append this clause" can't express "here's the whole
 * rewritten paragraph" the backstop case needs, so both write the full text.
 *
 * When the text is several lines, or the role already renders as a bulleted
 * list, the replacement is stored as bullets, one achievement per line — so
 * accepting a reviewed rewrite can neither flatten a role's bullets into a
 * paragraph nor leave the old bullets in place over the new text. A role
 * described as one prose paragraph stays a paragraph.
 */
function replaceNarrative(entry: ResumeExperienceEntry, text: string): ResumeExperienceEntry {
  const achievements = splitAchievements(text);
  const rendersAsList = getExperienceBullets(entry) !== undefined;
  if (achievements.length > 1 || (achievements.length === 1 && rendersAsList)) {
    return { ...entry, bullets: achievements, description: achievements.join(" ") };
  }
  return { ...entry, description: text, bullets: undefined };
}

export function mergeAcceptedAdditions(
  resume: StructuredResume,
  accepted: ProposedAddition[],
): StructuredResume {
  const skills = [...resume.skills];
  const experience = resume.experience.map((e) => ({ ...e }));

  for (const addition of accepted) {
    if (addition.section === "skills") {
      // The same comparison the tailoring pass uses, so "Project-Management"
      // is not added next to an existing "Project Management".
      const already = skills.some((s) => isSameSkill(s, addition.text));
      if (!already) skills.push(normaliseSkills([addition.text])[0] ?? addition.text);
    } else if (
      addition.section === "experience" &&
      typeof addition.experienceIndex === "number" &&
      experience[addition.experienceIndex]
    ) {
      experience[addition.experienceIndex] = replaceNarrative(experience[addition.experienceIndex], addition.text);
    }
  }

  return { ...resume, skills, experience };
}
