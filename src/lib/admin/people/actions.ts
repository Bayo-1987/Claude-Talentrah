"use server";

import { requirePermission } from "@/lib/admin/require-admin";
import { countSignupsSince } from "./queries";

/**
 * How many signups have landed since the operator loaded the page.
 *
 * WHY THIS EXISTS AT ALL, and why it is not a websocket. "See who signs up as
 * it happens" on a support console means "do not make me hit refresh to find
 * out", not "sub-second". A poll returning one integer costs one indexed count
 * a minute; realtime push would mean a subscription, a connection to keep
 * alive, and a reconnect story, for a page an operator has open a few minutes a
 * day. If that reading is wrong the poll is easy to replace — nothing else
 * depends on its shape.
 *
 * IT DELIBERATELY WRITES NO AUDIT ENTRY. `people.listed` records access to
 * personal data; this returns a number and no rows, and an interval that logged
 * would fill the audit trail with entries nobody performed — an idle tab would
 * out-log a real operator within the hour, which makes the trail harder to read
 * for the exact question it exists to answer. Permission is still checked on
 * every call: it is a smaller answer, not an unguarded one.
 */
export async function countNewSignupsAction(sinceIso: string): Promise<number> {
  // Same grant as the page it belongs to (0103), not `people` — otherwise the
  // count would stay reachable to anyone with the billing lookup after the
  // split, which is a smaller leak of the same kind.
  await requirePermission("people_list");

  // Bounded, and validated rather than trusted: this reaches a query.
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return 0;

  return countSignupsSince(since.toISOString());
}
