/**
 * The ONE place an e2e fixture builds a service-role client (send-507).
 *
 * Refuses (via assertE2eDbTarget) BEFORE constructing anything, so a refused target never even gets a client. The authed fixture's
 * `admin` and every fixture that deletes go through here; tests/support/e2e-db-guard.test.ts fails if one calls createClient itself.
 */
import { createClient } from "@supabase/supabase-js";
import { assertE2eDbTarget } from "./db-guard";

export function createGuardedAdmin() {
  assertE2eDbTarget();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
