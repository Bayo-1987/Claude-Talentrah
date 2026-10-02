/**
 * The demo's global daily ceiling, in a file with no `server-only` import so client code that has to NAME
 * the number in copy (src/lib/demo/refusal-copy.ts, rendered by the browser) can import it.
 * The limiter (anonymous-limit.ts) re-exports it, so every existing import keeps working.
 * Sized in migration 0058's own comment.
 */
export const ANON_DEMO_DAILY_CAP = 5;
