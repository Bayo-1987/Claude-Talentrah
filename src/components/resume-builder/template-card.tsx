"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, BorderedCard } from "@/components/ui";
import { createResumeAction, unlockTemplateAction } from "@/lib/resume-builder/actions";
import type { Tables } from "@/lib/supabase/types";

function LockIcon() {
  return (
    <span title="Needs credits" className="text-ink-soft">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <rect x="5" y="9" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

export function TemplateCard({
  template,
  isUnlocked,
}: {
  template: Tables<"resume_templates">;
  isUnlocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = template.is_premium && !isUnlocked;

  function handleUnlock() {
    setError(null);
    startTransition(async () => {
      const result = await unlockTemplateAction(template.id);
      if (!result.ok) {
        setError(result.error ?? "Couldn't unlock this template — try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px]">{template.name}</h3>
          <span className="text-[12.5px] text-ink-soft">{template.industry_category}</span>
        </div>
        {locked && <LockIcon />}
      </div>

      {locked ? (
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="secondary" onClick={handleUnlock} disabled={pending}>
            {pending ? "Unlocking…" : `Unlock for ${template.unlock_cost_credits} credits`}
          </Button>
          {error && <p className="text-[12.5px] text-rust">{error}</p>}
        </div>
      ) : (
        <form action={createResumeAction.bind(null, template.id)}>
          <Button size="sm" type="submit">
            Use this template
          </Button>
        </form>
      )}
    </BorderedCard>
  );
}
