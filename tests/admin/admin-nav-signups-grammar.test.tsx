import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Signups link's hover text and accessible name say "1 person", "1 job seeker" and "1 employer" for one, and the plural for zero and for two or more (ADMIN-NAV-SIGNUPS-COUNT-ABSORB-1).
 * Each of the three nouns agrees on its own number: 1 person can be 1 job seeker and 0 employers, or 0 job seekers and 1 employer. The expected strings are written out here, not built by the same rule as the code.
 */
const state = vi.hoisted(() => ({ people: 0, employers: 0 }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin/moderation/queues", () => ({
  queueCounts: async () => ({ scholarships: 0, reports: 0, campaigns: 0, feedback: 0, courses: 0, ops: 0, finance: 0, employerVerification: 0, jobReview: 0, mentorReview: 0 }),
}));
vi.mock("@/lib/admin/people/queries", () => ({
  countSignups: async () => state.people,
  countSignupEmployers: async () => state.employers,
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

const { AdminNav } = await import("@/components/admin/admin-nav");

async function hoverAndName(people: number, employers: number) {
  state.people = people;
  state.employers = employers;
  const html = renderToStaticMarkup(await AdminNav({ permissions: ["people_list"] as never }));
  const m = html.match(/<a ([^>]*href="\/admin\/people\/signups"[^>]*)>/)!;
  const get = (name: string) => m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return { title: get("title"), label: get("aria-label") };
}

beforeEach(() => {
  state.people = 0;
  state.employers = 0;
});

describe("the Signups hover text and accessible name use the right singular and plural", () => {
  const CASES: Array<[number, number, string]> = [
    [0, 0, "Signups, 0 people: 0 job seekers, 0 employers"],
    [1, 0, "Signups, 1 person: 1 job seeker, 0 employers"],
    [1, 1, "Signups, 1 person: 0 job seekers, 1 employer"],
    [2, 0, "Signups, 2 people: 2 job seekers, 0 employers"],
    [2, 1, "Signups, 2 people: 1 job seeker, 1 employer"],
    [3, 2, "Signups, 3 people: 1 job seeker, 2 employers"],
    [1001, 1000, "Signups, 1,001 people: 1 job seeker, 1,000 employers"],
    [1234567, 1, "Signups, 1,234,567 people: 1,234,566 job seekers, 1 employer"],
  ];

  it.each(CASES)("N=%i, E=%i reads exactly the pinned sentence, in both the hover text and the accessible name", async (n, e, expected) => {
    const { title, label } = await hoverAndName(n, e);
    expect(title).toBe(expected);
    expect(label).toBe(expected);
  });
});
