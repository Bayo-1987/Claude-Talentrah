import type { Enums } from "@/lib/supabase/types";

/**
 * Which saved scholarships get a "closes in N days" reminder today.
 *
 * ── THE WINDOW ─────────────────────────────────────────────────────────────
 *
 * 5 days, not renewals.ts's 3 — a different domain with a different rhythm.
 * A Pass renewal is a single, predictable, recurring event a person already
 * expects; a scholarship application usually needs assembling documents,
 * possibly a recommendation letter, so it earns a slightly longer runway.
 * Named as its own constant rather than importing renewals.ts's
 * REMINDER_WINDOW_DAYS, because sharing a constant across two unrelated
 * domains is exactly the kind of coupling that makes changing one accidentally
 * change the other.
 *
 * ── "STILL IN THE FUTURE" INCLUDES TODAY ────────────────────────────────────
 *
 * The spec's own wording is "still in the future (don't alert on an
 * already-passed deadline)" — the parenthetical is the actual test: excluded
 * means already passed, not merely "not yet arrived". A deadline that closes
 * TODAY is the single most urgent case this feature exists to surface, not
 * one to suppress the day it matters most. So the window is inclusive at both
 * ends: 0 days out (closes today) through SCHOLARSHIP_DEADLINE_REMINDER_DAYS
 * days out, both included; a negative day count (already passed) is excluded.
 *
 * ── WHAT COUNTS AS "STILL INTENDS TO APPLY" ─────────────────────────────────
 *
 * `scholarship_save_status` has four values (0000 baseline): 'saved',
 * 'applying', 'submitted', 'outcome'. Only the first two mean the person has
 * not yet finished with this scholarship — 'submitted' means they already
 * sent their application (a deadline reminder is stale news, and arguably
 * alarming, to someone who already applied), and 'outcome' means the process
 * has concluded either way. Alerting either of those two is the exact kind of
 * "the product not knowing what you did" failure digest/select.ts's own
 * `alreadyActedOn` exclusion documents for the job digest.
 *
 * ── THE DEADLINE-VERIFICATION BAR ────────────────────────────────────────────
 *
 * `deadlineVerifiedAt === null` excludes a scholarship outright, matching the
 * only place this codebase already treats a deadline as trustworthy enough to
 * act on without a human: ingest.ts's auto-publish path
 * (`deadline_verified_at is not null && application_deadline is not null &&
 * application_deadline > today`). A "closes in N days" claim is exactly the
 * kind of specific, actionable promise that bar exists to protect — sending
 * it off an unverified date would be a best-guess dressed up as a fact.
 *
 * ── THE PUBLIC-VISIBILITY GATE, DONE BY HAND ────────────────────────────────
 *
 * `moderationStatus !== "verified"` also excludes a scholarship outright.
 * `scholarships` RLS only lets anon/authenticated read a row with
 * `moderation_status = 'verified'` (0000 baseline) — the scholarship detail
 * page reads through that RLS-enforced client and 404s otherwise
 * (loadPublicScholarship, src/lib/scholarships/public.ts). This job's own
 * sender runs on the service-role client, which bypasses RLS entirely, so
 * without this check a save whose scholarship was later un-verified (or
 * never left `pending`) would get emailed a link to a page that 404s for
 * them. CLAUDE.md's own history names this exact class of bug (0109,
 * `promoted_jobs` silently skipping the `organizations.verified` gate a
 * DEFINER function doesn't inherit for free) — checked here, in the pure and
 * tested function, rather than left to a SQL filter a future refactor could
 * drop without a test noticing.
 */

export const SCHOLARSHIP_DEADLINE_REMINDER_DAYS = 5;

export type ScholarshipSaveStatus = Enums<"scholarship_save_status">;

/** Statuses meaning "the person has not finished with this scholarship yet". */
const STILL_INTENDS_TO_APPLY: ReadonlySet<ScholarshipSaveStatus> = new Set(["saved", "applying"]);

export interface DeadlineAlertCandidate {
  saveId: string;
  userId: string;
  status: ScholarshipSaveStatus;
  /** Null means never sent — see this file's own header on why nothing ever resets it. */
  deadlineReminderSentAt: string | null;
  scholarshipId: string;
  programName: string;
  provider: string;
  /** ISO date (YYYY-MM-DD), or null when no deadline has ever been recorded. */
  applicationDeadline: string | null;
  /** Null means the deadline was never independently confirmed — see this file's own header. */
  deadlineVerifiedAt: string | null;
  officialUrl: string;
  moderationStatus: Enums<"scholarship_moderation_status">;
}

/** Whole calendar days from `today` (a YYYY-MM-DD string) to `dateStr`. Negative means already passed. */
function daysBetween(today: string, dateStr: string): number {
  const [ty, tm, td] = today.split("-").map(Number);
  const [dy, dm, dd] = dateStr.split("-").map(Number);
  const t = Date.UTC(ty, tm - 1, td);
  const d = Date.UTC(dy, dm - 1, dd);
  return Math.round((d - t) / 86_400_000);
}

/**
 * Pure. Takes `now` explicitly (default real time) so this is testable
 * without faking the system clock, matching this repo's own convention for
 * every other date-windowed selector (renewals.ts's own `addDaysDateOnly`,
 * digest/select.ts's `DIGEST_WINDOW_DAYS`).
 *
 * Generic over `T extends DeadlineAlertCandidate`, matching digest/select.ts's
 * `filterListablePostings` for the same reason that file's own comment gives:
 * send.ts's caller carries extra fields (`email`, `firstName`) this module has
 * no reason to know about, and a non-generic signature would silently narrow
 * the return type back to the base shape, dropping those fields from the type
 * even though the objects still carry them at runtime.
 */
export function selectDeadlineAlertCandidates<T extends DeadlineAlertCandidate>(
  saves: T[],
  now: Date = new Date(),
): T[] {
  const today = now.toISOString().slice(0, 10);

  return saves.filter((save) => {
    if (!STILL_INTENDS_TO_APPLY.has(save.status)) return false;
    if (save.deadlineReminderSentAt !== null) return false;
    if (save.moderationStatus !== "verified") return false;
    if (save.deadlineVerifiedAt === null) return false;
    if (save.applicationDeadline === null) return false;

    const daysOut = daysBetween(today, save.applicationDeadline);
    if (daysOut < 0) return false;
    if (daysOut > SCHOLARSHIP_DEADLINE_REMINDER_DAYS) return false;
    return true;
  });
}
