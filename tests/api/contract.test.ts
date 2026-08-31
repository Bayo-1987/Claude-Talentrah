/**
 * The API contract layer: what every internal route must answer regardless of
 * what it does.
 *
 * These are deliberately NOT feature tests. Each route's own behaviour is
 * covered elsewhere; this file asserts the four properties that were
 * inconsistent across the ten route handlers, so a new route that gets the
 * shape wrong fails here rather than in production.
 *
 * WHY THE ADMIN GUARD IS THE CENTRE OF THIS FILE. The fail-open pattern —
 *
 *     const secret = process.env.INGEST_SECRET;
 *     if (secret) { ...check... }        // unset ⇒ no check at all
 *
 * — was live on the deployment when this was written, verified rather than
 * inferred:
 *
 *     $ curl https://claude-talentrah.vercel.app/api/admin/moderate-scholarship
 *       (that route has since been retired — see docs/admin-auth.md)
 *     {"count":3,"scholarships":[…"moderation_status":"pending"…]}   HTTP 200
 *
 *     $ curl -X POST '…/api/admin/estimate-llm-costs?group=bogus'
 *     {"error":"group must be one of tailoring, bullet, scholarship"} HTTP 400
 *
 * The second is the tell: argument validation sits *behind* the auth check, so
 * a 400 rather than a 401 proves the guard did not run. INGEST_SECRET was
 * unset in production, so all four routes gated on it were open — including
 * the POST that flips a scholarship to `verified` and publishes it.
 *
 * Not probed: /api/admin/renew-passes POST. Its manual path charges saved
 * Paystack tokens immediately with no dry-run, so there is no safe request to
 * make against production. It was gated on a *fourth* env var,
 * PASS_RENEWAL_SECRET, that nothing else used and .env.example never
 * documented, with the same fail-open shape — so it is very likely to have
 * been open too, but that is inference, not measurement, and is recorded as
 * such.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

/*
 * Generated, not a literal. A hardcoded `const ADMIN_SECRET = "…"` here is a
 * true positive for the repo's own secret scanner (rule
 * talentrah-hardcoded-credential) — it caught this line on the first CI run.
 * Allowlisting it would have been the wrong fix: an allowlist entry that says
 * "this one is fine" is how the next real one gets waved through. Removing the
 * credential-shaped literal costs nothing, since the value only has to differ
 * from the wrong one below.
 */
const ADMIN_SECRET = randomUUID();

/*
 * Every module a route pulls in that would do real work is stubbed. The point
 * is the contract — whether the handler answers 401 before it gets anywhere
 * near the pipeline — so a stub that records its calls is exactly the right
 * instrument: if the guard leaks, the spy fires and the test says so.
 */
const ranJobIngest = vi.fn();
const ranScholarshipIngest = vi.fn();
const ranScholarshipUpsert = vi.fn();
const ranCostProbe = vi.fn();
const ranPassRenewal = vi.fn();
const ranCampaignCharge = vi.fn();
const ranModeration = vi.fn();
const listedScholarships = vi.fn();
const listedCampaigns = vi.fn();
const decidedCampaign = vi.fn();

/**
 * `ingestResults` is mutable so a test can make every source fail. The default
 * is one healthy source, which is what the guard tests above expect.
 */
const ingestResults: { value: Array<Record<string, unknown>> } = {
  value: [{ source: "stub", upserted: 0 }],
};
vi.mock("@/lib/jobs/ingest", () => ({
  ingestAllSources: (...a: unknown[]) => {
    ranJobIngest(...a);
    return Promise.resolve(ingestResults.value);
  },
}));
vi.mock("@/lib/scholarships/ingest", () => ({
  ingestScholarships: (...a: unknown[]) => {
    ranScholarshipIngest(...a);
    return Promise.resolve({ ok: true, fetched: 0, upserted: 0, staleMarked: 0, errors: [] });
  },
  setModerationStatus: (...a: unknown[]) => {
    ranModeration(...a);
    return Promise.resolve();
  },
  upsertScholarships: (...a: unknown[]) => {
    ranScholarshipUpsert(...a);
    return Promise.resolve({ upserted: 1, returnedToReview: [], error: null });
  },
}));
vi.mock("@/lib/llm/cost-probe", () => ({
  PROBE_GROUPS: ["tailoring", "bullet", "scholarship"],
  runCostProbe: (...a: unknown[]) => {
    ranCostProbe(...a);
    return Promise.resolve({ group: "tailoring", rows: [] });
  },
}));
vi.mock("@/lib/billing/renewals", () => ({
  runPassRenewalJob: (...a: unknown[]) => {
    ranPassRenewal(...a);
    return Promise.resolve({
      ok: true, remindersSent: 0, renewed: 0, lapsed: 0, errors: [], queryErrors: [],
    });
  },
}));
vi.mock("@/lib/billing/campaign-charges", () => ({
  runCampaignChargeJob: (...a: unknown[]) => {
    ranCampaignCharge(...a);
    return Promise.resolve({
      ok: true, on: "2026-08-26", considered: 0, charged: 0, chargedNgn: 0,
      pausedInsufficientFunds: 0, completed: 0, alreadyCharged: 0, skipped: 0,
      errors: [], queryErrors: [],
    });
  },
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => {
            // Both admin list surfaces read the same shape; the spy that fires
            // says WHICH one leaked, which is the useful thing when one does.
            if (table === "ad_campaigns") listedCampaigns();
            else listedScholarships();
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    }),
    rpc: (...a: unknown[]) => {
      decidedCampaign(...a);
      return Promise.resolve({ data: "rejected", error: null });
    },
  }),
}));

const SPIES = [
  ranJobIngest, ranScholarshipIngest, ranScholarshipUpsert, ranCostProbe,
  ranPassRenewal, ranModeration, listedScholarships,
  listedCampaigns, decidedCampaign, ranCampaignCharge,
];

beforeEach(() => {
  SPIES.forEach((s) => s.mockClear());
  vi.stubEnv("ADMIN_API_SECRET", "");
  vi.stubEnv("INGEST_SECRET", "");
  vi.stubEnv("PASS_RENEWAL_SECRET", "");
  vi.stubEnv("CRON_SECRET", "");
});
afterEach(() => vi.unstubAllEnvs());

type Handler = (req: Request) => Promise<Response>;

/** Every admin entry point, and the URL + method each answers on. */
const ADMIN_ENDPOINTS: Array<{
  name: string;
  url: string;
  method: "GET" | "POST";
  load: () => Promise<Handler>;
  /** True when the handler, if the guard leaks, does something irreversible. */
  sideEffecting: boolean;
  /**
   * A body this specific route will actually accept.
   *
   * The shared default is `{ id, status }`, which the moderation routes take.
   * A route that rejects it answers 400 on schema validation before it ever
   * reaches its pipeline — which would make "the spy did not fire" true for
   * the wrong reason, and quietly stop testing the guard at all.
   */
  body?: unknown;
}> = [
  {
    name: "ingest-jobs POST",
    url: "http://t/api/admin/ingest-jobs",
    method: "POST",
    load: async () => (await import("@/app/api/admin/ingest-jobs/route")).POST,
    sideEffecting: true,
  },
  {
    name: "ingest-scholarships POST",
    url: "http://t/api/admin/ingest-scholarships",
    method: "POST",
    load: async () => (await import("@/app/api/admin/ingest-scholarships/route")).POST,
    sideEffecting: true,
  },
  {
    name: "estimate-llm-costs POST",
    url: "http://t/api/admin/estimate-llm-costs?group=tailoring",
    method: "POST",
    load: async () => (await import("@/app/api/admin/estimate-llm-costs/route")).POST,
    sideEffecting: true,
  },
  {
    name: "renew-passes POST (spends money)",
    url: "http://t/api/admin/renew-passes",
    method: "POST",
    load: async () => (await import("@/app/api/admin/renew-passes/route")).POST,
    sideEffecting: true,
  },
];

function req(
  url: string,
  method: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Request {
  const payload = body ?? { id: "00000000-0000-0000-0000-000000000000", status: "verified" };
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
}

/*
 * ---------------------------------------------------------------------------
 * §0 — EVERY admin route, discovered rather than listed
 * ---------------------------------------------------------------------------
 *
 * The list below (ADMIN_ENDPOINTS) carries per-route metadata a filesystem
 * sweep cannot infer: request bodies, which calls are side-effecting, which
 * pipeline spy must stay silent. It earns its place and is not replaced.
 *
 * What it CANNOT do is notice a route that nobody added to it. That is the
 * failure mode this section exists for: a new handler under /api/admin with a
 * fail-open guard would ship green, because the suite asserting admin routes
 * fail closed would never have heard of it. The original finding — five admin
 * routes live and unauthenticated on production — was exactly a case of
 * "nobody was checking this one".
 *
 * So the routes are DISCOVERED. `import.meta.glob` is resolved by Vite at
 * build time from the real directory, so adding a file is enough to be
 * covered, and deleting one cannot silently reduce coverage to zero — the
 * count assertion below fails if discovery breaks.
 *
 * This is deliberately the weakest possible assertion applied to the widest
 * possible set: every exported HTTP method answers 401 with no credential.
 * No bodies, no spies, no per-route knowledge. A route that needs more than
 * that gets an entry in ADMIN_ENDPOINTS as well.
 */
const ADMIN_ROUTE_MODULES = import.meta.glob("../../src/app/api/admin/**/route.ts");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

describe("§0 — every route under /api/admin fails closed, discovered from disk", () => {
  const paths = Object.keys(ADMIN_ROUTE_MODULES).sort();

  it("discovery actually found routes", () => {
    /*
     * Guards the guard. If the glob pattern ever stops matching — a directory
     * move, a Vite change — every test below would silently pass by iterating
     * nothing, which is the "clean check that proves nothing" shape this repo
     * has been bitten by repeatedly. An empty sweep is a failure, not a pass.
     */
    expect(paths.length, "no admin routes discovered — the glob is wrong").toBeGreaterThan(3);
  });

  for (const path of paths) {
    const label = path.replace("../../src/app/api/admin/", "").replace("/route.ts", "");

    it(`${label}: every exported method answers 401 with no credential`, async () => {
      const mod = (await ADMIN_ROUTE_MODULES[path]()) as Record<string, unknown>;
      const exported = HTTP_METHODS.filter((m) => typeof mod[m] === "function");

      expect(exported.length, `${label} exports no HTTP handler`).toBeGreaterThan(0);

      for (const method of exported) {
        const handler = mod[method] as (r: Request) => Promise<Response>;
        const res = await handler(req(`http://t/api/admin/${label}`, method));
        expect(
          res.status,
          `OPEN ADMIN ROUTE: ${label} ${method} answered ${res.status} with no credential`,
        ).toBe(401);
      }
    });
  }
});

describe("§1 — the admin guard fails CLOSED", () => {
  for (const ep of ADMIN_ENDPOINTS) {
    it(`${ep.name}: 401 when no admin secret is configured`, async () => {
      /*
       * The exact production condition. Under the old `if (secret) {...}` this
       * returns 200 (or 400 for a bad argument) and the pipeline actually
       * runs — which is what the curl output in the file header captured.
       */
      const handler = await ep.load();
      const res = await handler(req(ep.url, ep.method, {}, ep.body));

      expect(
        res.status,
        `OPEN ADMIN ROUTE: ${ep.name} answered ${res.status} with no secret configured and no credential presented`,
      ).toBe(401);

      if (ep.sideEffecting) {
        for (const spy of SPIES) {
          expect(
            spy,
            `${ep.name} reached its pipeline while unauthenticated`,
          ).not.toHaveBeenCalled();
        }
      }
    });

    it(`${ep.name}: 401 on a wrong credential`, async () => {
      vi.stubEnv("INGEST_SECRET", ADMIN_SECRET);
      const handler = await ep.load();
      const res = await handler(
        req(ep.url, ep.method, { "x-admin-secret": "not-the-secret" }, ep.body),
      );
      expect(res.status).toBe(401);
    });

    it(`${ep.name}: the legacy x-ingest-secret header still works`, async () => {
      // Existing runbooks and scripts/estimate-llm-costs.ts send this name.
      // Renaming the header along with the guard would have been a silent
      // breakage dressed up as a security fix.
      vi.stubEnv("INGEST_SECRET", ADMIN_SECRET);
      const handler = await ep.load();
      const res = await handler(req(ep.url, ep.method, { "x-ingest-secret": ADMIN_SECRET }, ep.body));
      expect(res.status).not.toBe(401);
    });

    it(`${ep.name}: passes the guard on the right credential`, async () => {
      /*
       * Positive control. Without this, a guard that returns 401
       * unconditionally satisfies every assertion above.
       */
      vi.stubEnv("INGEST_SECRET", ADMIN_SECRET);
      const handler = await ep.load();
      const res = await handler(req(ep.url, ep.method, { "x-admin-secret": ADMIN_SECRET }, ep.body));
      expect(res.status, `${ep.name} rejected a correct credential`).not.toBe(401);
    });
  }

  it("one secret covers the whole surface, including the route that spends money", async () => {
    /*
     * The specific inconsistency that made the fail-open dangerous rather than
     * merely untidy: renew-passes POST used PASS_RENEWAL_SECRET, a fourth
     * variable nothing else read and .env.example never listed. An operator
     * who set the documented INGEST_SECRET secured four routes and left the
     * Paystack-charging one open.
     */
    vi.stubEnv("INGEST_SECRET", ADMIN_SECRET);
    const { POST } = await import("@/app/api/admin/renew-passes/route");
    const res = await POST(req("http://t/api/admin/renew-passes", "POST", { "x-admin-secret": ADMIN_SECRET }));
    expect(res.status, "the documented admin secret does not open renew-passes").not.toBe(401);
    expect(ranPassRenewal).toHaveBeenCalled();
  });

  it("the retired PASS_RENEWAL_SECRET no longer opens anything on its own", async () => {
    vi.stubEnv("PASS_RENEWAL_SECRET", "legacy-value");
    const { POST } = await import("@/app/api/admin/renew-passes/route");
    const res = await POST(
      req("http://t/api/admin/renew-passes", "POST", { "x-renewal-secret": "legacy-value" }),
    );
    expect(res.status, "MONEY: a retired env var still triggers Paystack charges").toBe(401);
    expect(ranPassRenewal).not.toHaveBeenCalled();
  });
});

describe("§2 — cron GETs fail closed too", () => {
  const CRON_ROUTES = [
    ["ingest-jobs", () => import("@/app/api/admin/ingest-jobs/route")],
    ["ingest-scholarships", () => import("@/app/api/admin/ingest-scholarships/route")],
    ["renew-passes", () => import("@/app/api/admin/renew-passes/route")],
    // Debits employer ad wallets. Registered here in the same commit that
    // created the route, not retrofitted — the four routes above were all
    // fail-OPEN in production before this file existed.
    ["charge-campaigns", () => import("@/app/api/admin/charge-campaigns/route")],
  ] as const;

  for (const [name, load] of CRON_ROUTES) {
    it(`${name}: 401 with no CRON_SECRET, 401 on a wrong bearer, runs on the right one`, async () => {
      const { GET } = await load();
      const url = `http://t/api/admin/${name}`;

      expect((await GET(new Request(url))).status).toBe(401);

      vi.stubEnv("CRON_SECRET", "cron-value");
      expect(
        (await GET(new Request(url, { headers: { authorization: "Bearer wrong" } }))).status,
      ).toBe(401);

      const ok = await GET(new Request(url, { headers: { authorization: "Bearer cron-value" } }));
      expect(ok.status, `${name} rejected a valid cron invocation`).not.toBe(401);
    });
  }

  it("every money-moving daily RPC has a scheduled caller", async () => {
    /*
     * The inverse of the assertion below, and the one that catches the bug
     * this file was extended for. That one asks "is every scheduled path
     * reachable?"; a job can pass it and still never run, because nothing
     * asserts the job is scheduled AT ALL.
     *
     * `charge_ad_campaign_day` shipped in 0047 with three passing tests and no
     * caller: `grep -rn charge_ad_campaign_day src/` matched only the
     * generated type. `resume_ad_campaign` charges the day it activates a
     * campaign, so the campaign went live having paid for one day and was
     * never charged again — an employer paid one day's rate and advertised
     * until their end date. A tested function nobody calls is indistinguishable
     * from a missing one, and looks better in a coverage report.
     */
    const vercelConfig = (await import("../../vercel.json")).default as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const scheduled = vercelConfig.crons.map((c) => c.path);

    expect(
      scheduled,
      "charge_ad_campaign_day has no scheduled caller — active campaigns run unpaid after their first day",
    ).toContain("/api/admin/charge-campaigns");
  });

  it("every scheduled path in vercel.json actually exports a GET", async () => {
    /*
     * Vercel triggers crons with a GET. A scheduled path whose route only
     * exports POST answers 405 forever and the job silently never runs —
     * which is the failure this repo already had in the other direction:
     * ingest-jobs had a comment saying "point a Vercel Cron job at this" and
     * nothing ever did.
     */
    const vercelConfig = (await import("../../vercel.json")).default as {
      crons: Array<{ path: string; schedule: string }>;
    };

    // Statically enumerated rather than built from the path string: a
    // template-literal import resolves at runtime, so a typo'd path would
    // throw a module-not-found that reads like an infrastructure problem
    // instead of failing this assertion cleanly. A cron added to vercel.json
    // without a line here fails on the first expect below, which is the
    // intended prompt to add one.
    const HANDLERS: Record<string, () => Promise<Record<string, unknown>>> = {
      "/api/admin/renew-passes": () => import("@/app/api/admin/renew-passes/route"),
      "/api/admin/ingest-scholarships": () => import("@/app/api/admin/ingest-scholarships/route"),
      "/api/admin/ingest-jobs": () => import("@/app/api/admin/ingest-jobs/route"),
      "/api/admin/charge-campaigns": () => import("@/app/api/admin/charge-campaigns/route"),
    };

    expect(vercelConfig.crons.length).toBeGreaterThan(0);

    for (const cron of vercelConfig.crons) {
      const load = HANDLERS[cron.path];
      expect(load, `${cron.path} is scheduled but this test has no handler mapped for it`).toBeDefined();
      const mod = await load!();
      expect(
        typeof mod.GET,
        `${cron.path} is scheduled in vercel.json but exports no GET — Vercel's cron would 405 and the job would never run`,
      ).toBe("function");
    }
  });
});

describe("§2b — an ingest run that failed entirely says so in the status code", () => {
  /*
   * ingestAllSources catches per source and records the reason in
   * results[].error, so one dead board cannot stop the others. But that reason
   * used to travel only in a 200 response body, and nothing reads a body: the
   * cron dashboard shows the status code, so a totally failed ingest looked
   * exactly like a quiet day with no new postings.
   *
   * Same shape as the four cleanup bugs found the same day — resolves without
   * throwing, result never checked, failure reads as success. In this case
   * nothing had actually gone wrong; the instrument simply could not have told
   * us either way, which is the defect being fixed.
   */
  afterEach(() => {
    ingestResults.value = [{ source: "stub", upserted: 0 }];
  });

  it("every source failing answers 500, not 200", async () => {
    ingestResults.value = [
      { source: "greenhouse", identifier: "moniepoint", fetched: 0, upserted: 0, closed: 0, error: "fetch failed" },
      { source: "schema-org", identifier: "workable", fetched: 0, upserted: 0, closed: 0, error: "503" },
    ];
    vi.stubEnv("ADMIN_API_SECRET", ADMIN_SECRET);
    const { POST } = await import("@/app/api/admin/ingest-jobs/route");
    const res = await POST(
      req("http://t/api/admin/ingest-jobs", "POST", { "x-admin-secret": ADMIN_SECRET }),
    );
    expect(res.status, "a wholly failed ingest still reported success").toBe(500);
  });

  it("a PARTIAL failure still answers 200 — the run did real work", async () => {
    ingestResults.value = [
      { source: "greenhouse", identifier: "moniepoint", fetched: 126, upserted: 126, closed: 0 },
      { source: "schema-org", identifier: "workable", fetched: 0, upserted: 0, closed: 0, error: "503" },
    ];
    vi.stubEnv("ADMIN_API_SECRET", ADMIN_SECRET);
    const { POST } = await import("@/app/api/admin/ingest-jobs/route");
    const res = await POST(
      req("http://t/api/admin/ingest-jobs", "POST", { "x-admin-secret": ADMIN_SECRET }),
    );
    expect(res.status, "one dead board must not fail the whole run").toBe(200);
  });
});

describe("§3 — errors never carry internals to the caller", () => {
  /*
   * Four handlers returned `err instanceof Error ? err.message : …` directly.
   * Combined with §1 that meant raw Postgres and driver text reaching an
   * unauthenticated caller. The assertion is on the payload rather than on
   * the call site so a future route reintroducing the pattern is caught.
   */
  it("estimate-llm-costs: a provider error becomes a fixed 500 body", async () => {
    vi.stubEnv("INGEST_SECRET", ADMIN_SECRET);
    ranCostProbe.mockImplementationOnce(() => {
      throw new Error("GEMINI_API_KEY quota exceeded for project 1234567890");
    });

    const { POST } = await import("@/app/api/admin/estimate-llm-costs/route");
    const res = await POST(req("http://t/api/admin/estimate-llm-costs?group=tailoring", "POST", { "x-admin-secret": ADMIN_SECRET }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error, "LEAK: provider/key detail reached the response body").not.toContain("GEMINI");
    expect(body.error).not.toContain("1234567890");
  });

  it("every error body is exactly { error: string } and nothing else", async () => {
    // Uniform shape matters to the client: src/components reads `.error` and
    // shows it. A route answering `{ message }` or `{ error: { … } }` renders
    // "undefined" or "[object Object]" to the user.
    vi.stubEnv("INGEST_SECRET", ADMIN_SECRET);
    const { POST } = await import("@/app/api/admin/estimate-llm-costs/route");
    const res = await POST(
      req("http://t/api/admin/estimate-llm-costs?group=nonsense", "POST", { "x-admin-secret": ADMIN_SECRET }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(Object.keys(body)).toEqual(["error"]);
    expect(typeof body.error).toBe("string");
  });
});

describe("§4 — the e2e helper route reveals nothing off a stubbed build", () => {
  it("404s unless LLM_PROVIDER is exactly 'stub'", async () => {
    const { GET } = await import("@/app/api/e2e/llm-provider/route");

    for (const value of ["", "gemini", "Stub", "stub-ish"]) {
      vi.stubEnv("LLM_PROVIDER", value);
      const res = await GET();
      expect(res.status, `LLM_PROVIDER=${JSON.stringify(value)} should be indistinguishable from a missing route`).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }

    vi.stubEnv("LLM_PROVIDER", "stub");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json(), "must reveal only the single boolean the suite needs").toEqual({ stubbed: true });
  });
});
