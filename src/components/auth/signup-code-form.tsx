"use client";

import { useActionState, useEffect, useState } from "react";
import { EyebrowLabel, TextField, Button } from "@/components/ui";
import { buttonClasses } from "@/lib/button-classes";
import { CheckEmailIcon } from "@/components/auth/check-email-icon";
import { verifySignupCodeAction, resendSignupCodeAction, startOverSignupAction } from "@/lib/auth/actions";
import { initialCodeState, initialResendCodeState, type CodeFormState, type ResendCodeState } from "@/lib/auth/code-state";
import { CODE_LENGTH, normalizeCodeInput } from "@/lib/auth/code-input";
import { CODE_ENDED } from "@/lib/auth/code-messages";

const CODE_INPUT_ID = "code";

type FormAction = (formData: FormData) => void | Promise<void>;

export interface SignupCodeFormViewProps {
  maskedEmail: string;
  code: string;
  onCodeChange: (value: string) => void;
  verifyAction: FormAction;
  verifyPending: boolean;
  state: CodeFormState;
  resendAction: FormAction;
  resendPending: boolean;
  resendState: ResendCodeState;
  secondsLeft: number;
  startOverAction: FormAction;
  webmailUrl: string | null;
}

/**
 * The code page, as plain markup: no hooks, so tests can render it with react-dom/server. The wiring is SignupCodeForm below.
 *
 * ACCESSIBILITY, each piece on purpose: the input has a real label, inputMode numeric and autocomplete one-time-code (the keypad, and the code offered by the mail
 * app), and no maxLength (a pasted "123 456" would be cut to "123 45" before the page could clean it); its error is linked with aria-describedby and aria-invalid
 * (TextField); the page's message goes through a status region that is in the page from the first render, because a region added together with its text is not
 * announced by every screen reader; and the resend button says how long is left instead of just going grey.
 */
export function SignupCodeFormView(p: SignupCodeFormViewProps) {
  const cooling = p.secondsLeft > 0;
  return (
    <div className="flex flex-col gap-4">
      <CheckEmailIcon />
      <EyebrowLabel>One more step</EyebrowLabel>
      <h2 className="font-display text-[28px]">Check your email.</h2>
      <p className="text-[15px] text-ink-soft">
        We&apos;ve sent a {CODE_LENGTH}-digit code to the address below. Enter it to activate your account. If you already have an account here, no code goes out;
        just log in instead.
      </p>

      <div className="flex items-center justify-between gap-3 border-[1.5px] border-line bg-paper px-3.5 py-3">
        <span className="break-all text-[14.5px] font-semibold text-ink">{p.maskedEmail}</span>
        <form action={p.startOverAction}>
          <button type="submit" className="min-h-10 shrink-0 whitespace-nowrap px-1 text-[12.5px] text-ink-soft underline underline-offset-2 hover:text-rust focus-visible:outline-2 focus-visible:outline-rust">
            Wrong address?
          </button>
        </form>
      </div>

      <form action={p.verifyAction} noValidate className="flex flex-col gap-3">
        <TextField
          label={`${CODE_LENGTH}-digit code`}
          id={CODE_INPUT_ID}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={p.code}
          onChange={(e) => p.onCodeChange(e.target.value)}
          error={p.state.fieldError ?? undefined}
          className="text-center text-[22px] font-semibold tracking-[0.4em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust"
        />
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="code-status">
          {p.state.message && (
            <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">{p.state.message}</p>
          )}
        </div>
        <Button type="submit" variant="primary" disabled={p.verifyPending} className="w-full">
          {p.verifyPending ? "Checking…" : "Confirm email"}
        </Button>
      </form>

      <div className="flex flex-col gap-3">
        <form action={p.resendAction}>
          <Button type="submit" variant="secondary" disabled={p.resendPending || cooling} className="w-full">
            {p.resendPending ? "Sending…" : cooling ? `Resend code in ${p.secondsLeft}s` : "Resend code"}
          </Button>
        </form>
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="resend-status">
          {p.resendState.message && (
            <p className={p.resendState.status === "success" ? "text-[13.5px] text-ink" : "text-[13.5px] text-rust"}>{p.resendState.message}</p>
          )}
        </div>
        {p.webmailUrl && (
          <a href={p.webmailUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "md", "w-full")}>
            Open your inbox ↗
          </a>
        )}
      </div>

      <p className="text-[12.5px] text-ink-soft">Didn&apos;t get it? Check your spam or promotions folder — it can take a minute to arrive.</p>
      <div className="border-t border-line" />
      <p className="text-[13.5px] text-ink-soft">
        Already confirmed?{" "}
        <a href="/login" className="font-semibold text-rust underline underline-offset-3">
          Log in
        </a>
      </p>
    </div>
  );
}

/** Shown when there is no pending signup (the cookie ended, or the page was opened with nothing started). A calm state, not an error page. */
export function SignupCodeEnded() {
  return (
    <div className="flex flex-col gap-4">
      <CheckEmailIcon />
      <EyebrowLabel>One more step</EyebrowLabel>
      <h2 className="font-display text-[28px]">Let&apos;s start again.</h2>
      <p className="text-[15px] text-ink-soft" role="status">
        {CODE_ENDED}
      </p>
      <a href="/signup" className={buttonClasses("primary", "md", "w-full")}>
        Back to sign up
      </a>
      <p className="text-[13.5px] text-ink-soft">
        Already confirmed?{" "}
        <a href="/login" className="font-semibold text-rust underline underline-offset-3">
          Log in
        </a>
      </p>
    </div>
  );
}

export function SignupCodeForm({ maskedEmail, initialCooldownSeconds, webmailUrl }: { maskedEmail: string; initialCooldownSeconds: number; webmailUrl: string | null }) {
  const [state, verifyAction, verifyPending] = useActionState(verifySignupCodeAction, initialCodeState);
  const [resendState, resendAction, resendPending] = useActionState(resendSignupCodeAction, initialResendCodeState);
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(initialCooldownSeconds);

  // When a resend answers (a new code went out, or it said how long is left), restart the countdown from what it says. Adjusting state while rendering, on a
  // change of the action's result, is React's documented pattern for this; an effect would paint one wrong frame first.
  const [seenResend, setSeenResend] = useState(resendState);
  if (resendState !== seenResend) {
    setSeenResend(resendState);
    if (resendState.cooldownSeconds !== null) setSecondsLeft(resendState.cooldownSeconds);
  }

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- the interval is (re)started only when the countdown starts or ends

  // A refused code puts the cursor back in the box, with what was typed still in it, so the next try is one edit away (and a screen reader reads the error).
  useEffect(() => {
    if (state.status === "error") document.getElementById(CODE_INPUT_ID)?.focus();
  }, [state]);

  if (state.ended || resendState.ended) return <SignupCodeEnded />;

  return (
    <SignupCodeFormView
      maskedEmail={maskedEmail}
      code={code}
      onCodeChange={(v) => setCode(normalizeCodeInput(v))}
      verifyAction={verifyAction}
      verifyPending={verifyPending}
      state={state}
      resendAction={resendAction}
      resendPending={resendPending}
      resendState={resendState}
      secondsLeft={secondsLeft}
      startOverAction={startOverSignupAction}
      webmailUrl={webmailUrl}
    />
  );
}
