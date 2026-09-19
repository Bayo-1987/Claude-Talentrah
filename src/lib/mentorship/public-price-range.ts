import "server-only";
import { cache } from "react";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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
 */
export interface MentorPriceRangeNgn {
  minNgn: number;
  maxNgn: number;
}

export const getApprovedMentorPriceRangeNgn = cache(async (): Promise<MentorPriceRangeNgn | null> => {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("base_price_ngn")
    .eq("status", "approved")
    .eq("self_paused", false)
    .not("base_price_ngn", "is", null)
    .gt("base_price_ngn", 0);

  if (error) throw new Error(`getApprovedMentorPriceRangeNgn: ${error.message}`);

  const prices = (data ?? [])
    .map((row) => row.base_price_ngn)
    .filter((price): price is number => price !== null);

  if (prices.length === 0) return null;
  return { minNgn: Math.min(...prices), maxNgn: Math.max(...prices) };
});
