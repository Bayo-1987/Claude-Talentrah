/**
 * The offline stub provider must never write to production.
 *
 * WHAT HAPPENED. `JD_EXTRACTION_LLM_PROVIDER` is unset in every environment, so the provider resolves to the offline stub
 * (src/lib/llm/jd-extraction/index.ts). On 2026-09-16 the `ingest_llm_enrichment` flag was switched on and, until it was switched off on
 * 2026-10-03, every ingest run "enriched" up to 10 postings with the stub's single fixed skill, `stub-jd-extraction-skill`. No paid call was
 * made, but the fake skill counted as a screenable tag in scoring, showed in the job page's skills list, and each run's rewrite deleted that
 * posting's stored scores through trigger 0069, twice.
 *
 * THE GUARD. With the flag on and the provider resolving to the stub in a PRODUCTION deployment, enrichment does nothing: it queries nothing,
 * writes nothing, calls no provider, and logs ONE warning per run. The stub keeps working everywhere else (tests, local development, preview
 * deployments), because that is what it is for. "Production" is `VERCEL_ENV === "production"`, the same signal src/lib/dev/dev-fixture-guard.ts
 * uses: NODE_ENV cannot tell CI (which runs a production BUILD) from the live site.
 *
 * Mocks at the module boundary only, like enrich-thin.test.ts: no database, no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));
const providerName = vi.hoisted(() => ({ value: "stub" }));
const tablesRead = vi.hoisted(() => [] as string[]);
const updates = vi.hoisted(() => [] as Array<{ id: string; patch: Record<string, unknown> }>);
const extractSkills = vi.hoisted(() => vi.fn());
const THIN_ROW = { id: "p1", description: "Some role", structured_jd: { skills: ["sql"] }, posted_at: "2026-01-01T00:00:00Z" };

vi.mock("@/lib/flags/read", () => ({ isFeatureEnabled: vi.fn(async () => flag.enabled) }));
vi.mock("@/lib/llm/jd-extraction", () => ({
  getJdExtractionProvider: () => ({ name: providerName.value, model: "m", extractSkills }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      tablesRead.push(table);
      let isUpdate = false;
      let patch: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (p: Record<string, unknown>) => {
          isUpdate = true;
          patch = p;
          return chain;
        },
        eq: (_c: string, v: string) => {
          if (isUpdate) {
            updates.push({ id: v, patch });
            return Promise.resolve({ error: null });
          }
          return chain;
        },
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [THIN_ROW], error: null });
      return chain;
    },
  }),
}));

import { enrichThinPostings } from "@/lib/jobs/enrich-thin";

const SKIPPED_WARNING = "enrichment enabled but no real provider configured; skipped";
let warn: ReturnType<typeof vi.spyOn>;
let savedVercelEnv: string | undefined;

beforeEach(() => {
  flag.enabled = true;
  providerName.value = "stub";
  tablesRead.length = 0;
  updates.length = 0;
  extractSkills.mockReset().mockResolvedValue({ skills: ["stub-jd-extraction-skill"], usage: null });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  savedVercelEnv = process.env.VERCEL_ENV;
});
afterEach(() => {
  warn.mockRestore();
  if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = savedVercelEnv;
});

const warnedSkipped = () => warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes(SKIPPED_WARNING)).length;

describe("flag on + stub provider + PRODUCTION: nothing happens", () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = "production";
  });

  it("changes no posting's structured_jd, reads no posting, and never calls the provider", async () => {
    const summary = await enrichThinPostings();
    expect(updates).toEqual([]);
    expect(tablesRead).toEqual([]);
    expect(extractSkills).not.toHaveBeenCalled();
    expect(summary.attempted).toBe(0);
    expect(summary.enriched).toBe(0);
    expect(summary.errors).toEqual([]);
  });

  it("logs exactly one warning for the run, with the agreed wording", async () => {
    await enrichThinPostings();
    expect(warnedSkipped()).toBe(1);
    expect(String(warn.mock.calls[0][0])).toContain(SKIPPED_WARNING);
  });

  it("the warning carries the reason and nothing from any posting: no id, title or description, no user data; the count is the summary's attempted: 0 (nothing is read, so there is nothing to count)", async () => {
    const saved = { ...THIN_ROW };
    Object.assign(THIN_ROW, { id: "posting-id-9f3a", description: "Confidential description 5521", title: "Secret Senior Title 7731", company: "Hidden Co 4410" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const summary = await enrichThinPostings();
      expect(warn.mock.calls).toHaveLength(1);
      expect(warn.mock.calls[0]).toEqual([`[enrich-thin] ${SKIPPED_WARNING}`]); // one argument, exactly the reason
      const everything = [...warn.mock.calls, ...log.mock.calls, ...info.mock.calls, ...err.mock.calls].flat().join(" ");
      expect(everything).not.toMatch(/posting-id-9f3a|Confidential|Secret Senior|Hidden Co|9f3a|7731|5521|4410/);
      expect(summary.attempted).toBe(0);
    } finally {
      Object.assign(THIN_ROW, saved);
      log.mockRestore();
      info.mockRestore();
      err.mockRestore();
    }
  });

  it("one warning PER RUN: a second run warns once more (not once per process, not once per posting)", async () => {
    await enrichThinPostings();
    await enrichThinPostings();
    expect(warnedSkipped()).toBe(2);
  });

  it("says why in the summary the ingest route already returns", async () => {
    const summary = await enrichThinPostings();
    expect(summary).toMatchObject({ enabled: true, skipped: "stub-provider-in-production" });
  });
});

describe("the stub keeps working where it is meant to", () => {
  for (const env of [undefined, "preview", "development"]) {
    it(`flag on + stub + VERCEL_ENV=${env ?? "(unset: tests, CI, local)"}: still enriches, no skip warning`, async () => {
      if (env === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = env;
      const summary = await enrichThinPostings();
      expect(summary.enriched).toBe(1);
      expect(updates).toHaveLength(1);
      expect(extractSkills).toHaveBeenCalledTimes(1);
      expect(warnedSkipped()).toBe(0);
    });
  }
});

describe("the other two switches are untouched", () => {
  it("flag OFF + stub + production: does nothing, reads nothing, and does not warn (the flag is the first thing checked)", async () => {
    flag.enabled = false;
    process.env.VERCEL_ENV = "production";
    const summary = await enrichThinPostings();
    expect(summary).toEqual({ enabled: false, attempted: 0, enriched: 0, errors: [] });
    expect(tablesRead).toEqual([]);
    expect(warnedSkipped()).toBe(0);
  });

  it("flag on + a REAL provider + production: enriches normally (only the stub is refused)", async () => {
    providerName.value = "groq";
    process.env.VERCEL_ENV = "production";
    const summary = await enrichThinPostings();
    expect(summary.enriched).toBe(1);
    expect(updates).toHaveLength(1);
    expect(warnedSkipped()).toBe(0);
  });
});

describe("the guard is keyed on the real stub provider's name", () => {
  it("StubJdExtractionProvider reports the name the guard looks for", async () => {
    const { StubJdExtractionProvider } = await import("@/lib/llm/jd-extraction/stub-provider");
    expect(new StubJdExtractionProvider().name).toBe("stub");
  });
});
