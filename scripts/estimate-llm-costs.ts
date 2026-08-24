/**
 * Unit-economics check for every credit-gated action that makes a real LLM
 * call: what does it cost us in tokens, and how does that compare to what we
 * charge in credits?
 *
 * This is a kept-around tool, not a throwaway — re-run it whenever a model
 * changes, a provider price changes, or the naira moves. It spends real API
 * budget (one call per sampled action, per run), so it is not on any
 * schedule and not wired to CI.
 *
 * Usage:
 *   npm run dev            # in another terminal — the probe needs Next's runtime
 *   npm run estimate-costs
 *
 * ── Rates below are point-in-time. Re-check before trusting a re-run. ──
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import http from "node:http";
import https from "node:https";

/**
 * Plain node:http instead of fetch: a probe group runs several sequential
 * LLM calls and reliably exceeds undici's 300s default headers timeout,
 * which global fetch gives no supported way to raise (and undici isn't a
 * direct dependency here). node:http has no such default.
 */
function postJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      { method: "POST", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** USD per 1M tokens. Verify against the provider's own pricing page. */
const MODEL_PRICING: Record<string, { input: number; output: number; source: string; checked: string }> = {
  // Google's own pricing page. Output price explicitly includes thinking
  // tokens, so reasoning spend is already inside the output rate.
  "gemini-3.6-flash": {
    input: 0.75,
    output: 3.75,
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    checked: "2026-08-24",
  },
  // Groq publishes no token pricing on groq.com or console.groq.com/docs;
  // this comes from secondary aggregators and is therefore LESS RELIABLE
  // than the Gemini figure. Groq is dev/CI-only per .env.example, so this
  // matters for completeness, not for the production margin question.
  "openai/gpt-oss-120b": {
    input: 0.15,
    output: 0.6,
    source: "secondary sources (cloudzero / pricepertoken) — not Groq's own page",
    checked: "2026-08-24",
  },
};

/** Live mid-market rate. Re-check on re-run; the naira is not stable. */
const USD_TO_NGN = 1345.21;
const NGN_RATE_SOURCE = "open.er-api.com, 2026-08-24";

/** ₦ per credit — the §6.9 anchor. Read from the spec, not from a price table. */
const NGN_PER_CREDIT = 150;

/**
 * Credit price of each measured action. Mirrors CREDIT_COSTS; kept explicit
 * here so the table is readable standalone and so a mismatch is visible
 * rather than silently inherited.
 */
const ACTION_CREDITS: Record<string, number> = {
  "tailoring_run (no cover letter)": 5,
  "tailoring_run + cover_letter_run (one call)": 8,
  bullet_rewrite: 1,
  scholarship_eligibility_check: 2,
  scholarship_sop_draft: 4,
};

interface ProbeSample {
  action: string;
  fixture: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  error?: string;
}

async function main() {
  const appUrl = process.env.SEED_APP_URL ?? "http://localhost:3000";

  // One request per group: running every sample in a single request outran
  // Node's fetch headers timeout. Sequential, so LLM rate limits are hit
  // gently rather than all at once.
  type Report = { provider: string; model: string; samples: ProbeSample[]; fixtureNotes: string[] };
  const groups = ["tailoring", "bullet", "scholarship"];
  const reports: Report[] = [];
  for (const group of groups) {
    process.stdout.write(`  probing ${group}…`);
    const res = await postJson(
      `${appUrl}/api/admin/estimate-llm-costs?group=${group}`,
      process.env.INGEST_SECRET ? { "x-ingest-secret": process.env.INGEST_SECRET } : {},
    );
    if (res.status !== 200) {
      throw new Error(
        `Probe route returned ${res.status} for group "${group}" — is \`npm run dev\` running at ${appUrl}?\n${res.body.slice(0, 300)}`,
      );
    }
    const body = JSON.parse(res.body) as { report: Report };
    reports.push(body.report);
    console.log(` ${body.report.samples.length} sample(s)`);
  }

  const report: Report = {
    provider: reports[0].provider,
    model: reports[0].model,
    samples: reports.flatMap((r) => r.samples),
    fixtureNotes: [...new Set(reports.flatMap((r) => r.fixtureNotes))],
  };

  const pricing = MODEL_PRICING[report.model];
  if (!pricing) {
    throw new Error(
      `No pricing entry for model "${report.model}". Add it to MODEL_PRICING with a source and date.`,
    );
  }

  console.log(`\nProvider: ${report.provider}  Model: ${report.model}`);
  console.log(`Pricing:  $${pricing.input}/1M in, $${pricing.output}/1M out  (${pricing.checked}, ${pricing.source})`);
  console.log(`FX:       $1 = ₦${USD_TO_NGN}  (${NGN_RATE_SOURCE})`);
  console.log(`Credit:   ₦${NGN_PER_CREDIT} per credit (build-prompt §6.9 anchor)\n`);
  console.log("Fixtures:");
  for (const n of report.fixtureNotes) console.log(`  · ${n}`);

  const costOf = (s: ProbeSample) =>
    ((s.inputTokens / 1_000_000) * pricing.input + (s.outputTokens / 1_000_000) * pricing.output) *
    USD_TO_NGN;

  // Group by action so the table reports mean and range across samples,
  // not a single lucky draw.
  const byAction = new Map<string, ProbeSample[]>();
  for (const s of report.samples) {
    byAction.set(s.action, [...(byAction.get(s.action) ?? []), s]);
  }

  console.log("\n" + "-".repeat(116));
  console.log(
    "action".padEnd(44) +
      "n".padStart(3) +
      "cr".padStart(4) +
      "price ₦".padStart(9) +
      "mean ₦".padStart(9) +
      "min ₦".padStart(8) +
      "max ₦".padStart(8) +
      "margin ₦".padStart(11) +
      "margin %".padStart(10),
  );
  console.log("-".repeat(116));

  let thinOrNegative = 0;
  let noData = 0;
  for (const [action, group] of byAction) {
    // Only samples that actually produced a billed call can be priced. A
    // failed call has zero tokens, and averaging that in would report a
    // FALSELY GOOD margin — an all-errored action would show ₦0 cost and
    // 100% margin, which is the most dangerous possible way to be wrong here.
    const usable = group.filter((g) => !g.error && g.calls > 0);
    const errored = group.filter((g) => g.error);

    if (usable.length === 0) {
      noData++;
      console.log(
        action.padEnd(44) +
          "0".padStart(3) +
          String(ACTION_CREDITS[action] ?? 0).padStart(4) +
          ((ACTION_CREDITS[action] ?? 0) * NGN_PER_CREDIT).toFixed(0).padStart(9) +
          "—".padStart(9) +
          "—".padStart(8) +
          "—".padStart(8) +
          "—".padStart(11) +
          "NO DATA".padStart(10),
      );
      for (const e of errored) {
        console.log(`      error [${e.fixture}]: ${(e.error ?? "").split("\n")[0].slice(0, 140)}`);
      }
      continue;
    }

    const costs = usable.map(costOf);
    const mean = costs.reduce((a, c) => a + c, 0) / costs.length;
    const worst = Math.max(...costs);
    const credits = ACTION_CREDITS[action] ?? 0;
    const priceNgn = credits * NGN_PER_CREDIT;
    // Margin is quoted against the WORST observed cost, not the mean — the
    // question is whether this can go underwater, not whether it usually is.
    const marginNgn = priceNgn - worst;
    const marginPct = priceNgn > 0 ? (marginNgn / priceNgn) * 100 : 0;
    const flag = marginPct < 50 ? "  ⚠ THIN" : errored.length ? "  (partial)" : "";
    if (marginPct < 50) thinOrNegative++;

    console.log(
      action.padEnd(44) +
        String(usable.length).padStart(3) +
        String(credits).padStart(4) +
        priceNgn.toFixed(0).padStart(9) +
        mean.toFixed(2).padStart(9) +
        Math.min(...costs).toFixed(2).padStart(8) +
        worst.toFixed(2).padStart(8) +
        marginNgn.toFixed(2).padStart(11) +
        `${marginPct.toFixed(1)}%`.padStart(10) +
        flag,
    );
    const retried = usable.filter((g) => g.calls > 1);
    if (retried.length) {
      console.log(
        `      note: ${retried.length}/${usable.length} priced sample(s) fired a retry — real spend the user never sees`,
      );
    }
    for (const e of errored) {
      console.log(
        `      excluded [${e.fixture}]: ${(e.error ?? "").split("\n")[0].slice(0, 140)}`,
      );
    }
  }
  console.log("-".repeat(116));
  console.log(
    thinOrNegative === 0
      ? "\nNo action with data has thin (<50%) or negative margin at current prices."
      : `\n${thinOrNegative} action(s) flagged THIN — see above.`,
  );
  if (noData) {
    console.log(
      `${noData} action(s) returned NO DATA — every sample failed, so their margin is UNKNOWN, not good.`,
    );
  }

  const totalUsd = report.samples.reduce(
    (a, r) =>
      a + (r.inputTokens / 1_000_000) * pricing.input + (r.outputTokens / 1_000_000) * pricing.output,
    0,
  );
  const totalCalls = report.samples.reduce((a, r) => a + r.calls, 0);
  console.log(
    `\nThis run: ${totalCalls} LLM call(s), $${totalUsd.toFixed(5)} (≈₦${(totalUsd * USD_TO_NGN).toFixed(2)}) of real API spend.`,
  );
  console.log(
    "\nNot measured here (no LLM cost behind them): template_unlock is a pure",
  );
  console.log(
    "DB access fee — margin is its full credit price minus zero. Same for any",
  );
  console.log("grant/purchase/referral reason, which are not user spends at all.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
