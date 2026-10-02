/**
 * Runs once, before any spec loads (send-507): refuse a database e2e has no business writing to.
 * Covers every spec, including the ones that build their own service-role client instead of using the guarded factory.
 */
import { assertE2eDbTarget } from "./fixtures/db-guard";

export default async function globalSetup(): Promise<void> {
  assertE2eDbTarget();
}
