"use client";

import { useActionState } from "react";
import { inviteOperatorAction } from "@/lib/admin/operators/invite";
import { initialOperatorActionState } from "@/lib/admin/operators/state";
import { Button, TextField } from "@/components/ui";

/**
 * Invite a new operator.
 *
 * THERE IS NO PASSWORD FIELD, and there is not going to be one. The invitee
 * sets their own from a link to their own mailbox. A field here would mean one
 * person choosing another's credential and typing it somewhere — the browser,
 * a chat message, a sticky note — and no amount of "they'll change it" makes
 * that acceptable. Its absence is the feature.
 */
export function InviteOperatorForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(inviteOperatorAction, initialOperatorActionState);
  const mine = state.targetId === "invite";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="invite-email"
          label="Email"
          name="email"
          type="email"
          autoComplete="off"
          required
        />
        <TextField id="invite-name" label="Display name" name="displayName" autoComplete="off" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="font-body text-[13px] font-semibold text-ink">
          Role
        </label>
        <select
          id="invite-role"
          name="roleId"
          required
          defaultValue=""
          className="min-h-11 border-[1.5px] border-ink bg-card px-3 font-body text-[14px] text-ink"
        >
          <option value="" disabled>
            Choose a role…
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <p className="max-w-[560px] font-display text-[14px] italic text-ink-soft">
        They receive a link and choose their own password. Nobody here sets one
        for them, and nobody here ever sees it.
      </p>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </div>

      {mine && state.status !== "idle" && (
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
    </form>
  );
}
