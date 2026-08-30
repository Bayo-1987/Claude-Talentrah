"use client";

import { useActionState } from "react";
import {
  startMfaEnrolmentAction,
  confirmMfaEnrolmentAction,
} from "@/lib/admin/mfa-actions";
import { initialMfaEnrolState } from "@/lib/admin/mfa-state";
import { Button, TextField, BorderedCard, EyebrowLabel } from "@/components/ui";

/**
 * Two submissions, because nothing is stored between them.
 *
 * The QR is rendered by an external-free route: the otpauth:// URI is shown as
 * text alongside the secret, because a CSP-safe QR would mean either an image
 * host (an outbound request carrying a TOTP secret — absolutely not) or a
 * bundled renderer for a page two people will ever use. Every authenticator
 * accepts a typed secret.
 */
export function MfaEnrolForm() {
  const [startState, startAction, starting] = useActionState(
    startMfaEnrolmentAction,
    initialMfaEnrolState,
  );
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmMfaEnrolmentAction,
    initialMfaEnrolState,
  );

  // Once a factor exists, stay on step two — including through a wrong code,
  // so a mistyped digit does not cost a fresh QR.
  const factorId = confirmState.factorId ?? startState.factorId;
  const secret = startState.secret;
  const state = confirmState.status !== "idle" ? confirmState : startState;

  return (
    <div className="flex flex-col gap-6">
      {!factorId ? (
        <form action={startAction} className="flex flex-col gap-3">
          <TextField
            id="mfa-password"
            label="Your password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <div>
            <Button type="submit" disabled={starting}>
              {starting ? "Setting up…" : "Set up authenticator"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {secret && (
            <BorderedCard className="flex flex-col gap-2 p-5">
              <EyebrowLabel>Add this to your authenticator</EyebrowLabel>
              <p className="font-mono text-[17px] tracking-[0.12em] break-all">{secret}</p>
              <p className="font-display text-[13.5px] italic text-ink-soft">
                Type it into Google Authenticator, 1Password, Aegis or similar as a
                time-based code. Then enter the six digits it shows.
              </p>
            </BorderedCard>
          )}

          <form action={confirmAction} className="flex flex-col gap-3">
            <input type="hidden" name="factorId" value={factorId} />
            <TextField
              id="mfa-confirm-password"
              label="Your password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <TextField
              id="mfa-code"
              label="Six-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
            <div>
              <Button type="submit" disabled={confirming}>
                {confirming ? "Checking…" : "Turn on two-factor"}
              </Button>
            </div>
          </form>
        </>
      )}

      {state.status === "error" && state.message && (
        <p
          role="alert"
          className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
