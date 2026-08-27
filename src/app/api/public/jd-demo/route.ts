import { NextResponse } from "next/server";
import { tailorResumeToJob } from "@/lib/tailoring/tailor";
import { SAMPLE_RESUME } from "@/lib/demo/sample-resume";
import {
  ANON_DEMO_DAILY_CAP,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE,
  claimAnonymousRun,
  clientIp,
  hashIp,
  newVisitorId,
  parseVisitorId,
  releaseAnonymousRun,
} from "@/lib/demo/anonymous-limit";

/**
 * The pre-signup demo (§6.1): one real tailoring run, no account.
 *
 * A SEPARATE ROUTE, not a branch inside /api/tailoring. That route's whole
 * body is about a signed-in user — session, credit allowance, free-trial
 * flags, persisting a `resumes` row, a `job_tailoring_requests` row. Every one
 * of those is wrong here, and threading an `anonymous` flag through it would
 * put "skip the credit check" inside the file whose job is enforcing the
 * credit check. Two files that share `tailorResumeToJob` is the smaller risk.
 *
 * WHAT IS DELIBERATELY SKIPPED, and what replaces it:
 *
 *   credit gate / free trial   replaced by the one-run-ever limit (0058).
 *   persisting the result      nothing to attach it to. The visitor gets the
 *                              tailored resume in the response and nowhere
 *                              else; keeping it would mean storing a stranger's
 *                              pasted job description indefinitely.
 *   job_tailoring_requests     same reason — it is keyed on a user.
 *   cover letter               never. §6.9 makes the first cover letter a
 *                              one-time trial for an ACCOUNT; giving one away
 *                              here would spend a benefit the signup flow is
 *                              built around, and it is a second model call.
 *
 * COST. Every accepted request is a real call on the shared model key that
 * CLAUDE.md records as free-tier Gemini, 20/day, shared with signed-in
 * tailoring and Farah. The daily ceiling in 0058 is what keeps a good day on
 * the landing page from being an outage for paying users, and it is claimed
 * BEFORE the model call rather than after.
 */

/** A little above the 50-char floor, to catch a pasted link and nothing else. */
const URL_ONLY = /^https?:\/\/\S+$/i;

function jsonWithVisitor(body: unknown, status: number, visitorId: string, isNew: boolean) {
  const response = NextResponse.json(body, { status });
  if (isNew) {
    /*
     * httpOnly so page scripts cannot read or forge it, sameSite lax so it
     * survives a normal navigation back to the landing page, and secure in
     * production only — localhost is http and the cookie would be dropped.
     */
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: VISITOR_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return response;
}

export async function POST(request: Request) {
  const existingVisitor = parseVisitorId(
    request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${VISITOR_COOKIE}=`))
      ?.slice(VISITOR_COOKIE.length + 1),
  );
  const visitorId = existingVisitor ?? newVisitorId();
  const isNewVisitor = existingVisitor === null;
  const ipHash = hashIp(clientIp(request));

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonWithVisitor({ error: "Malformed request body." }, 400, visitorId, isNewVisitor);
  }

  const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";

  /*
   * A pasted link is refused with an explanation rather than silently treated
   * as a job description. Nothing in this codebase fetches a URL — §6.1's
   * "paste a URL" half is Phase 2 — so a link would otherwise be sent to the
   * model as literal text and produce confident nonsense about a job nobody
   * read. The input's own placeholder no longer offers "job link" either;
   * this is the backstop for a visitor who pastes one anyway.
   */
  if (URL_ONLY.test(jdText)) {
    return jsonWithVisitor(
      {
        error:
          "We can't open a link yet — paste the job description text itself and Farah will work from that.",
      },
      400,
      visitorId,
      isNewVisitor,
    );
  }

  if (jdText.length < 50) {
    return jsonWithVisitor(
      { error: "Paste the full job description — that looked too short." },
      400,
      visitorId,
      isNewVisitor,
    );
  }

  // Claimed before the model call, never after: the point is to bound spend on
  // a shared key, and a limit checked afterwards has already been exceeded.
  const claim = await claimAnonymousRun(ipHash, visitorId);
  if (!claim.allowed) {
    /*
     * THREE REFUSALS, THREE STATUSES — not one bucket.
     *
     * `error` and `no_identifier` are OUR failure, not the visitor's, and
     * collapsing them into the same 429 as `daily_cap` made the client tell a
     * first-time visitor they had already used their free run. Caught by
     * running it: the service-role key was misconfigured, the claim failed
     * closed exactly as designed, and the page then said "you've already used
     * the free preview" to someone who had never been there.
     *
     * 503 says "us, temporarily" — which is the truth, and which the client
     * renders as a retryable error with the run explicitly not consumed.
     */
    const status =
      claim.reason === "already_used" ? 403 : claim.reason === "daily_cap" ? 429 : 503;
    return jsonWithVisitor(
      {
        error:
          claim.reason === "already_used"
            ? "You've already used the free preview. Create a free account to keep tailoring."
            : claim.reason === "daily_cap"
              ? `The free preview is capped at ${ANON_DEMO_DAILY_CAP} runs a day and today's are gone. Create a free account to tailor now.`
              : "The free preview isn't available right now — try again shortly.",
        reason: claim.reason,
        // Nothing was spent: the claim never succeeded.
        runConsumed: false,
      },
      status,
      visitorId,
      isNewVisitor,
    );
  }

  let result;
  try {
    result = await tailorResumeToJob(SAMPLE_RESUME, jdText, false);
  } catch (err) {
    // Give the run back. A visitor whose one lifetime attempt died on our
    // error has not had the demo, and telling them they've used it would be
    // the worst possible first impression on the page meant to convert them.
    await releaseAnonymousRun(ipHash, visitorId);
    console.error("[anon-demo] tailoring failed", err);
    return jsonWithVisitor(
      {
        error: "Farah couldn't read that one — try again in a moment.",
        // Read by the client to say so plainly rather than leaving the visitor
        // to guess whether they just burned their one run.
        runConsumed: false,
      },
      502,
      visitorId,
      isNewVisitor,
    );
  }

  return jsonWithVisitor(
    {
      // Explicitly enumerated, not spread. `tailorResumeToJob` returns
      // `coverLetter` in its shape and a spread would ship it the day someone
      // changes the default — the test asserting no cover letter would still
      // pass, because we asked for none and got null. Naming the fields makes
      // the omission structural rather than dependent on an argument.
      structuredJd: result.structuredJd,
      gapAnalysis: result.gapAnalysis,
      tailoredResume: result.tailoredResume,
      atsScore: result.atsScore,
      atsFixes: result.atsFixes,
      jdTruncation: result.jdTruncation,
      /** Said in the payload because the framing matters: this is not their resume. */
      scoredAgainst: "sample" as const,
    },
    200,
    visitorId,
    isNewVisitor,
  );
}
