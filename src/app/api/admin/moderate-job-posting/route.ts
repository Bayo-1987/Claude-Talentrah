import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdminSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Take a scam posting off the board, and put it back.
 *
 * Deliberately the same shape as /api/admin/moderate-campaign and
 * /api/admin/moderate-scholarship rather than a new one: shared-secret auth, a
 * POST that decides one item. A review UI is not in scope; the ability to act
 * is, and a moderation power with no way to exercise it is one that gets
 * exercised by hand in the SQL console instead.
 *
 * POST — { id, action: "remove" | "restore", reason }
 *
 * WHY RESTORE GOES TO `closed`, NOT `open`.
 *
 * Restoring says "this should not have been removed". It does not say "this
 * job is live right now", and those are different claims — the posting may
 * have been removed weeks ago and genuinely ended since. Landing in `closed`
 * means one authority puts a job back in FRONT of people, and it is the one
 * that actually knows: for an external posting the next ingest run reopens it
 * if and only if the source is still serving it, and for an internal one the
 * employer reopens it themselves. Restoring straight to `open` would have this
 * route re-advertising a job on the strength of a moderation reversal.
 *
 * WHY THE STATE CHECK IS IN THE `WHERE` CLAUSE.
 *
 * "Remove it if it is not already removed" is a comparison, and a
 * read-then-write in TypeScript is not a gate — the pattern this repo has been
 * bitten by (spendCredits, 0035). Both verbs are a single conditional UPDATE,
 * so two operators clicking at once produce one state change and one 409, not
 * two removals with different reasons.
 *
 * ON AUTHORSHIP. The same honest null as moderate-campaign: this route
 * authenticates with a SHARED SECRET, which proves "an operator" and not
 * "which operator". `removal_reason` therefore records WHY and not WHO, and
 * the route does not accept an operator id — a caller-supplied one would be a
 * self-asserted claim rendered as attribution, which is worse than a visible
 * absence.
 */

const ACTIONS = ["remove", "restore"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(v: unknown): v is Action {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let body: { id?: string; action?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { id, action, reason } = body;
  if (!id || !isAction(action)) {
    return NextResponse.json(
      { error: 'Requires { id, action } where action is "remove" or "restore".' },
      { status: 400 },
    );
  }
  if (!reason?.trim()) {
    // Both directions need one. A removal with no reason leaves the employer
    // with nothing to answer and the next operator with nothing to check; a
    // restore with no reason leaves no record of why a removal was reversed,
    // which is the only thing that makes a bad removal auditable.
    return NextResponse.json(
      { error: "Both remove and restore need a reason." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  /*
   * One statement each, and the state condition lives in `.eq`/`.neq` so the
   * database decides. `select("id")` afterwards reports what actually changed:
   * zero rows means the posting was already in the target state (or does not
   * exist), which is a 409 rather than a lie about having done something.
   */
  const query =
    action === "remove"
      ? supabase
          .from("job_postings")
          .update({
            status: "removed" as const,
            removed_at: new Date().toISOString(),
            removal_reason: reason.trim(),
          })
          .eq("id", id)
          .neq("status", "removed")
      : supabase
          .from("job_postings")
          .update({
            // `closed`, not `open` — see the note above.
            status: "closed" as const,
            // Cleared in the SAME statement on purpose: the
            // preserve_job_posting_removal trigger only lets a row leave
            // `removed` when removed_at goes null with it, which is what stops
            // the nightly ingest quietly un-removing a scam listing.
            removed_at: null,
            removal_reason: null,
          })
          .eq("id", id)
          .eq("status", "removed");

  const { data, error } = await query.select("id, title, company_name, status");
  if (error) return internalError("moderate-job-posting:decide", error);

  if (!data || data.length === 0) {
    const { data: current } = await supabase
      .from("job_postings")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    return NextResponse.json(
      {
        error: !current
          ? "No posting with that id."
          : action === "remove"
            ? "That posting is already removed."
            : "That posting isn't removed, so there's nothing to restore.",
      },
      { status: 409 },
    );
  }

  const row = data[0];
  return NextResponse.json({
    ok: true,
    id: row.id,
    status: row.status,
    posting: { title: row.title, company: row.company_name },
    // Said explicitly because it is the part an operator will assume wrongly.
    note:
      action === "remove"
        ? "Removed. The owning organisation can still see it and the reason; the public cannot. External postings become invisible to everyone."
        : "Restored to `closed`, not `open` — an external posting reopens on the next ingest run if its source still lists it, and an internal one is the employer's to reopen.",
  });
}
