"use server";

import { getEmployerContext } from "@/lib/employer/membership";
import { fetchJobPage } from "./fetch-page";
import { extractJobFields } from "./extract";
import type { ImportJobResult } from "./types";

/**
 * "Import from URL" — the one Server Action the client panel calls
 * (src/components/employer/job-import-panel.tsx). Everything that touches
 * the outside world (the fetch, the robots.txt check, the LLM call) happens
 * here, server-side — never in the browser. That isn't just a CORS
 * workaround: every other outbound call in this codebase (aggregation
 * ingestion, tailoring's JD fetch-equivalent, Farah) is server-mediated too,
 * and a client-side fetch of an arbitrary employer-pasted URL would also
 * hand a client-controlled SSRF-shaped request straight to the browser's
 * own network stack with none of robots.ts's gating in the loop at all.
 *
 * Gated by getEmployerContext() rather than requireEmployer() — the latter
 * redirects on no-organisation, which is right for a page render but wrong
 * for a Server Action a client component calls via fetch (a redirect here
 * would surface as an opaque failure, not a real navigation). The page this
 * ships on (/employer/jobs/new) is already behind requireEmployer(), so "no
 * org" here is a defensive fallback, not the expected path — see the `!org`
 * branch below.
 */
export async function importJobFromUrlAction(url: string): Promise<ImportJobResult> {
  const context = await getEmployerContext();
  if (!context) {
    return { ok: false, message: "You need an employer account to import a job posting." };
  }

  if (!url || typeof url !== "string" || !url.trim()) {
    return { ok: false, message: "Paste a URL to import from." };
  }

  const page = await fetchJobPage(url);
  if (!page.ok) {
    return { ok: false, message: page.reason };
  }

  return extractJobFields(page.html, page.text);
}
