import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Per-user request rate limiting for the routes that spend money per call.
 *
 * The counter itself is atomic in Postgres (migration 0038) — a read-then-
 * increment in JS would let concurrent requests all see the same count and all
 * pass, which is the exact failure this is meant to prevent.
 */

export const RATE_LIMITS = {
  /** Paid model call + document generation. Generous for real use, fatal to a loop. */
  tailoring: { limit: 10, windowSeconds: 60 * 60 },
  /*
   * A BURST bound in front of the hourly cap above (QA TAILOR-RACE-2). The credit gate only reads the balance and the atomic spend comes after the model has run, so N simultaneous requests with credit for ONE run
   * start N model runs and the losers are refused after the cost. Two per 15 seconds, per user, lets at most two start however many arrive together (the counter is atomic; every call counts). The tailoring form
   * disables its button while a request is pending, so a double click, or a retry after one failure, fits inside two; three starts in 15 seconds is not ordinary use. It is a tumbling window like the others, so
   * a flood that straddles a boundary can start up to four: still bounded, and the hourly cap of 10 sits behind it. It does not measure runs in flight (a run lasts up to 45 s); it bounds how fast they can start.
   */
  tailoringBurst: { limit: 2, windowSeconds: 15 },
  /** Parsing is cheap until the LLM fallback fires, which is per-upload. */
  resumeParse: { limit: 20, windowSeconds: 60 * 60 },
  /*
   * Private share links minted by an UNVERIFIED org (0107).
   *
   * Tighter than the two above, and for a different reason. Those protect
   * spend — the failure is a bill. This protects the domain's name: every mint
   * turns an unvetted signup's posting into a live, Talentrah-branded public
   * URL, and the failure is a spam link carrying our name, which is worse per
   * event than one wasted model call.
   *
   * Five distinct JOBS per day, not five clicks: minting happens once per
   * posting, so re-viewing a link already minted costs nothing. A real
   * employer setting up has a handful of roles; five in one day before
   * verifying is already brisk.
   *
   * The window is a fixed UTC-aligned tumbling bucket, not rolling —
   * `consume_rate_limit` (0038) floors epoch/window. So five at 23:50 and five
   * more at 00:10 is reachable. Accepted deliberately: it is the same
   * trade-off already live for both buckets above, and narrowing it means
   * changing shared infrastructure for one caller.
   */
  unlistedLinkMint: { limit: 5, windowSeconds: 60 * 60 * 24 },
  /*
   * Banner uploads (0115). Counted per employer, per day.
   *
   * Tighter than resumeParse's 20/h because the cost is different in kind: a
   * resume parse spends CPU and is discarded, while a banner lands in a public
   * bucket and is then served on every view of that posting. 20 is generous
   * against the real use — an employer with a handful of live postings,
   * re-cropping one a few times — and it bounds how fast a single account can
   * fill a free-plan bucket nobody is watching yet.
   */
  jobBannerUpload: { limit: 20, windowSeconds: 60 * 60 * 24 },
  /*
   * Assessment exercise uploads (0177, widened to up to 5 files per
   * posting by 0178/send-364 — was 0-or-1). Bumped from 20 to 40/day for
   * the same reason: one posting can now take up to 5 calls to this route
   * instead of 1, and the create-flow's own deferred upload
   * (post-success-assessment-files-note.tsx) can make several of those
   * calls back-to-back right after publishing. Still generous against real
   * use (a handful of live postings, each attaching a handful of files a
   * few times) and still bounds how fast one account could fill a
   * free-plan bucket.
   */
  jobAssessmentExerciseUpload: { limit: 40, windowSeconds: 60 * 60 * 24 },
  /*
   * Removing one previously-uploaded exercise file (0178/send-364). Higher
   * than the upload limit on purpose: a delete is cheap (no storage
   * validation, no bytes read) and the realistic abuse case — repeatedly
   * deleting your own org's own files — costs the abuser nothing to gain,
   * so this exists to bound accidental loops, not to ration a scarce or
   * costly action the way the upload limit does.
   */
  jobAssessmentExerciseDelete: { limit: 60, windowSeconds: 60 * 60 * 24 },
  /*
   * Assessment response uploads (0177) — a candidate attaching their
   * answer to one posting's assessment as part of applying. Same limit as
   * resumeParse: a real applicant uploads at most a handful of times a day
   * (one per application, plus the occasional "wrong file, try again").
   */
  jobAssessmentSubmissionUpload: { limit: 20, windowSeconds: 60 * 60 * 24 },
  /*
   * "Email me this receipt" on the billing page. Each call sends one real email from billing@talentrah.com, to the account's OWN
   * address only, so the abuse case is someone filling their own inbox and spending the sending quota: bounded, not prevented, by a
   * per-user cap. Five a day covers a real person who lost an email and asked a couple of times; it is not a limit anyone doing
   * something ordinary reaches. consumeRateLimit fails CLOSED, so an unreadable counter sends nothing.
   */
  receiptResend: { limit: 5, windowSeconds: 60 * 60 * 24 },
} as const;

export interface RateLimitOutcome {
  allowed: boolean;
  used: number;
  resetsAt: string | null;
}

export async function consumeRateLimit(
  userId: string,
  bucket: keyof typeof RATE_LIMITS,
): Promise<RateLimitOutcome> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const admin = createServiceRoleClient();

  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    /*
     * Fail CLOSED, matching how Farah's own limit is documented to behave: a
     * counter that cannot be read is not evidence of headroom. The alternative
     * — treating a database blip as "allowed" — turns the one failure mode
     * that most plausibly coincides with heavy load into an open gate.
     */
    console.error(`[rate-limit] ${bucket} check failed, denying:`, error);
    return { allowed: false, used: limit, resetsAt: null };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, used: limit, resetsAt: null };
  return { allowed: row.allowed, used: row.used, resetsAt: row.resets_at };
}

/** The 429 body, shared so the routes answer identically unless one has a clearer thing to say (`message`: what the person should read in place of the generic line). */
export function rateLimited(outcome: RateLimitOutcome, message?: string): NextResponse {
  return NextResponse.json(
    { error: message ?? "That's a lot of requests in a short time — give it a little while and try again." },
    {
      status: 429,
      headers: outcome.resetsAt
        ? { "Retry-After": String(Math.max(1, Math.ceil((new Date(outcome.resetsAt).getTime() - Date.now()) / 1000))) }
        : {},
    },
  );
}
