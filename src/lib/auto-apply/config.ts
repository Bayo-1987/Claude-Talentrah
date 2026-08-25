/**
 * Auto-Apply's policy numbers, in one place, stated rather than implied.
 *
 * Every value here is a `[DECIDE]`-shaped call the spec left to the builder.
 * They are constants in server code, deliberately NOT columns a user can set:
 * build-prompt §8 requires the cap to be real, and "the user picks their own
 * cap" is not a cap. Changing any of these is a code change and a code review.
 */

/**
 * THRESHOLD — Excellent only.
 *
 * build-prompt §6.2 asks for a "conservative match threshold"; the design
 * system fixes exactly three tiers (Excellent ≥80, Good 70–79, Fair 60–69) and
 * forbids inventing a fourth, so the only conservative choices were "Excellent"
 * or "Excellent + Good". Excellent alone, because the failure mode this feature
 * must not have is an application the user would be embarrassed by — a Good
 * match is a job worth *reading*, not one worth applying to unattended.
 *
 * Read from `match_scores`, which no client can write (migration 0031).
 */
export const AUTO_APPLY_MIN_SCORE = 80;

/**
 * DAILY CAP — 5 confirmed internal submissions per rolling 24 hours.
 *
 * Rolling rather than calendar-day: a midnight boundary lets someone send 10 in
 * a few minutes, which is exactly the burst this is meant to prevent. Counted
 * server-side from `auto_apply_queue.decided_at`, never from anything the
 * client sends.
 */
export const AUTO_APPLY_DAILY_SUBMIT_CAP = 5;

/**
 * QUEUE CAP — at most 20 pending items.
 *
 * Not a safety limit, a usability one: a review queue nobody can get to the
 * bottom of is a queue people stop reviewing, and an unreviewed queue turns
 * review-before-submit back into the volume feature §2.3 says not to build.
 */
export const AUTO_APPLY_MAX_PENDING = 20;

/**
 * FREE LINE — 5 free confirmed submissions per rolling 7 days, then credits.
 *
 * build-prompt §6.9 puts "auto-apply beyond a free cap" on Credits without
 * naming the cap. 5/week sits just under the daily cap so a normal week of use
 * is free and sustained heavy use is priced, which matches how the free
 * tailoring trial is positioned. The price itself is not invented here:
 * `CREDIT_COSTS.autoApplySubmission` (2 credits) was already on the anchor list.
 */
export const AUTO_APPLY_FREE_PER_WEEK = 5;

/**
 * External postings are NEVER charged and never count against the daily cap.
 *
 * Talentrah has no ATS integration and cannot submit to Greenhouse or Lever on
 * a user's behalf, so confirming an external match hands the user to the source
 * posting to finish themselves. Charging for a hand-off — or counting it
 * against a submission cap — would be charging for a link.
 */
export const AUTO_APPLY_CHARGES_EXTERNAL = false;
