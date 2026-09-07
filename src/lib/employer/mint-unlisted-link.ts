import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { canMintUnlistedLink } from "./job-visibility";

/**
 * Mint a private share link for one posting, at most once.
 *
 * ── MINT-ONCE IS THE WHOLE DESIGN, NOT AN OPTIMISATION ────────────────────
 *
 * The rate limit counts postings granted a link, not link views. If this
 * consumed a token every time the Jobs Posted page rendered, an employer
 * refreshing their own list five times would lock themselves out of their own
 * feature, and the limit would be measuring something nobody cares about.
 *
 * So the already-minted check comes FIRST, before the limit is touched: a
 * posting that already has `unlisted_at` returns it without consuming
 * anything. Only a genuinely new grant costs a token.
 *
 * ── WHY THE WRITE IS CONDITIONAL IN SQL ───────────────────────────────────
 *
 * `.is("unlisted_at", null)` on the update, not a read-then-write. Two
 * concurrent requests for the same never-minted posting would otherwise both
 * read null, both pass, and both spend a token for one grant. The condition
 * makes the second one a no-op at the database, which is the same reasoning
 * `spend_credits_atomic` (0035) exists for.
 */
export type MintResult =
  | { minted: true; unlistedAt: string }
  | { minted: false; unlistedAt: string; alreadyMinted: true }
  | { minted: false; unlistedAt: null; reason: "not_eligible" | "rate_limited" | "write_failed" };

export async function mintUnlistedLink(args: {
  jobId: string;
  userId: string;
  status: "open" | "closed" | "removed";
  emailConfirmed: boolean;
}): Promise<MintResult> {
  const admin = createServiceRoleClient();

  /*
   * ALREADY MINTED? Answer before spending anything. This is the branch that
   * makes re-viewing a link free, and it is checked against the row rather
   * than a cache so a link minted in another session still counts.
   */
  const { data: existing } = await admin
    .from("job_postings")
    .select("unlisted_at, status")
    .eq("id", args.jobId)
    .maybeSingle();

  if (existing?.unlisted_at) {
    // A posting removed AFTER minting stops being shareable, without the
    // stamp being cleared — the removal is the operator's decision and the
    // policy's `status <> 'removed'` already enforces it server-side.
    if (existing.status === "removed") {
      return { minted: false, unlistedAt: null, reason: "not_eligible" };
    }
    return { minted: false, unlistedAt: existing.unlisted_at, alreadyMinted: true };
  }

  // Eligibility that costs nothing to check goes before the metered call.
  if (!canMintUnlistedLink({ status: args.status, emailConfirmed: args.emailConfirmed, underRateLimit: true })) {
    return { minted: false, unlistedAt: null, reason: "not_eligible" };
  }

  const outcome = await consumeRateLimit(args.userId, "unlistedLinkMint");
  if (!outcome.allowed) {
    return { minted: false, unlistedAt: null, reason: "rate_limited" };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("job_postings")
    .update({ unlisted_at: now })
    .eq("id", args.jobId)
    .is("unlisted_at", null)
    .neq("status", "removed")
    .select("unlisted_at")
    .maybeSingle();

  if (error) {
    console.error("[unlisted-link] mint write failed", args.jobId, error);
    return { minted: false, unlistedAt: null, reason: "write_failed" };
  }

  /*
   * No row came back: something else minted it between the read above and
   * this update, or the posting was removed in that window. Re-read rather
   * than guess — if a link now exists, the employer should get it, even
   * though this call is the one that paid for it.
   */
  if (!updated?.unlisted_at) {
    const { data: raced } = await admin
      .from("job_postings")
      .select("unlisted_at, status")
      .eq("id", args.jobId)
      .maybeSingle();
    if (raced?.unlisted_at && raced.status !== "removed") {
      return { minted: false, unlistedAt: raced.unlisted_at, alreadyMinted: true };
    }
    return { minted: false, unlistedAt: null, reason: "not_eligible" };
  }

  return { minted: true, unlistedAt: updated.unlisted_at };
}
