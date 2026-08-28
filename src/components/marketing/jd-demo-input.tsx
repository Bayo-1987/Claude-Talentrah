"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { EyebrowLabel } from "@/components/ui";
import { JdDemoExample } from "./jd-demo-example";
import { JdDemoResult, type JdDemoResultData } from "./jd-demo-result";

// Shipped surfaces only — "Talk to a mentor" sat here alongside three real
// actions, which read as parity with them. Mentorship is Phase 3.
const QUICK_ACTIONS = [
  { label: "Tailor my resume to a job", href: "/signup" },
  { label: "Check my match score", href: "/signup" },
  { label: "Build a resume", href: "/resume-builder" },
  { label: "Find a scholarship", href: "/scholarships" },
];

const MIN_CHARS = 50;

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: JdDemoResultData }
  | { kind: "used"; message: string }
  | { kind: "needsResume" }
  | { kind: "error"; message: string };

/**
 * The hero's "paste a job description" box — now a real run (§6.1).
 *
 * WHICH ENDPOINT DEPENDS ON WHO IS ASKING, and that is the whole of the
 * signed-in handling. A stranger goes to /api/public/jd-demo, which scores
 * against a sample persona and is capped at one run ever. A signed-in visitor
 * goes to the ordinary /api/tailoring with their own resume, their own credit
 * allowance and their own hourly limit — no new backend, just not sending a
 * logged-in person down an anonymous path that would tailor a stranger's CV
 * and then tell them to create the account they already have.
 *
 * THE SESSION IS DETECTED HERE, and it used to be threaded from the page.
 *
 * The old comment said the browser could not be asked because the session
 * lives in an httpOnly cookie. That is not how this app is set up: @supabase/ssr
 * writes a cookie its own browser client reads, which is why
 * lib/supabase/client.ts exists at all. What the page paid for that assumption
 * was its entire cacheability — one `getUser()` in a Server Component makes
 * the whole route dynamic, so every anonymous visitor rendered the FAQ and the
 * footer from scratch.
 *
 * Moving it here costs a caption. Until the session resolves the copy reads as
 * signed-out, which is right for nearly everyone landing here and briefly
 * wrong for the minority who are logged in. That is the trade, stated: a
 * one-line swap after hydration, against a server render for every stranger.
 *
 * `getSession` reads the cookie and does not call the network, unlike
 * `getUser`. And this flag decides COPY AND WHICH ENDPOINT TO POST TO, never
 * whether something is allowed — /api/tailoring and /api/public/jd-demo each
 * enforce their own auth server-side. A tampered client can pick the wrong
 * door and gets turned away by it.
 */
export function JdDemoInput() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  /** `null` while unknown — the caption treats it as signed-out meanwhile. */
  const [session, setSession] = useState<boolean | null>(null);
  const isSignedIn = session === true;

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setSession(!!data.session);
      })
      .catch(() => {
        // Unknown reads as signed-out: the anonymous path is the one that
        // works without an account, so failing towards it is the safe side.
        if (!cancelled) setSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const looksLikeUrl = /^https?:\/\/\S+$/i.test(value.trim());
  const tooShort = value.trim().length < MIN_CHARS;
  const busy = state.kind === "loading";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const jdText = value.trim();
    if (looksLikeUrl) {
      setState({
        kind: "error",
        message:
          "We can't open a link yet — paste the job description text itself and Farah will work from that.",
      });
      return;
    }
    if (jdText.length < MIN_CHARS) {
      setState({
        kind: "error",
        message: "Paste the full job description — that looked too short.",
      });
      return;
    }

    setState({ kind: "loading" });

    /*
     * RESOLVED AT SUBMIT, not read off the render.
     *
     * The effect above is for the caption and is allowed to be a moment late.
     * This is not: someone who pastes and submits before it lands would be
     * sent down the anonymous path while signed in — spending a public run and
     * then being told to create the account they already have, which is
     * precisely the failure the flag exists to prevent. `getSession` is a
     * cookie read, so asking again here costs nothing and removes the race.
     */
    let signedIn = session;
    if (signedIn === null) {
      const { data } = await createClient()
        .auth.getSession()
        .catch(() => ({ data: { session: null } }));
      signedIn = !!data.session;
      setSession(signedIn);
    }

    try {
      const response = await fetch(signedIn ? "/api/tailoring" : "/api/public/jd-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Never for either path. §6.9 makes the first cover letter a one-time
        // benefit of having an ACCOUNT; spending it from the landing page —
        // silently, on a second model call nobody asked for — is not the demo.
        body: JSON.stringify({ jdText, includeCoverLetter: false }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        /*
         * The signed-in path has one failure the anonymous path cannot have:
         * no base resume yet. It arrives as a 400 with that message, and it
         * needs its own CTA — telling someone who is already signed in to
         * "create a free account" is the wrong instruction and reads as the
         * product not knowing who they are.
         */
        if (signedIn && response.status === 400 && /base resume/i.test(payload?.error ?? "")) {
          setState({ kind: "needsResume" });
          return;
        }
        /*
         * Branch on the REASON, not the status family.
         *
         * `already_used` and `daily_cap` are the limiter doing its job, and
         * the signup CTA is genuinely the way past both. A server-side
         * failure is not — routing it here once told a first-time visitor
         * they had already used their free run, because the route answered
         * 429 for its own internal error too. The reason field is what
         * distinguishes them; the status alone cannot.
         */
        if (
          !signedIn &&
          (payload?.reason === "already_used" || payload?.reason === "daily_cap")
        ) {
          setState({ kind: "used", message: payload?.error ?? "The free preview isn't available." });
          return;
        }
        setState({
          kind: "error",
          message: payload?.error ?? "That didn't go through — try again in a moment.",
        });
        return;
      }

      // The two routes wrap the result differently: /api/tailoring nests it
      // under `result` alongside its credit bookkeeping, the public one
      // returns the fields flat. Normalised here rather than changing a route
      // that signed-in code already depends on.
      const data: JdDemoResultData = payload.result ?? payload;
      setState({ kind: "done", data });
    } catch {
      setState({
        kind: "error",
        message: "That didn't go through — check your connection and try again.",
      });
    }
  }

  return (
    <div className="flex w-full max-w-[860px] flex-col items-center gap-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[680px] border-[1.5px] border-ink bg-card p-5 shadow-[0_24px_48px_-28px_oklch(20%_0.018_50_/_0.3)]"
      >
        <EyebrowLabel className="mb-3 block">Paste a job description</EyebrowLabel>
        <div className="mb-4 flex items-start gap-3.5 border-b border-dashed border-line pb-4">
          <label htmlFor="jd-demo" className="sr-only">
            Job description
          </label>
          {/*
            A textarea, not an input. The floor is 50 characters and a real
            job description is thousands — a single-line box that scrolls
            sideways told visitors, wordlessly, that a link was what was
            wanted. The placeholder no longer offers "job link" either: nothing
            in this codebase fetches a URL, so it was advertising a capability
            that does not exist.
          */}
          <textarea
            id="jd-demo"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="Paste the job description here and Farah will tailor a resume to it…"
            className="flex-1 resize-y border-none bg-transparent font-display text-[15.5px] italic text-ink-soft outline-none placeholder:text-ink-soft disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy}
            aria-label={busy ? "Farah is working" : "Send to Farah"}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink text-paper disabled:opacity-60"
          >
            {busy ? (
              // Spinner rather than a disabled arrow: CLAUDE.md's §8 requires
              // a loading state for anything past ~2s, and a tailoring run is
              // a model call — comfortably past it.
              <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true" className="animate-spin">
                <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M10 3 A7 7 0 0 1 17 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M3 10 L17 3 L11 17 L9 11 L3 10Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5.5">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="font-body text-[13.5px] font-bold text-rust underline underline-offset-3"
            >
              {action.label}
            </Link>
          ))}
          <Link
            href="/jobs"
            className="font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-3"
          >
            Browse jobs instead →
          </Link>
        </div>
      </form>

      {state.kind === "loading" && (
        <p aria-live="polite" className="font-display text-[13px] italic text-ink-soft">
          Farah is reading the job description…
        </p>
      )}

      {state.kind === "used" && (
        <div
          aria-live="polite"
          className="flex flex-col items-center gap-2 border-[1.5px] border-ink bg-card px-5 py-4 text-center"
        >
          <p className="text-[14px] text-ink">{state.message}</p>
          <Link href="/signup" className="text-[13.5px] font-bold text-rust underline underline-offset-3">
            Create a free account →
          </Link>
        </div>
      )}

      {state.kind === "needsResume" && (
        <div
          aria-live="polite"
          className="flex flex-col items-center gap-2 border-[1.5px] border-ink bg-card px-5 py-4 text-center"
        >
          <p className="text-[14px] text-ink">
            You&apos;ll need a base resume before Farah can tailor one.
          </p>
          <Link
            href="/resume-builder"
            className="text-[13.5px] font-bold text-rust underline underline-offset-3"
          >
            Build or upload your resume →
          </Link>
        </div>
      )}

      {state.kind === "error" && (
        <div
          aria-live="polite"
          className="flex flex-col items-center gap-1 border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-center"
        >
          <p className="text-[13.5px] text-rust">{state.message}</p>
          {/*
            Said plainly, because it is the visitor's first question and the
            answer is not obvious: the run is released server-side whenever the
            model call fails, so a failure costs them nothing.
          */}
          {!isSignedIn && (
            <p className="font-display text-[12.5px] italic text-rust">
              Your free preview wasn&apos;t used — try again.
            </p>
          )}
        </div>
      )}

      {state.kind === "idle" && (
        <div
          data-testid="jd-demo-caption"
          className="font-display text-[12.5px] italic text-ink-soft"
        >
          {isSignedIn
            ? "Tailored against your saved resume"
            : `No account needed — one free run, ${MIN_CHARS} characters minimum`}
        </div>
      )}

      {/*
        The static worked example until there is a real one, then the real one
        in its place. Rendered here rather than as a sibling in HeroSection so
        one component owns the swap — two siblings sharing this state would
        mean lifting it into the section and passing setters down.
      */}
      {state.kind === "done" ? (
        <JdDemoResult data={state.data} isSignedIn={isSignedIn} />
      ) : (
        <JdDemoExample />
      )}

      {tooShort && value.trim().length > 0 && !looksLikeUrl && state.kind === "idle" && (
        <p className="font-display text-[12px] italic text-ink-soft">
          {MIN_CHARS - value.trim().length} more characters…
        </p>
      )}
    </div>
  );
}
