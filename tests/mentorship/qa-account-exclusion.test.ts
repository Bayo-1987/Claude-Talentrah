/**
 * QA-EXCL, surfaces 4 and 5: QA mentor accounts do not appear in the mentor LIST and are not counted in the public price chip or the "free sessions" flag.
 * The signed-in list reads names through a session client (no email reachable), so it matches by NAME (mentor display_name first, as the card does, else
 * first + last). The signed-out price chip and free flag use the service role, which can embed the profile, so they match by email AND name.
 * A mentor's own profile page (read by id) is deliberately NOT filtered: it is not a listing, and QA's own booking journeys reach their QA mentor by id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const names = vi.hoisted(() => ({ rows: [] as Array<{ user_id: string; display_name: string | null; first_name: string | null; last_name: string | null }> }));
const priceRows = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, selects: [] as string[] }));

const mentorRow = (id: string) => ({ user_id: id, bio: null, expertise_roles: [], expertise_industries: [], expertise_seniority: [], years_experience: null, base_price_ngn: 20000, mentorship_reviews: [] });

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from() {
      const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: names.rows.map((n) => mentorRow(n.user_id)), error: null });
          return () => chain;
        },
      });
      return chain;
    },
    rpc: async (fn: string) => (fn === "mentor_public_names" ? { data: names.rows, error: null } : { data: [], error: null }),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from() {
      const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: priceRows.rows, error: null });
          return (...args: unknown[]) => { if (prop === "select") priceRows.selects.push(String(args[0])); return chain; };
        },
      });
      return chain;
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  priceRows.selects.length = 0;
});

describe("browseMentors (signed-in list)", () => {
  it("hides a QA mentor by display name or by first + last name, and keeps a normal one", async () => {
    names.rows = [
      { user_id: "qa-display", display_name: "QA Mentor", first_name: "Chidi", last_name: "O" },
      { user_id: "qa-split", display_name: null, first_name: "QA", last_name: "Coach" },
      { user_id: "real", display_name: "Ngozi Mentor", first_name: "Ngozi", last_name: "A" },
      { user_id: "lookalike", display_name: null, first_name: "Qasim", last_name: "Khan" },
    ];
    const { browseMentors } = await import("@/lib/mentorship/queries");
    const list = await browseMentors();
    expect(list.map((m) => m.userId).sort()).toEqual(["lookalike", "real"]);
  });
});

describe("the public price range and the free-sessions flag (service role)", () => {
  const row = (price: number | null, email: string, first: string, last: string, display: string | null = null) => ({
    base_price_ngn: price,
    display_name: display,
    profiles: { first_name: first, last_name: last, email },
  });

  it("the price range ignores a QA mentor matched by email OR by name, and reads the identifying columns", async () => {
    priceRows.rows = [
      row(5000, "hello+qa-mentor@talentrah.com", "Ada", "L"), // QA by email only
      row(90000, "x@example.com", "QA", "Mentor"), // QA by name only
      row(25000, "x@example.com", "Ada", "L", "QA Display"), // QA by display name
      row(20000, "ngozi@example.com", "Ngozi", "A"),
      row(30000, "chidi@example.com", "Chidi", "O"),
    ];
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    expect(await getApprovedMentorPriceRangeNgn()).toEqual({ minNgn: 20000, maxNgn: 30000 });
    expect(priceRows.selects[0]).toMatch(/email/);
    expect(priceRows.selects[0]).toMatch(/display_name/);
  });

  it("with ONLY QA mentors the range is null (nothing to show), not their prices", async () => {
    priceRows.rows = [row(5000, "hello+qa-mentor@talentrah.com", "QA", "Mentor")];
    const { getApprovedMentorPriceRangeNgn } = await import("@/lib/mentorship/public-price-range");
    expect(await getApprovedMentorPriceRangeNgn()).toBeNull();
  });

  it("a QA mentor's free sessions do not make the page say 'some mentors offer free sessions'; a normal mentor's do", async () => {
    priceRows.rows = [row(0, "hello+qa-mentor@talentrah.com", "QA", "Mentor"), row(20000, "ngozi@example.com", "Ngozi", "A")];
    let mod = await import("@/lib/mentorship/public-price-range");
    expect(await mod.getApprovedMentorsOfferFreeSessions()).toBe(false);
    vi.resetModules();
    priceRows.rows = [row(0, "hello+qa-mentor@talentrah.com", "QA", "Mentor"), row(null, "ngozi@example.com", "Ngozi", "A")];
    mod = await import("@/lib/mentorship/public-price-range");
    expect(await mod.getApprovedMentorsOfferFreeSessions()).toBe(true);
  });
});
