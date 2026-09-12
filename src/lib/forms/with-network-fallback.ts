/**
 * Wraps a `useActionState` action so a request that never reaches the
 * server — a dropped connection, an aborted fetch, any rejection that
 * happens before the action returns a normal value — resolves to that
 * value instead of an uncaught throw.
 *
 * WHY THIS HAS TO SIT AT THE CLIENT CALL SITE, NOT INSIDE THE SERVER ACTION.
 * React draws a hard line for `useActionState`: an action that RETURNS a
 * value (even one that means "this failed") updates the hook's state
 * normally, but an action that REJECTS/THROWS escalates straight to the
 * nearest Error Boundary. A `"use server"` action's own try/catch only ever
 * sees a failure that reached the server — a transport-level failure (the
 * request aborted, the connection dropped) never gets that far, so nothing
 * inside the action itself can produce a graceful `{status:"error"}`-shaped
 * result for a case like that. The only place that CAN see the rejection is
 * the client-side reference the form actually calls, which is what this
 * wraps.
 *
 * Found via send-183/tracker-notes.spec.ts's "the typed text survives a dead
 * network" test: it passed when run after certain other specs and failed
 * run alone or after others — an order dependence that turned out to mean
 * the failure path (React's own escalation to the nearest Error Boundary,
 * Next's generic "This page couldn't load") was real all along and the test
 * only sometimes exercised it, not that the bug was intermittent itself.
 *
 * Deliberately catches EVERY rejection, not just recognizably-network ones
 * — there is no reliable way to tell "the request never left the browser"
 * apart from "the server threw and Next re-threw it client-side" once it is
 * just a rejected promise at this call site. For a form whose whole point
 * is preserving what the user typed, treating both the same way (keep the
 * draft, show a retry message) is the same choice the wrapped action's own
 * zero-rows-matched case already makes on purpose.
 */
export function withNetworkFallback<State, Args extends unknown[]>(
  action: (...args: Args) => Promise<State>,
  onFailure: (error: unknown) => State,
): (...args: Args) => Promise<State> {
  return async (...args: Args) => {
    try {
      return await action(...args);
    } catch (error) {
      console.error("[withNetworkFallback] action rejected before returning a normal state:", error);
      return onFailure(error);
    }
  };
}
