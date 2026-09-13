"use client";

import { useActionState, useTransition } from "react";
import { addPortfolioItemAction, deletePortfolioItemAction } from "@/lib/talent-directory/actions";
import { Button, TextField } from "@/components/ui";
import type { PortfolioItem } from "@/lib/talent-directory/queries";

const initialState: { status: "idle" | "success" | "error"; message: string } = {
  status: "idle",
  message: "",
};

export function PortfolioManager({ items }: { items: PortfolioItem[] }) {
  const [state, formAction, pending] = useActionState(addPortfolioItemAction, initialState);
  const [deleting, startDelete] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <p className="text-[13.5px] text-ink-soft">No work samples added yet.</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 border-b border-line pb-2">
              <div>
                <p className="font-body text-[13.5px] font-semibold text-ink">{item.title}</p>
                {item.description && <p className="text-[13px] text-ink-soft">{item.description}</p>}
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-coral">
                    {item.url}
                  </a>
                )}
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => startDelete(() => deletePortfolioItemAction(item.id))}
                className="font-body text-[12.5px] font-semibold text-coral"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <TextField label="Title" name="title" required placeholder="e.g. Redesigned onboarding flow" />
        <TextField label="Link (optional)" name="url" type="url" placeholder="https://..." />
        <TextField label="Description (optional)" name="description" placeholder="One or two sentences" />
        {state.message && (
          <p className={`text-[12.5px] ${state.status === "error" ? "text-coral" : "text-green"}`}>{state.message}</p>
        )}
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Add work sample
        </Button>
      </form>
    </div>
  );
}
