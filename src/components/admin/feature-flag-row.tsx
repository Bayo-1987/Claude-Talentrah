"use client";

import { useActionState } from "react";
import { setFeatureFlagAction } from "@/lib/admin/flags/actions";
import { initialFlagActionState } from "@/lib/admin/flags/state";
import { Button } from "@/components/ui";

/**
 * One flag's switch.
 *
 * A SUBMIT BUTTON, not a checkbox that saves on change. Flipping a flag
 * changes what real users receive; a control that fires on the change event is
 * one mis-click away from switching a feature on for everybody, with no moment
 * in between to notice. The button names the state it will move to, so the
 * click and its consequence read the same.
 *
 * Nothing here decides anything. requirePermission guards the action and
 * admin_set_feature_flag (0081) re-checks in the same statement as the write.
 */
export function FeatureFlagRow({
  flagKey,
  enabled,
}: {
  flagKey: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(setFeatureFlagAction, initialFlagActionState);
  const mine = state.targetKey === flagKey && state.status !== "idle";

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="key" value={flagKey} />
        <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
        <Button
          type="submit"
          size="sm"
          variant={enabled ? "secondary" : "primary"}
          disabled={pending}
        >
          {pending ? "Working…" : enabled ? "Turn off" : "Turn on"}
        </Button>
        <span className="font-body text-[13.5px] text-ink-soft">
          Currently {enabled ? "on" : "off"}
        </span>
      </form>

      {mine && (
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
