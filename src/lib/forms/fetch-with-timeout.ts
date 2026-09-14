/**
 * A client-side timeout for `fetch`, plus a way to tell a genuine timeout
 * apart from a real connectivity/network failure once the call has rejected.
 *
 * WHY THIS EXISTS. Every route this wraps (`/api/tailoring`, `/api/public/jd-demo`,
 * `/api/resume/parse`, `/api/resume-builder/import`) calls into
 * `generateWithFailover` (src/lib/llm/index.ts) synchronously. Before this
 * fix, Groq's OpenAI-compatible client had no bounded timeout — a hung call
 * ran until the hosting platform killed the function, well past the point
 * where the loading state ("Working…", "Drafting your tailored resume…") had
 * anything true left to say. When the platform did kill it, the dropped
 * connection surfaced HERE as a plain rejected fetch promise, and every one
 * of these components caught that the same way as a real dead-network
 * failure: "Couldn't reach Farah — check your connection and try again." —
 * actively wrong when the fault was a server-side stall, not the visitor's
 * connection.
 *
 * TWO FIXES, TOGETHER. groq-provider.ts and gemini-provider.ts now bound
 * their own HTTP calls (GROQ_CLIENT_TIMEOUT_MS / GEMINI_CLIENT_TIMEOUT_MS,
 * 20s each), and the four routes above declare a `maxDuration` sized to
 * that. Given those, the server itself now returns a normal JSON error
 * response well before the platform would ever kill the function — so in
 * the overwhelming majority of cases `!res.ok` is what fires, not this
 * module. `fetchWithTimeout` and `classifyFetchError` below are the backstop
 * for what's left: the platform still kills the function or the connection
 * still drops before any response reaches the browser, which still has no
 * HTTP status to branch on. CLIENT_FETCH_TIMEOUT_MS is deliberately longer
 * than the routes' own `maxDuration` (45s) — the server is meant to win that
 * race and answer first; this only fires when it doesn't.
 */

/** Longer than every wrapped route's `maxDuration` (45s) plus round-trip slack. */
export const CLIENT_FETCH_TIMEOUT_MS = 55_000;

/**
 * `fetch` with an AbortController wired to `timeoutMs`. Rejects the same way
 * a manually aborted fetch would (`AbortError`) once the timeout elapses —
 * see `classifyFetchError` for how callers should read that.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = CLIENT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type FetchFailureKind = "timeout" | "network" | "unknown";

/**
 * Classifies a caught fetch rejection so the UI can show a message that
 * matches the actual cause, instead of always blaming the visitor's
 * connection.
 *
 *  - "timeout": aborted by `fetchWithTimeout` above (or any other
 *    AbortController) — the server took too long, or never responded at
 *    all. Not the visitor's fault, and "check your connection" is the wrong
 *    instruction for it.
 *  - "network": a genuine transport failure — the request never reached a
 *    server. Browsers report this as a `TypeError` ("Failed to fetch" in
 *    Chrome/Edge, "NetworkError when attempting to fetch resource" in
 *    Firefox, "Load failed" in Safari), and/or the browser already knows
 *    it's offline (`navigator.onLine === false`).
 *  - "unknown": anything else (e.g. a `SyntaxError` from a malformed JSON
 *    body) — not a connection problem, so callers should not say it's one.
 */
export function classifyFetchError(error: unknown): FetchFailureKind {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

const DEFAULT_TIMEOUT_MESSAGE = "This is taking longer than expected — try again in a moment.";
const DEFAULT_NETWORK_MESSAGE = "Couldn't reach Farah — check your connection and try again.";
const DEFAULT_UNKNOWN_MESSAGE = "Something went wrong — try again in a moment.";

/**
 * Turns a caught fetch rejection into the copy to show. Defaults are Farah-
 * branded since every current caller is Farah-facing; pass overrides for a
 * surface that shouldn't say "Farah" or wants its own wording.
 */
export function fetchErrorMessage(
  error: unknown,
  overrides?: { timeout?: string; network?: string; unknown?: string },
): string {
  const kind = classifyFetchError(error);
  if (kind === "timeout") return overrides?.timeout ?? DEFAULT_TIMEOUT_MESSAGE;
  if (kind === "network") return overrides?.network ?? DEFAULT_NETWORK_MESSAGE;
  return overrides?.unknown ?? DEFAULT_UNKNOWN_MESSAGE;
}
