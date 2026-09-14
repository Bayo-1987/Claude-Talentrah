"use client";

import { useState, useTransition } from "react";
import { requestTalentVerificationAction } from "@/lib/talent-directory/actions";
import { Button } from "@/components/ui";

export function VerificationPanel({ status }: { status: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (status === "pending") {
    return (
      <p className="text-[13px] text-ink-soft">
        Grading in progress, or waiting for a reviewer to pick it up — an AI grade happens
        immediately, refresh in a moment; a human review may take longer.
      </p>
    );
  }
  if (status === "claimed") {
    return <p className="text-[13px] text-ink-soft">A mentor has claimed your submission and is reviewing it.</p>;
  }
  if (status === "verified") {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestTalentVerificationAction();
            setMessage({ text: result.message, ok: result.status === "success" });
          })
        }
      >
        {status === "rejected" ? "Try again" : "Request verification"}
      </Button>
      {message && (
        <p className={`text-[13px] ${message.ok ? "text-green" : "text-rust"}`}>{message.text}</p>
      )}
    </div>
  );
}
