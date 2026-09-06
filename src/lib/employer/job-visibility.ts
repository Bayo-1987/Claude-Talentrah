/**
 * Whether a posting's link is something an employer can hand out.
 *
 * Deliberately a named state, not a bare boolean threaded through props —
 * "public" vs. "unreachable" is not the only distinction this could ever
 * need. There's an open founder decision (see verification.ts's own header
 * for the sibling case of an open decision) on whether to add an "unlisted"
 * state: not in the feed, search or sitemap, but reachable by whoever has the
 * direct link — e.g. for an org mid-verification who still wants to send a
 * link to one candidate. That state isn't built here (see
 * docs/employer-share-and-verification.md for the abuse-surface writeup this
 * would need first), but a caller that already switches on a named result
 * only needs a new case added, not a boolean it doesn't fit into.
 *
 * Mirrors the actual RLS policy on job_postings (migration 0056) exactly,
 * rather than reimplementing "verified means public" from memory: a posting
 * is publicly readable when the org is verified AND the row isn't removed —
 * closed is NOT excluded, because /jobs/[id] still renders a closed posting
 * (it just says so), so a closed job's link is not dead.
 */
export type JobShareVisibility = "public" | "unreachable";

export function getJobShareVisibility(args: {
  status: "open" | "closed" | "removed";
  organizationVerified: boolean;
}): JobShareVisibility {
  if (args.status === "removed") return "unreachable";
  if (!args.organizationVerified) return "unreachable";
  return "public";
}
