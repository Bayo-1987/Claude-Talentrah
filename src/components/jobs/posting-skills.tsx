import { EyebrowLabel } from "@/components/ui/eyebrow-label";
import { splitSkillsByScreenability } from "@/lib/jobs/skill-facet";

/**
 * The detail page's "Skills named in this posting" card.
 *
 * The headline list is exactly the set the match breakdown counts ("N of M
 * tags"). Skills the match does not use (`NON_SCREENABLE_SKILLS`: communication,
 * leadership, operations) are still shown, because the posting does name them,
 * but on their own labelled line, so the count above and the list below can
 * never disagree about what a "tag" is.
 */
export function PostingSkills({ skills }: { skills: string[] }) {
  if (skills.length === 0) return null;
  const { screenable, notCounted } = splitSkillsByScreenability(skills);

  return (
    <div className="flex flex-col gap-1.5">
      <EyebrowLabel size="sm">Skills named in this posting</EyebrowLabel>
      {screenable.length > 0 ? (
        <p className="text-[14px] leading-relaxed text-ink-soft">{screenable.join(" · ")}</p>
      ) : (
        <p className="text-[14px] leading-relaxed text-ink-soft">
          No skills a resume can be checked against.
        </p>
      )}
      {notCounted.length > 0 && (
        <p data-testid="posting-skills-not-counted" className="text-[12.5px] leading-relaxed text-ink-soft">
          <span className="font-semibold">Also named, not counted in your match:</span>{" "}
          {notCounted.join(" · ")}
        </p>
      )}
    </div>
  );
}
