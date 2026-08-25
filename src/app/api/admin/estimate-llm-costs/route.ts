import { NextResponse } from "next/server";
import { runCostProbe, PROBE_GROUPS, type ProbeGroup } from "@/lib/llm/cost-probe";
import { requireAdminSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Measurement endpoint for scripts/estimate-llm-costs.ts. Exists because the
 * action modules it probes are "server-only" and won't import in a plain tsx
 * process — the same reason scripts/seed.ts drives ingestion over HTTP
 * rather than importing the pipeline.
 *
 * Deliberately NOT wired to any cron: it spends real LLM budget on every
 * invocation, so it should only ever run when someone asks for it. That is
 * also why the fail-open guard this used to have mattered — see admin-auth.ts.
 */
export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

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
    return internalError("cost-probe", err);
  }
}
