/**
 * Whether a posting's link is something an employer can hand out.
 *
 * Deliberately a named state, not a bare boolean threaded through props. That
 * shape paid off: `"unlisted"` was written into this header as a hypothetical
 * and has now been built (0107), and every caller needed a new case rather
 * than new plumbing.
 *
 * ── THE THREE STATES ──────────────────────────────────────────────────────
 *
 *   public       the org is verified: in the feed, in search, in the sitemap.
 *   unlisted     reachable by direct link only. NOT in the feed, search or
 *                sitemap. For an org mid-verification with a candidate to
 *                send a link to.
 *   unreachable  nothing to share. No link, no copy affordance — an employer
 *                shown a link that 404s is worse off than one shown nothing.
 *
 * Mirrors the actual RLS policy on job_postings (0056, extended by 0107)
 * rather than reimplementing it from memory: publicly readable when the org is
 * verified, OR `unlisted_at` is set — and in both cases the row isn't removed.
 * `closed` is NOT excluded, because /jobs/[id] still renders a closed posting
 * and says so, so a closed job's link is not dead.
 */
export type JobShareVisibility = "public" | "unlisted" | "unreachable";

/**
 * The pure rule, with no database in it, so every branch is testable.
 *
 * `unlistedAt` is the state ALREADY on the row. Deciding whether a posting may
 * be minted for the first time is a separate question with side effects, and
 * lives in `mintUnlistedLink` — keeping the two apart is what makes "minting
 * happens once per job, not once per share-button click" checkable rather than
 * a claim about call sites.
 */
export function getJobShareVisibility(args: {
  status: "open" | "closed" | "removed";
  organizationVerified: boolean;
  /** Non-null once a private link has been minted for this posting (0107). */
  unlistedAt?: string | null;
}): JobShareVisibility {
  // First, and shared by every branch of the policy: a removed posting is
  // reachable by nobody, whatever else is true of it.
  if (args.status === "removed") return "unreachable";
  if (args.organizationVerified) return "public";
  if (args.unlistedAt) return "unlisted";
  return "unreachable";
}

/**
 * Whether this account is allowed to mint a link it does not yet have.
 *
 * Pure, so the gate can be tested without a database or a rate-limit table.
 * The caller supplies the two facts; this states the rule.
 *
 * A CONFIRMED EMAIL IS THE BAR, deliberately lower than domain verification.
 * Domain verification proves which company you belong to. This proves only
 * that a real mailbox is attached to the account, which is what makes a
 * throwaway signup cost something. Requiring domain verification here would
 * make the feature unreachable for exactly the accounts it exists to serve.
 */
export function canMintUnlistedLink(args: {
  status: "open" | "closed" | "removed";
  emailConfirmed: boolean;
  underRateLimit: boolean;
}): boolean {
  if (args.status === "removed") return false;
  if (!args.emailConfirmed) return false;
  return args.underRateLimit;
}
