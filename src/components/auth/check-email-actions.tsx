"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { buttonClasses } from "@/lib/button-classes";
import { webmailUrlFor } from "@/lib/auth/email-provider";
import { resendSignupConfirmationAction, resendPasswordResetAction } from "@/lib/auth/actions";
import { initialResendState } from "@/lib/auth/resend-state";

export interface CheckEmailActionsProps {
  email: string;
  /** Which flow's resend to call — imported and bound in here, same pattern as ResumeListRow's renameResumeAction.bind(null, id). */
  kind: "signup" | "password-reset";
}

const ACTION_BY_KIND = {
  signup: resendSignupConfirmationAction,
  "password-reset": resendPasswordResetAction,
} as const;

/**
 * The interactive half of both check-email pages: resend, webmail deep-link,
 * spam-folder fine print. A client component because `useActionState` needs
 * one; the server component around it still owns the initial render and the
 * copy that differs between the two flows.
 */
export function CheckEmailActions({ email, kind }: CheckEmailActionsProps) {
  const [state, formAction, pending] = useActionState(
    ACTION_BY_KIND[kind].bind(null, email),
    initialResendState,
  );
  const webmailUrl = webmailUrlFor(email);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {pending ? "Sending…" : "Resend the email"}
        </Button>
      </form>

      {state.status === "success" && (
        <p className="text-[13.5px] text-ink">Sent — check your inbox.</p>
      )}
      {state.status === "error" && state.message && (
        <p className="text-[13.5px] text-rust">{state.message}</p>
      )}

      {webmailUrl && (
        <a
          href={webmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses("secondary", "md", "w-full")}
        >
          Open your inbox ↗
        </a>
      )}
    </div>
  );
}
