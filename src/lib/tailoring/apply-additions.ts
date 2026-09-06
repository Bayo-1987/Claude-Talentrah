import "server-only";
import type { StructuredResume } from "@/lib/resume/types";
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
 */
export function mergeAcceptedAdditions(
  resume: StructuredResume,
  accepted: ProposedAddition[],
): StructuredResume {
  const skills = [...resume.skills];
  const experience = resume.experience.map((e) => ({ ...e }));

  for (const addition of accepted) {
    if (addition.section === "skills") {
      const already = skills.some((s) => s.toLowerCase().trim() === addition.text.toLowerCase().trim());
      if (!already) skills.push(addition.text);
    } else if (
      addition.section === "experience" &&
      typeof addition.experienceIndex === "number" &&
      experience[addition.experienceIndex]
    ) {
      experience[addition.experienceIndex] = {
        ...experience[addition.experienceIndex],
        description: addition.text,
      };
    }
  }

  return { ...resume, skills, experience };
}
