"use client";

import { useState, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A password input with a reveal toggle — the reference implementation
 * this was extracted from (admin-login-form.tsx) called out the exact
 * moment for this: "If a second field ever needs this, that is the moment
 * to put the slot in TextField; one is not." A second, third and fourth
 * field now need it, so this is that moment — a move, not a rewrite.
 *
 * Same shape as `TextField` (`label`, `error`, plus every other input prop
 * via spread) so it drops in wherever `<TextField type="password" />` is
 * used today, with no extra state management at the call site. `type` is
 * excluded from the public props on purpose: this component owns which one
 * is showing, never a caller.
 *
 * ── WHY THE INPUT'S TYPE TOGGLES, NOT A CSS MASK ───────────────────────────
 *
 * `type` genuinely switches between "password" and "text" so password
 * managers, autofill and platform-level reveal affordances keep working —
 * a font/CSS trick that only LOOKS masked would break all three.
 *
 * ── WHY A REAL <button type="button">, NOT A <div> ─────────────────────────
 *
 * Inside a <form>, a bare <button> defaults to type="submit" — revealing
 * the password would silently post the form. A clickable <div> would avoid
 * that but lose keyboard focus and the button role with it.
 *
 * ── REVEAL STATE IS COMPONENT STATE ONLY ───────────────────────────────────
 *
 * Never localStorage, a cookie, or a URL param — a revealed password that
 * survives the page is a revealed password on someone's NEXT visit, and the
 * whole point is that this visit's viewer chose to reveal it just now. It is
 * also not reset here on submit: that reset is specific to one caller
 * (admin's login form, tied to its own anti-enumeration reasoning about a
 * REJECTED attempt leaving a password on screen) and is achieved by that
 * caller remounting this component with a changed `key` — the same
 * key-bump-to-reset idiom signup-form.tsx already uses for its own fields —
 * rather than by this component exposing reveal state to its caller.
 */
export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
}

export function PasswordField({ label, error, className, id, name, ...rest }: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const inputId = id ?? name;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-body text-[13px] font-semibold text-ink-soft">
        {label}
      </label>

      <div className="relative">
        <input
          id={inputId}
          name={name}
          type={revealed ? "text" : "password"}
          className={cn(
            "min-h-11 w-full border-[1.5px] border-ink bg-card py-2.5 pl-3.5 pr-12 font-body text-[15px] text-ink outline-none focus:border-coral",
            error && "border-coral",
            className,
          )}
          {...rest}
        />

        {/*
          44px wide and the full height of the field, so the hit target is
          the whole right edge rather than the glyph — the sizing bug this
          project has shipped before was exactly a target measured by its
          icon, not its clickable area.
        */}
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          aria-controls={inputId}
          /*
           * The name changes with the state, on top of aria-pressed. Someone
           * who cannot see the field needs to be told the secret is
           * currently on screen, and "Show password, pressed" is a worse way
           * to say that than "Hide password".
           */
          aria-label={revealed ? "Hide password" : "Show password"}
          className={`absolute inset-y-0 right-0 flex w-11 items-center justify-center border-l border-line transition-colors hover:text-coral focus-visible:text-coral focus-visible:outline-none ${
            revealed ? "text-coral" : "text-ink-soft"
          }`}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {error && <p className="text-[12.5px] text-coral">{error}</p>}
    </div>
  );
}

/* Inline SVG, never an emoji — and aria-hidden, because the button is named. */
function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 12S5.5 5 12 5c1.6 0 3.05.42 4.32 1.06M20.1 8.2c1.5 1.9 2.4 3.8 2.4 3.8s-4 7-10.5 7c-1.7 0-3.2-.48-4.5-1.2" />
      <path d="M9.9 9.9a3.25 3.25 0 0 0 4.3 4.3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
