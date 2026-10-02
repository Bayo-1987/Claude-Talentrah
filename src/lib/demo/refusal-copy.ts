import { ANON_DEMO_DAILY_CAP } from "@/lib/demo/limits";

/**
 * What a refused homepage-demo visitor is told: the reason, and a way forward. Never a dead end.
 *
 * ONE source for the route (which returns it) and the client (which renders it, and falls back to it when a
 * response carries no wording). The first two are the limiter doing its job; the last two are OUR failure and
 * must never say the visitor "used" anything — that exact mistake once told first-time visitors they had
 * already used a run (see the note in src/app/api/public/jd-demo/route.ts).
 */
export const DEMO_REFUSAL_REASONS = ["already_used", "daily_cap", "no_identifier", "error"] as const;
export type DemoRefusalReason = (typeof DEMO_REFUSAL_REASONS)[number];

export function isDemoRefusalReason(value: unknown): value is DemoRefusalReason {
  return (DEMO_REFUSAL_REASONS as readonly unknown[]).includes(value);
}

export function demoRefusalMessage(reason: DemoRefusalReason): string {
  switch (reason) {
    case "already_used":
      return "You've used your free preview — create a free account to keep going.";
    case "daily_cap":
      return `Today's free previews are used up (we allow ${ANON_DEMO_DAILY_CAP} a day) — create a free account to keep going, or try again tomorrow.`;
    case "no_identifier":
    case "error":
      return "The free preview isn't available right now — try again in a moment, or create a free account to keep going.";
  }
}
