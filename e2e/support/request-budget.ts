/**
 * Request-count budget with the installable-app worker's two requests NAMED instead of folded into the number.
 *
 * A page that registers the service worker makes two extra own-origin requests: GET /sw.js (the worker script) and GET /offline (the worker's install-time fetch of its
 * offline page). A route lists them in `workerRequests`; the number `requests` stays the page's own. Headroom is granted per name, and only for a name that really appears in
 * the measured requests, so one unrelated new request still fails, a missing /sw.js is not a spare slot, and a route with no `workerRequests` keeps exactly its old budget.
 */
export interface RequestBudget {
  requests: number;
  /** Own-origin paths the worker adds on this route (only where the worker registers). */
  workerRequests?: string[];
}

export function allowedRequests(budget: RequestBudget, measuredPaths: string[]): number {
  const seen = new Set(measuredPaths);
  const named = new Set(budget.workerRequests ?? []);
  let extra = 0;
  for (const name of named) if (seen.has(name)) extra++;
  return budget.requests + extra;
}

export function requestProblems(budget: RequestBudget, measuredPaths: string[]): string[] {
  const allowed = allowedRequests(budget, measuredPaths);
  const got = measuredPaths.length;
  if (got <= allowed) return [];
  const named = budget.workerRequests?.length ? ` (own ${budget.requests} + named worker requests present ${allowed - budget.requests})` : "";
  return [`requests: ${got} (budget ${allowed}${named}, +${Math.round(((got - allowed) / allowed) * 100)} %)`];
}
