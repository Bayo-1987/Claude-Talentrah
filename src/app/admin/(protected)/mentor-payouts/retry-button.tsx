"use client";

import { useState, useTransition } from "react";
import { retryMentorPayoutAction } from "@/lib/admin/mentor-payouts/actions";
import { Button } from "@/components/ui";

export function RetryButton({ payoutId }: { payoutId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryMentorPayoutAction(payoutId);
            setMessage(result.message);
          })
        }
      >
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {message && <p className="max-w-[240px] text-right text-[12.5px] text-ink-soft">{message}</p>}
    </div>
  );
}
