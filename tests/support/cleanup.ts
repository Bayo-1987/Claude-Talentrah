import { admin } from "./auth";
import { deleteOrgsCascade } from "./delete-orgs";

/**
 * Suite-facing teardown: `deleteOrgsCascade` bound to the shared test admin
 * client. The FK order and the reason it exists live in ./delete-orgs.ts,
 * which scripts/cleanup-test-orgs.ts shares so the one-time purge and the
 * per-run teardown cannot drift apart.
 */
export async function deleteTestOrgs(orgIds: string[]): Promise<void> {
  return deleteOrgsCascade(admin, orgIds);
}
