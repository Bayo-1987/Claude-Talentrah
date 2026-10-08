/**
 * /onboarding does not show the seeker's resume upload to someone headed for the employer side (S1-51).
 *
 * An employer account with no resume and no recorded skip, logging in from /employer, was sent to /onboarding?next=/employer and shown
 * "upload your resume": the job seeker's first screen. The rule is about where they are headed (any /employer path), so it also covers a
 * brand-new employer with no organisation yet (the employer landing's sign-up goes to /employer/onboarding). A seeker with no resume who
 * logs in from /employer skips the resume prompt too and arrives at /employer, which sends a user with no organisation to
 * /employer/onboarding (create a company). Everyone else is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ resume: null as { id: string } | null, skippedAt: null as string | null, queried: 0 }));
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()),
  requireUser: async () => ({ user: { id: "u1" }, profile: { first_name: "Ada", onboarding_skipped_at: state.skippedAt } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => { state.queried += 1; return { data: state.resume, error: null }; } }) }) }) }),
  }),
}));
vi.mock("@/components/onboarding/resume-upload", () => ({ ResumeUpload: () => null }));
vi.mock("@/lib/profile/settings-actions", () => ({ skipOnboardingAction: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }));
vi.mock("next/navigation", () => ({ redirect }));

const { default: OnboardingPage } = await import("@/app/onboarding/page");

beforeEach(() => { state.resume = null; state.skippedAt = null; state.queried = 0; redirect.mockClear(); });

/** Resolves to the redirect target, or "(shown)" when the page rendered its prompt. */
async function outcome(next?: string): Promise<string> {
  try {
    await OnboardingPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
    return "(shown)";
  } catch (e) {
    return (e as { to: string }).to;
  }
}

describe("headed for the employer side", () => {
  it.each(["/employer", "/employer/jobs", "/employer/onboarding", "/employer?x=1"])("a user with no resume and no skip goes straight to %s", async (next) => {
    expect(await outcome(next)).toBe(next);
    expect(state.queried, "no resume lookup is needed").toBe(0);
  });

  it("a path that merely starts with the same letters is not the employer side", async () => {
    expect(await outcome("/employerfoo")).toBe("(shown)");
    expect(await outcome("/employers")).toBe("(shown)");
  });

  it("an off-site 'next' that mentions /employer is refused first, so it cannot pass through", async () => {
    expect(await outcome("//evil.example/employer")).toBe("(shown)");
    expect(await outcome("https://evil.example/employer")).toBe("(shown)");
  });
});

describe("everyone else is unchanged", () => {
  it("a seeker with no resume and no skip is shown the resume prompt", async () => {
    expect(await outcome("/jobs")).toBe("(shown)");
    expect(await outcome()).toBe("(shown)");
  });
  it("a seeker with a base resume goes on to next (default /jobs)", async () => {
    state.resume = { id: "r1" };
    expect(await outcome("/mentorship")).toBe("/mentorship");
    expect(await outcome()).toBe("/jobs");
  });
  it("a seeker who skipped goes on to next", async () => {
    state.skippedAt = "2026-10-01T00:00:00Z";
    expect(await outcome("/scholarships")).toBe("/scholarships");
  });
});
