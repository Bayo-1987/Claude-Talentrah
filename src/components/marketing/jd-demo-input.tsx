"use client";

import { useState } from "react";
import Link from "next/link";
import { EyebrowLabel } from "@/components/ui";

const QUICK_ACTIONS = [
  "Tailor my resume to a job",
  "Check my match score",
  "Build a resume",
  "Talk to a mentor",
];

/**
 * The hero's "paste a job listing" box. There is no anonymous,
 * rate-limited JD-tailoring endpoint yet (build-prompt §6.1 calls for one,
 * but only the signed-in /api/tailoring route exists today, and it requires
 * auth). Rather than fake a response, this stays visually complete but
 * shows an honest "coming soon" note on interaction — wiring the real
 * pre-signup demo (new public rate-limited route, gap analysis against a
 * sample resume) is scoped separately, not silently done here.
 */
export function JdDemoInput() {
  const [touched, setTouched] = useState(false);
  const [value, setValue] = useState("");

  function handleTry(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
  }

  return (
    <div className="flex w-full max-w-[680px] flex-col items-center gap-4">
      <form
        onSubmit={handleTry}
        className="w-full border-[1.5px] border-ink bg-card p-5 shadow-[0_24px_48px_-28px_oklch(20%_0.018_50_/_0.3)]"
      >
        <EyebrowLabel className="mb-3 block">Paste a job listing</EyebrowLabel>
        <div className="mb-4 flex items-center gap-3.5 border-b border-dashed border-line pb-4">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste a job link or description for Farah to tailor your resume to…"
            className="flex-1 border-none bg-transparent font-display text-[15.5px] italic text-ink-soft outline-none placeholder:text-ink-soft"
          />
          <button
            type="submit"
            aria-label="Send to Farah"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink text-paper"
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M3 10 L17 3 L11 17 L9 11 L3 10Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5.5">
          {QUICK_ACTIONS.map((label) => (
            <button
              key={label}
              type="submit"
              className="font-body text-[13.5px] font-bold text-rust underline underline-offset-3"
            >
              {label}
            </button>
          ))}
          <Link
            href="/jobs"
            className="font-body text-[13.5px] font-semibold text-ink-soft underline underline-offset-3"
          >
            Browse jobs instead →
          </Link>
        </div>
      </form>

      {touched ? (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-center text-[13.5px] text-rust">
          The pre-signup demo is still being wired up — create a free account
          to tailor your resume today instead.
        </p>
      ) : (
        <div className="font-display text-[12.5px] italic text-ink-soft">
          No account needed to see your match score
        </div>
      )}
    </div>
  );
}
