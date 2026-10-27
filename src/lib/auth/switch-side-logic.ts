import { parseSide, sideRoot, type Side } from "./side-preference";

/** What switching sides needs from the outside world, passed in so the rules can be tested without a server, a database or a cookie jar. */
export interface SwitchSideDeps {
  /** The signed-in user's id, or null when there is no session. */
  userId: () => Promise<string | null>;
  /** True when the user belongs to an organisation, read with the USER'S OWN client. A failed lookup must throw or answer false. */
  isMember: (userId: string) => Promise<boolean>;
  setSide: (side: Side) => void | Promise<void>;
  /** Redirects (throws, in Next.js). Called last, with a fixed constant only. */
  go: (path: "/jobs" | "/employer") => never;
}

/**
 * The rules of the switch, in the order they must hold:
 *  1. the value is exactly "seeker" or "employer", else nothing happens;
 *  2. there is a signed-in user, else nothing happens (no cookie, no redirect);
 *  3. "employer" additionally needs a membership found just now; a missing membership or a failed lookup refuses;
 *  4. the cookie is set, then the person is sent to the fixed home of that side.
 * A refusal changes nothing and says nothing: the page stays where it is.
 */
export async function switchSide(rawSide: unknown, deps: SwitchSideDeps): Promise<void> {
  const side = parseSide(rawSide);
  if (!side) return;

  const userId = await deps.userId();
  if (!userId) return;

  if (side === "employer") {
    let member = false;
    try {
      member = await deps.isMember(userId);
    } catch {
      member = false;
    }
    if (!member) return;
  }

  await deps.setSide(side);
  deps.go(sideRoot(side));
}
