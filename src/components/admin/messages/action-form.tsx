"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { initialMessageActionState, type MessageActionState } from "./state";

export type MessageAction = (prev: MessageActionState, formData: FormData) => Promise<MessageActionState>;

/**
 * One button that runs one Server Action. The button is disabled while the action runs AND after it has succeeded, so a second click cannot start the same step again; the
 * database is the real guard (a repeat start returns nothing), this only stops the second click being made.
 */
export function ActionForm({
  action,
  targetId,
  hidden = {},
  label,
  pendingLabel = "Working…",
  variant = "primary",
  children,
}: {
  action: MessageAction;
  targetId: string;
  hidden?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  children?: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, initialMessageActionState);
  const mine = state.status !== "idle" && state.targetId === targetId;
  return (
    <form action={run} className="flex flex-col gap-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div>
        <Button type="submit" size="sm" variant={variant} disabled={pending || state.status === "success"}>
          {pending ? pendingLabel : label}
        </Button>
      </div>
      {mine && (
        <p role="status" className={"border-[1.5px] px-3.5 py-2.5 text-[13.5px] " + (state.status === "error" ? "border-rust bg-rust-soft text-rust" : "border-ink bg-card text-ink")}>
          {state.message}
        </p>
      )}
    </form>
  );
}
