import { NextResponse } from "next/server";
import { runCostProbe, PROBE_GROUPS, type ProbeGroup } from "@/lib/llm/cost-probe";

/**
 * Measurement endpoint for scripts/estimate-llm-costs.ts. Exists because the
 * action modules it probes are "server-only" and won't import in a plain tsx
 * process — the same reason scripts/seed.ts drives ingestion over HTTP
 * rather than importing the pipeline.
 *
 * POST-only and gated on INGEST_SECRET, matching the other admin routes.
 * Deliberately NOT wired to any cron: it spends real LLM budget on every
 * invocation, so it should only ever run when someone asks for it.
 */
export async function POST(request: Request) {
  const secret = process.env.INGEST_SECRET;
  if (secret) {
    const provided = request.headers.get("x-ingest-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const group = new URL(request.url).searchParams.get("group") ?? "tailoring";
  if (!PROBE_GROUPS.includes(group as ProbeGroup)) {
    return NextResponse.json(
      { error: `group must be one of ${PROBE_GROUPS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const report = await runCostProbe(group as ProbeGroup);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cost probe failed." },
      { status: 500 },
    );
  }
}
