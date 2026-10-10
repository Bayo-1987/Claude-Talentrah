import { revalidatePath } from "next/cache";
import { isUuid } from "./widget-html";

/**
 * Purges the employer job-list widget's cached page for an organisation (plan v2.1, owner-approved 7 Oct 2026).
 *
 * The embed route (src/app/embed/jobs/[orgId]/route.ts) is cached per organisation for 30 minutes. Every place that changes what it shows calls this next to its existing
 * `revalidatePath("/jobs")`, so a closed, edited, deleted or newly posted job reaches the embedded list in seconds, not at the TTL. `revalidatePath` on a route path also purges
 * the platform's edge copy.
 *
 * NEVER FAILS THE CALLER. The employer's close, edit or delete has already happened; a purge that throws (outside a request, or a platform hiccup) must not turn it into an error
 * page. Worst case the embedded list is up to 30 minutes stale, which is the TTL anyway.
 *
 * Deliberately not covered, because no TypeScript caller is in their path: account deletion, supersession (0202) and the organisation-rename trigger (0216). Those show up at the next TTL.
 */
export const embedPathFor = (organizationId: string): string => `/embed/jobs/${organizationId}`;

export function revalidateEmbed(organizationId: string | null | undefined): void {
  if (!organizationId || !isUuid(organizationId)) return;
  try {
    revalidatePath(embedPathFor(organizationId));
  } catch {
    // Not fatal, see above.
  }
}

/** Each distinct organisation once; one failing purge does not stop the rest. */
export function revalidateEmbedForOrganizations(organizationIds: ReadonlyArray<string | null | undefined>): void {
  for (const id of new Set(organizationIds)) revalidateEmbed(id);
}
