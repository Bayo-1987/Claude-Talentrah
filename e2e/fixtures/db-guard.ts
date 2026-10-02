/**
 * Refuse to run e2e against a database it has no business writing to (send-507).
 *
 * tests/setup.ts applies scripts/db-target.ts's refuse-production rule to the Vitest suites. The Playwright side had nothing: the
 * authed fixture built its admin client from the environment, 18 specs build their own service-role clients, and fixtures delete rows
 * (every authed test deletes its user; clearDemoFarahThread deletes a conversation). This is the same rule for e2e, with its own opt-in
 * names so an opt-in typed for the Vitest suites does not open this one.
 *
 * TWO CHECKS, because the URL is not the whole story. NEXT_PUBLIC_SUPABASE_URL names the project the app talks to, but the
 * service-role KEY is what the fixtures delete WITH, and a key carries the project it belongs to in its `ref` claim. CLAUDE.md records
 * that the two can disagree, so a production key behind a local-looking URL is refused too.
 */
import { assertAllowedDbTarget, describeDbTarget, PRODUCTION_REF, type DbTarget } from "../../scripts/db-target";

/** The project ref inside a Supabase JWT (`ref` claim), or null for a local-stack key, a malformed token, or nothing. */
export function serviceKeyProjectRef(key: string | undefined): string | null {
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

export function assertE2eDbTarget(): DbTarget {
  const target = assertAllowedDbTarget({
    context: "e2e suite",
    productionEscapeHatch: "ALLOW_E2E_AGAINST_PRODUCTION",
    hostedEscapeHatch: "ALLOW_E2E_AGAINST_HOSTED",
  });

  // The URL passed (a local stack, an allowed opt-in, or something unrecognised). The KEY must not be production's unless the
  // production opt-in was typed: a production key behind a non-production URL is exactly the disagreement that deletes real rows.
  if (
    serviceKeyProjectRef(process.env.SUPABASE_SERVICE_ROLE_KEY) === PRODUCTION_REF &&
    describeDbTarget().kind !== "production" &&
    process.env.ALLOW_E2E_AGAINST_PRODUCTION !== "yes-i-mean-it"
  ) {
    throw new Error(
      [
        "",
        "Refusing to run the e2e suite: SUPABASE_SERVICE_ROLE_KEY is a service-role key for PRODUCTION",
        `(${PRODUCTION_REF}), while NEXT_PUBLIC_SUPABASE_URL points somewhere else (${target.label}).`,
        "",
        "  The URL and the key disagree. The fixtures delete with the KEY, so this would delete production rows.",
        "  Fix: use the key that belongs to the stack the URL names (npm run db:local prints both).",
        "",
      ].join("\n"),
    );
  }
  return target;
}
