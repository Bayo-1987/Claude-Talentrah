"use client";

import { useActionState } from "react";
import { updateCourseAction, setCourseActiveAction } from "@/lib/admin/catalog/actions";
import { initialModerationState } from "@/lib/admin/moderation/state";
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
  const [saveState, saveAction, saving] = useActionState(
    updateCourseAction,
    initialModerationState,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    setCourseActiveAction,
    initialModerationState,
  );

  const state =
    toggleState.targetId === course.id && toggleState.status !== "idle"
      ? toggleState
      : saveState.targetId === course.id && saveState.status !== "idle"
        ? saveState
        : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={saveAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={course.id} />

        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            id={`title-${course.id}`}
            label="Title"
            name="title"
            defaultValue={course.title}
            required
          />
          <TextField
            id={`provider-${course.id}`}
            label="Provider"
            name="provider"
            defaultValue={course.provider}
            required
          />
          <TextField
            id={`skill-${course.id}`}
            label="Skill tag"
            name="skill_tag"
            defaultValue={course.skillTag}
            required
          />
          <SelectField
            id={`tier-${course.id}`}
            label="Price tier"
            name="price_tier"
            defaultValue={course.priceTier}
            options={TIER_OPTIONS}
          />
        </div>

        <TextField
          id={`url-${course.id}`}
          label="Affiliate URL"
          name="affiliate_url"
          type="url"
          defaultValue={course.affiliateUrl}
          required
        />

        <div>
          <Button type="submit" size="sm" variant="secondary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      <form action={toggleAction} className="flex flex-wrap items-center gap-3">
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

      {state && (
        <p
          role="status"
          className={
            "border-[1.5px] px-3.5 py-2.5 text-[13.5px] " +
            (state.status === "error"
              ? "border-rust bg-rust-soft text-rust"
              : "border-ink bg-card text-ink")
          }
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
