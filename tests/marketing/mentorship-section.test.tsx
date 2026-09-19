/**
 * send-389 — the new homepage Mentorship section. Two things pinned here:
 * a working link to the real /mentorship route, and the absence of any
 * fabricated/hardcoded stat — this section deliberately shows NO session
 * count or satisfaction number (queried live, 2026-09-19: exactly 1 session
 * ever booked platform-wide, still not completed — far too thin to cite
 * without undercutting the credibility argument it's meant to build; see
 * this file's own header for the two independent reasons, RLS + headcount,
 * neither name/photo/bio is real-mentor-specific either).
 *
 * send-403 fast-follow — the pricing floor used to be hardcoded (₦15,000,
 * correct when written but exactly the kind of copy that goes stale the
 * moment mentor pricing changes). `MentorshipSection` now reads it live via
 * `getApprovedMentorPriceRangeNgn()`, the same helper `/mentorship`'s own
 * `generateMetadata()` calls (src/lib/mentorship/public-price-range.ts).
 * This test follows `e2e/mentorship-live-pricing.spec.ts`'s own pattern:
 * query the live value independently (its own query, not a copy of the
 * production code's query) and assert the render agrees with WHATEVER that
 * turns out to be right now — never a hardcoded "15000" that could drift
 * out of sync with reality the exact way the original figure did.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { MentorshipSection } from "@/components/marketing/mentorship-section";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`mentorship-section test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Same filter as getApprovedMentorPriceRangeNgn's own query, expressed independently. */
async function queryLiveApprovedPriceRange(): Promise<{ minNgn: number; maxNgn: number } | null> {
  const { data, error } = await admin
    .from("mentor_profiles")
    .select("base_price_ngn")
    .eq("status", "approved")
    .eq("self_paused", false)
    .not("base_price_ngn", "is", null)
    .gt("base_price_ngn", 0);
  if (error) throw error;
  const prices = (data ?? [])
    .map((r) => r.base_price_ngn)
    .filter((p): p is number => p !== null);
  if (prices.length === 0) return null;
  return { minNgn: Math.min(...prices), maxNgn: Math.max(...prices) };
}

describe("the homepage Mentorship section", () => {
  it("links to the real /mentorship route", async () => {
    const html = renderToStaticMarkup(await MentorshipSection());
    // Attribute order on the rendered <a> isn't guaranteed to match JSX prop
    // order (Next's Link doesn't preserve it), so href and the visible text
    // are asserted independently rather than as one fixed-order pattern.
    expect(html).toMatch(/<a[^>]*href="\/mentorship"[^>]*>Find a mentor<\/a>/);
  });

  it("shows the real, current pricing floor — or correctly omits it — never a hardcoded figure", async () => {
    const live = await queryLiveApprovedPriceRange();
    const html = renderToStaticMarkup(await MentorshipSection());
    // send-401's NairaAmount wraps the ₦ sign in its own <span> (a real,
    // deliberate fix for Newsreader's missing glyph), so raw HTML doesn't
    // have "₦15,000" as one contiguous substring even when that's the
    // correct, visually-adjacent rendering — strip tags for text-content
    // assertions, the same way a reader (or a screen reader) experiences it.
    const text = html.replace(/<[^>]+>/g, "");

    // Never the stale build-prompt figures this replaces, regardless of
    // live state.
    expect(text).not.toContain("₦5,000");
    expect(text).not.toContain("100,000");

    if (live !== null) {
      expect(text).toContain(`₦${live.minNgn.toLocaleString("en-NG")}`);
      expect(text).toContain("Sessions from");
    } else {
      // The honest fallback: no price figure at all, not a guessed number
      // and not a silent revert to the old hardcoded ₦15,000.
      expect(text).not.toMatch(/₦[\d,]/);
      expect(text).toContain("Mentors set their own rates");
    }
  });

  it("is genuinely LIVE: a new lower-priced approved mentor changes the rendered floor on the next render", async () => {
    const before = await queryLiveApprovedPriceRange();
    // Guaranteed lower than anything currently live, and than the original
    // hardcoded ₦15,000 — proves this isn't just re-displaying that number
    // by coincidence.
    const fixturePriceNgn = before !== null ? Math.max(1000, before.minNgn - 5000) : 1234;

    const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
    const email = `mentor-section-pricing-${randomUUID()}@${domain}`;
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (userErr || !user) throw new Error(`fixture user creation failed: ${userErr?.message}`);

    try {
      const { error: mpErr } = await admin.from("mentor_profiles").insert({
        user_id: user.user.id,
        status: "approved",
        self_paused: false,
        base_price_ngn: fixturePriceNgn,
        bio: "send-403 mentorship-section live-pricing fixture",
      });
      if (mpErr) throw new Error(`fixture mentor_profiles insert failed: ${mpErr.message}`);

      const html = renderToStaticMarkup(await MentorshipSection());
      const text = html.replace(/<[^>]+>/g, "");
      expect(text).toContain(`₦${fixturePriceNgn.toLocaleString("en-NG")}`);
    } finally {
      const { error: deleteErr } = await admin.auth.admin.deleteUser(user.user.id);
      if (deleteErr) throw new Error(`cleanup failed, fixture user ${user.user.id} left behind: ${deleteErr.message}`);
    }

    // Reverted: the section no longer shows the fixture's price.
    const htmlAfter = renderToStaticMarkup(await MentorshipSection());
    expect(htmlAfter.replace(/<[^>]+>/g, "")).not.toContain(`₦${fixturePriceNgn.toLocaleString("en-NG")}`);
  });

  it("names no individual mentor and cites no fabricated or unverifiable stat", async () => {
    const html = renderToStaticMarkup(await MentorshipSection());
    // No session count, no satisfaction rating, no headcount claim — the
    // real numbers behind this section (2 mentors, 1 booked session) are
    // too thin to cite without reading as thin, per build prompt §6.1's own
    // rule against invented/undersupported social proof.
    expect(html).not.toMatch(/\d+\s*(sessions?|mentors?)\s*(booked|completed)/i);
    expect(html).not.toMatch(/\d+%\s*(satisfaction|rating)/i);
  });

  it("reuses the same high-stakes moment already established in Meet Farah, not an invented example", async () => {
    const html = renderToStaticMarkup(await MentorshipSection());
    expect(html).toContain("negotiating a real offer");
    expect(html).toContain("final-round interview");
  });
});
