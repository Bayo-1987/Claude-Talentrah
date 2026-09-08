/**
 * Every authenticated entry point must land on the same place.
 *
 * ── WHY THIS TEST EXISTS AT ALL ───────────────────────────────────────────
 *
 * Because the alternative already failed. There were three ways into the app —
 * `signUpAction`, the OAuth/One Tap callback, and `signInAction` — and each
 * spelled out its own destination. Two said `/onboarding`; the third said
 * `/jobs`. Nothing anywhere compared them, so the disagreement sat in the
 * codebase until a real account fell through it: an email confirmation link is
 * single-use, so a user whose click did not cleanly land fell back to the
 * sign-in form and reached the app having never been offered a CV upload, with
 * no route back to the only screen that offers one.
 *
 * The fix routes all of them through `onboardingDestination`. This test is what
 * stops a FOURTH entry point — a magic link, an SSO provider, a mobile
 * callback — from re-introducing the same class of bug by typing its own
 * destination string, which is how the third one got it wrong.
 *
 * It reads the source rather than calling the functions because that is the
 * property worth defending: not "these two happen to return the same string
 * today", but "no entry point contains a destination of its own". A behavioural
 * test passes right up until someone adds a fourth call site, which is exactly
 * when it is needed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { onboardingDestination, ONBOARDING_PATH } from "@/lib/auth/redirect-to";
import { oneTapSuccessDestination } from "@/lib/auth/one-tap-client";

const SRC = path.resolve(__dirname, "../../src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The source of one exported function, from its signature to the start of the
 * next top-level `export` — enough to assert what a single action does without
 * dragging in its neighbours.
 */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`${name} not found — did it get renamed?`);
  const rest = src.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every module that decides where a freshly-authenticated user goes. */
const ENTRY_POINTS = ["lib/auth/actions.ts", "lib/auth/one-tap-client.ts"] as const;

describe("the shared destination", () => {
  it("is what One Tap returns, not a copy that happens to match", () => {
    expect(oneTapSuccessDestination()).toBe(onboardingDestination());
    expect(oneTapSuccessDestination()).toBe(ONBOARDING_PATH);
  });

  it("carries an intended destination through, safely", () => {
    expect(onboardingDestination("/tracker")).toBe("/onboarding?next=%2Ftracker");
    // Attacker-controlled input drops to the bare path rather than leaving the
    // origin — the open-redirect case safeRedirectTo exists for.
    expect(onboardingDestination("//evil.example/x")).toBe(ONBOARDING_PATH);
    expect(onboardingDestination("https://evil.example")).toBe(ONBOARDING_PATH);
    expect(onboardingDestination(undefined)).toBe(ONBOARDING_PATH);
  });
});

describe("no entry point carries a destination of its own", () => {
  it.each(ENTRY_POINTS)("%s routes through the shared helper", (rel) => {
    const src = read(rel);
    expect(
      src.includes("onboardingDestination") || src.includes("ONBOARDING_PATH"),
      `${rel} decides where to send an authenticated user but does not use the shared destination`,
    ).toBe(true);
  });

  it.each(ENTRY_POINTS)("%s hard-codes no /onboarding literal", (rel) => {
    /*
     * Comments are stripped first, deliberately. Both files DISCUSS the old
     * literals at length — that history is the reason the helper exists and
     * should not be deletable to satisfy a test. What must not come back is a
     * literal in executable code.
     */
    expect(
      stripComments(read(rel)),
      `${rel} hard-codes "/onboarding" instead of using ONBOARDING_PATH`,
    ).not.toMatch(/["'`]\/onboarding["'`]/);
  });

  /*
   * SCOPED TO THE FUNCTIONS THAT ROUTE AN AUTHENTICATED USER, not the whole
   * file — and this list took three passes to get right, which is the reason
   * it is written down rather than just correct.
   *
   * The first draft asserted "/jobs" appears nowhere in actions.ts, failed,
   * and was narrowed on the belief that the offending line was
   * `signOutAction` sending a departing user to the feed. Wrong twice:
   * `signOutAction` redirects to /login, and the line belonged to
   * `updatePasswordAction` — which hands back a live session and is therefore
   * a post-authentication destination like the others. The narrowing walked
   * straight past a live instance of the bug this file exists to catch, in the
   * file it was reading.
   *
   * The second pass added `updatePasswordAction`, then removed it again: the
   * change was out of scope at the time, and rewriting another change's
   * control assertions to accommodate it would have been scope creep. It was
   * recorded here as UNDECIDED rather than left as a silent gap.
   *
   * It is decided now, and included. The rule it settles is general: every
   * entry point that hands someone a session routes through
   * `onboardingDestination`, so this class of drift cannot recur by omission
   * — which is exactly what happened to `signInAction` and then, quietly, to
   * this one.
   *
   * `updatePasswordAction` still carries a bare "/admin/login" for its
   * operator branch, deliberately — that is not a seeker destination and
   * /onboarding has nothing to say to an operator. Only "/jobs" is forbidden.
   */
  const POST_AUTH_FUNCTIONS = [
    "signInAction",
    "signUpAction",
    "updatePasswordAction",
  ] as const;

  it.each(POST_AUTH_FUNCTIONS)("%s does not send an authenticated user to /jobs", (fn) => {
    const body = functionBody(stripComments(read("lib/auth/actions.ts")), fn);
    expect(
      body,
      `${fn} routes straight to "/jobs" — the exact shape of the bug 0112 fixed`,
    ).not.toMatch(/["'`]\/jobs["'`]/);
    expect(body, `${fn} no longer routes through the shared destination`).toMatch(
      /onboardingDestination\(/,
    );
  });
});
