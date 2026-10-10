"use client";

import { useActionState, useState } from "react";
import { updateCourseAction, setCourseActiveAction } from "@/lib/admin/catalog/actions";
import { runCourseRowAction } from "@/lib/admin/catalog/row-action";
import { initialModerationState, type ModerationState } from "@/lib/admin/moderation/state";
import { inputValue } from "@/lib/forms/keep-input";
import { tierSelect } from "@/lib/admin/catalog/tier-select";
import { Button, TextField, SelectField } from "@/components/ui";
import { PRICE_TIERS } from "@/lib/admin/catalog/constants";

const TIER_OPTIONS = PRICE_TIERS.map((t) => ({ value: t, label: t }));

/**
 * One catalog row: an edit form and an active toggle.
 *
 * Two separate forms rather than one, because they are two different
 * decisions. Bundling the toggle into Save would mean an operator correcting a
 * typo has to think about whether the course is live; keeping them apart means
 * neither action can be taken by accident while doing the other.
 *
 * The fields are pre-filled and always editable rather than hidden behind an
 * "Edit" button. At nine rows an expand/collapse is pure ceremony, and a form
 * you can read is a form you can check before you save.
 */
export function CourseRowForm({
  course,
}: {
  course: {
    id: string;
    skillTag: string;
    provider: string;
    title: string;
    affiliateUrl: string;
    priceTier: string;
    active: boolean;
    isPlaceholder: boolean;
  };
}) {
  /*
   * ONE state for both forms, so the banner is always the latest result (QA COURSE-MSG-1: a toggle's old message used to sit in front of every later Save result). A refused Save hands the
   * typed fields back in `state.values`, and the fields take them as their defaults (COURSE-KEEP-1); see runCourseRowAction.
   */
  const [state, formAction, pending] = useActionState(
    (prev: ModerationState, formData: FormData) => runCourseRowAction(prev, formData, { save: updateCourseAction, toggle: setCourseActiveAction }),
    initialModerationState,
  );
  const [lastSubmitted, setLastSubmitted] = useState<"save" | "toggle">("save");
  const saving = pending && lastSubmitted === "save";
  const toggling = pending && lastSubmitted === "toggle";
  // The key and the default of the tier select come from one function (QA COURSE-TIER-1): see tier-select.ts.
  const tier = tierSelect(course.priceTier, state.values);
  const banner = state.targetId === course.id && state.status !== "idle" ? state : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} onSubmit={() => setLastSubmitted("save")} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={course.id} />

        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            id={`title-${course.id}`}
            label="Title"
            name="title"
            defaultValue={inputValue(state.values, "title", course.title)}
            required
          />
          <TextField
            id={`provider-${course.id}`}
            label="Provider"
            name="provider"
            defaultValue={inputValue(state.values, "provider", course.provider)}
            required
          />
          <TextField
            id={`skill-${course.id}`}
            label="Skill tag"
            name="skill_tag"
            defaultValue={inputValue(state.values, "skill_tag", course.skillTag)}
            required
          />
          <SelectField
            id={`tier-${course.id}`}
            label="Price tier"
            name="price_tier"
            key={tier.key}
            defaultValue={tier.defaultValue}
            options={TIER_OPTIONS}
          />
        </div>

        <TextField
          id={`url-${course.id}`}
          label="Affiliate URL"
          name="affiliate_url"
          type="url"
          defaultValue={inputValue(state.values, "affiliate_url", course.affiliateUrl)}
          required
        />

        <div>
          <Button type="submit" size="sm" variant="secondary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      <form action={formAction} onSubmit={() => setLastSubmitted("toggle")} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={course.id} />
        <Button
          type="submit"
          name="decision"
          value={course.active ? "deactivate" : "activate"}
          size="sm"
          variant={course.active ? "secondary" : "primary"}
          disabled={toggling}
        >
          {toggling
            ? "Working…"
            : course.active
              ? "Take out of recommendations"
              : "Make live"}
        </Button>
        {!course.active && course.isPlaceholder && (
          <span className="font-display text-[13.5px] italic text-ink-soft">
            Replace the placeholder link before this can go live.
          </span>
        )}
      </form>

      {banner && (
        <p
          role="status"
          className={
            "border-[1.5px] px-3.5 py-2.5 text-[13.5px] " +
            (banner.status === "error"
              ? "border-rust bg-rust-soft text-rust"
              : "border-ink bg-card text-ink")
          }
        >
          {banner.message}
        </p>
      )}
    </div>
  );
}
