import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ImportWriteClient } from "./write";

/**
 * The service-role client of the jobs uploader, and nothing else. Only the two route files import this module, and only LAZILY, inside the `service` provider they hand to the handler
 * (`await import(".../deps")`), which the handler calls only after its permission check has passed. So a request that is not an admin with `jobs_import` never loads the module, let
 * alone creates the client. tests/jobs-import/wiring.test.ts pins that.
 */
export function realService(): ImportWriteClient {
  return createServiceRoleClient() as unknown as ImportWriteClient;
}
