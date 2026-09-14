"use client";

import { useActionState } from "react";
import { initialModerationState, type ModerationState } from "@/lib/admin/moderation/state";
import { Button } from "@/components/ui";

type Action = (prev: ModerationState, formData: FormData) => Promise<ModerationState>;

export interface DecisionOption {
  /** Form value submitted for this choice. */
  value: string;
  label: string;
  variant?: "primary" | "secondary";
  /** Refuse to submit without a note. Mirrors the server rule; it does not replace it. */
  requiresNote?: boolean;
}

/**
 * One row's decision controls: an optional note plus one button per outcome.
 *
 * Shared across all three queues because the shape genuinely is the same —
 * pick an outcome, optionally say why — and three copies would drift in
 * exactly the way the three API routes' auth checks once did.
 *
 * THE NOTE FIELD IS ALWAYS PRESENT, even for the outcomes that do not require
 * one. Revealing it only after a rejection is picked makes the reviewer type
 * their reasoning after they have already decided, which is the wrong order;
 * and a note on an approval is often the most useful thing in the log.
 *
 * `requiresNote` here is a courtesy that saves a round trip. The rule is
 * enforced in the Server Action, which is the only place it can be — this is a
 * client component and anything it checks can be skipped.
 */
export function DecisionForm({
  id,
  action,
  options,
  noteName = "note",
  notePlaceholder = "Why? (kept in the audit log)",
  decisionName = "decision",
}: {
  id: string;
  action: Action;
  options: DecisionOption[];
  noteName?: string;
  notePlaceholder?: string;
  decisionName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialModerationState);

  // One shared action powers every row on the page, so a result must only
  // render against the row it belongs to.
  const mine = state.targetId === id;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />

      <textarea
        name={noteName}
        rows={2}
        placeholder={notePlaceholder}
        className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[14px] text-ink outline-none placeholder:font-display placeholder:text-[13.5px] placeholder:italic placeholder:text-ink-soft focus:border-rust"
      />

      <div className="flex flex-wrap items-center gap-3">
        {options.map((option) => (
          <Button
            key={option.value}
            type="submit"
            name={decisionName}
            value={option.value}
            size="sm"
            variant={option.variant ?? "secondary"}
            disabled={pending}
          >
            {pending ? "Working…" : option.label}
          </Button>
        ))}
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
