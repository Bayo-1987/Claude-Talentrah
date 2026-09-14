"use client";

import { useActionState } from "react";
import { setOperatorRoleAction, setOperatorAccessAction } from "@/lib/admin/operators/actions";
import { initialOperatorActionState } from "@/lib/admin/operators/state";
import { Button } from "@/components/ui";

/**
 * One operator's controls: promote/demote, and enable/disable.
 *
 * TWO FORMS, NOT ONE. They are separate decisions with separate audit entries,
 * and a single form with a Save button invites changing both at once — which
 * reads in the log as one event and is two.
 *
 * Nothing here decides anything. Every button posts to a Server Action that
 * calls requireSuperAdmin() and then a database function that re-checks the
 * same thing. This component is allowed to be wrong; it is not allowed to be
 * the reason something happened.
 */
export function OperatorRowForm({
  id,
  roleId,
  roles,
  disabled,
  isSelf,
}: {
  id: string;
  roleId: string | null;
  roles: { id: string; name: string }[];
  disabled: boolean;
  isSelf: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState(
    setOperatorRoleAction,
    initialOperatorActionState,
  );
  const [accessState, accessAction, accessPending] = useActionState(
    setOperatorAccessAction,
    initialOperatorActionState,
  );

  const state = roleState.targetId === id && roleState.status !== "idle" ? roleState
    : accessState.targetId === id && accessState.status !== "idle" ? accessState
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/*
          A select plus an explicit Save, not a toggle. With two fixed tiers a
          single button could name the only other state; with arbitrary roles
          it cannot, and a control that changes access on the change event is
          one mis-click from reassigning somebody.
        */}
        <form action={roleAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="sr-only" htmlFor={`role-${id}`}>
            Role
          </label>
          <select
            id={`role-${id}`}
            name="roleId"
            defaultValue={roleId ?? ""}
            className="min-h-11 border-[1.5px] border-ink bg-card px-3 font-body text-[14px] text-ink"
          >
            <option value="">No role — no access</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="secondary" disabled={rolePending}>
            {rolePending ? "Working…" : "Save role"}
          </Button>
        </form>

        <form action={accessAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="access" value={disabled ? "enable" : "disable"} />
          <Button
            type="submit"
            size="sm"
            variant={disabled ? "primary" : "secondary"}
            disabled={accessPending}
          >
            {accessPending ? "Working…" : disabled ? "Re-enable" : "Disable"}
          </Button>
        </form>

        {/*
          Said plainly rather than hidden behind a disabled button. Acting on
          your own row is allowed — the last-Super-Admin guard is what stops
          the dangerous version — but it is worth knowing before clicking that
          you are the one you are changing.
        */}
        {isSelf && (
          <span className="font-display text-[13px] italic text-ink-soft">
            This is you.
          </span>
        )}
      </div>

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
