/**
 * Split out of boost-runner.ts (which is `server-only`) so client components
 * — e.g. boost-panel.tsx's copy — can read the duration without pulling a
 * server-only module into the client bundle.
 *
 * A fixed, non-configurable duration — no "buy N days" input — the same
 * simplicity Passes already use (7-day / 30-day, not a slider). One tier is
 * enough for a v1 competitive-edge purchase; a longer tier is a catalog row
 * away, exactly like talent_directory_plans already is for subscriptions.
 */
export const TALENT_DIRECTORY_BOOST_DAYS = 7;
