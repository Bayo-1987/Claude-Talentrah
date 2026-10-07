import "server-only";
import { cache } from "react";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isQaAccount } from "@/lib/profile/qa-account";

/** The identifying columns the two public reads below embed, so a QA mentor (owner-authorised test account on production) is neither priced nor counted. */
const PRICE_SELECT = "base_price_ngn, display_name, profiles!mentor_profiles_user_id_fkey(first_name, last_name, email)";

type PricedMentorRow = {
  base_price_ngn: number | null;
  display_name: string | null;
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
};

const isQaMentor = (row: PricedMentorRow): boolean =>
  isQaAccount({ email: row.profiles?.email, firstName: row.profiles?.first_name, lastName: row.profiles?.last_name, displayName: row.display_name });

/**
 * send-393 — the real, current session-price range among mentors a
 * signed-out visitor could actually book today, used only to keep the
 * public /mentorship page's pricing claims (metadata description and the
 * "Pricing" paragraph) honest. Deliberately its own file, not added to
 * mentorship/pricing.ts: that module is explicitly "pure pricing logic...
 * duplicated on purpose" to mirror `book_mentor_session`'s SQL with zero
 * I/O, and is unit-tested as pure functions (tests/mentorship/commission-
 * split.test.ts) — adding a DB-querying, service-role-backed function to it
 * would break that module's own stated contract for an unrelated concern.
 *
 * Before this fix, both the metadata description and the page's own
 * "Pricing" paragraph hardcoded "₦5,000"/"₦100,000+" — CLAUDE.md's
 * originally-stated ballpark range (₦5k–₦100k+) for the mentorship
 * programme in general, and PRICING_TIER_ANCHORS_NGN's senior.max
 * (mentorship/pricing.ts) for the upper bound — neither ever checked
 * against a mentor a visitor could actually book. Queried directly against
 * production: exactly two approved, non-paused mentors exist, min ₦15,000 /
 * max ₦20,000 — nowhere near either hardcoded number.
 *
 * ── WHY THE SERVICE-ROLE CLIENT, NOT THE USER'S OWN CLIENT ─────────────────
 *
 * `jobs/[id]/job-for-request.ts`'s own rule is "read through the user's own
 * client, never the service role — RLS is what decides whether this posting
 * is visible", and `mentor_profiles`' SELECT policy (0133) is `to
 * authenticated` only, with no `anon` grant at all — a signed-out request
 * against this table normally gets zero rows, by design. This function is a
 * deliberate, narrow exception, not a workaround of that rule: it returns
 * only an aggregate min/max across approved, bookable rows — never a row,
 * never a mentor's identity, never anything `mentor_public_names()` (0167)
 * itself doesn't already treat as the line between private and public. The
 * underlying RLS policy is left exactly as it is; widening it to let `anon`
 * read `mentor_profiles` directly would be the real privacy decision this
 * function is deliberately built to avoid making.
 *
 * `self_paused = false` matches browseMentors()'s own definition of
 * "actually bookable right now" (queries.ts) — an approved-but-paused
 * mentor is not a real answer to "what could a visitor book today". Rows
 * with a null or zero base_price_ngn (a free/volunteer mentor) are excluded
 * from the range on purpose: those are surfaced separately in the page's own
 * copy as "some mentors offer sessions for free or as volunteers", and
 * folding a 0 into "from ₦0" would misrepresent both claims at once.
 *
 * ── THE FALLBACK, DECIDED HERE ──────────────────────────────────────────
 *
 * Zero qualifying mentors is a future state, not the current one, but the
 * function must still behave sanely if it happens: returns `null` rather
 * than throwing or synthesizing a number, and both call sites drop the
 * price clause entirely rather than emitting "from ₦NaN a session" or,
 * worse, silently falling back to the exact stale hardcoded figures this
 * file exists to remove. A page that says nothing about price is honest;
 * one that guesses is the bug being fixed here, recreated as a fallback.
 *
 * ── send-472: A SUPABASE ERROR FAILS SOFT TOO, NOT JUST "ZERO ROWS" ───────
 *
 * This function runs at BUILD TIME, from the homepage's static prerender of
 * `/` (mentorship-section.tsx) — the exact exposure CLAUDE.md's own
 * send-441/443 write-up already names: "an empty service-role key doesn't
 * degrade one page, it fails the entire deployment." That write-up covered
 * one trigger (an empty key); a transient Supabase error is the same
 * exposure through a different trigger, and it happened for real —
 * production served a WEEK-OLD build while 13 consecutive deploys failed
 * here with `exceed_egress_quota` (send-472's own incident). The original
 * `if (error) throw` treated a transient read failure as fatal to the
 * entire site, which is backwards: a homepage pricing chip is not worth
 * more than the deployment pipeline itself.
 *
 * Same narrow scope sitemap.ts's own try/catch already uses (see that
 * file's three identical blocks): only the Supabase client error is
 * caught and logged, degrading to the same `null` "no price data yet"
 * fallback the zero-rows case already returns — never a caught bug in the
 * `.select()`/`.gt()` chain itself, which should still surface loudly in
 * development and in tests.
 */
export type { MentorPriceRangeNgn } from "./price-copy";
import type { MentorPriceRangeNgn } from "./price-copy";

export const getApprovedMentorPriceRangeNgn = cache(async (): Promise<MentorPriceRangeNgn | null> => {
  const supabase = createServiceRoleClient();
  try {
    const { data, error } = await supabase
      .from("mentor_profiles")
      .select(PRICE_SELECT)
      .eq("status", "approved")
      .eq("self_paused", false)
      .not("base_price_ngn", "is", null)
      .gt("base_price_ngn", 0);

    if (error) throw new Error(`getApprovedMentorPriceRangeNgn: ${error.message}`);

    const prices = ((data ?? []) as PricedMentorRow[])
      .filter((row) => !isQaMentor(row))
      .map((row) => row.base_price_ngn)
      // The query already excludes null and zero; keep that true here too, so a free or unpriced row can never become the minimum.
      .filter((price): price is number => price !== null && price > 0);

    if (prices.length === 0) return null;
    return { minNgn: Math.min(...prices), maxNgn: Math.max(...prices) };
  } catch (err) {
    // Logged, not fatal — see this function's own header. A homepage
    // pricing chip must never be able to fail the entire static build.
    console.error("[mentorship] could not read approved mentor price range:", err);
    return null;
  }
});

/**
 * Whether at least one approved, bookable mentor offers free or volunteer sessions (a null or zero base price: the same
 * definition the mentor cards use for "Free / volunteer"). The public page says "Some mentors offer sessions for free" only when
 * this is true; otherwise it states the policy ("Mentors can choose to ...") without implying it is happening now. Fails soft to
 * false for the same build-time reason as the range above: a read error must not fail a static prerender, and false is the
 * claim-nothing answer.
 */
export const getApprovedMentorsOfferFreeSessions = cache(async (): Promise<boolean> => {
  const supabase = createServiceRoleClient();
  try {
    const { data, error } = await supabase
      .from("mentor_profiles")
      .select(PRICE_SELECT)
      .eq("status", "approved")
      .eq("self_paused", false);
    if (error) throw new Error(`getApprovedMentorsOfferFreeSessions: ${error.message}`);
    return ((data ?? []) as PricedMentorRow[]).filter((row) => !isQaMentor(row)).some((row) => row.base_price_ngn === null || row.base_price_ngn === 0);
  } catch (err) {
    console.error("[mentorship] could not read whether any approved mentor offers free sessions:", err);
    return false;
  }
});
