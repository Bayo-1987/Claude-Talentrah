import { test, expect, request as pwRequest } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/types";

/**
 * /api/admin/moderate-job-posting, driven the way an operator drives it.
 *
 * The vitest suite next door (tests/rls/job-posting-removal.test.ts) proves
 * the DATABASE refuses the wrong things. This proves the ROUTE does the right
 * ones, and it is a separate question: the route runs as the service role, so
 * every policy in that suite is bypassed here and the only thing standing
 * between "remove" and "delete the evidence" is this handler.
 *
 * Four properties:
 *
 *   1. It is closed without the secret. The admin surface was open in
 *      production for months (see src/lib/api/admin-auth.ts) precisely because
 *      nothing asserted this.
 *   2. Remove and restore each act exactly once. The state condition is in the
 *      WHERE clause, so a repeat is a 409 and not a second removal with a
 *      different reason written over the first.
 *   3. Restore lands on `closed`, never `open`. Restoring says "this should
 *      not have been removed"; it does not say "this job is live right now",
 *      and only the ingest (or the employer) knows the second.
 *   4. Both directions require a reason — including restore, which is the one
 *      that is easy to leave optional and is the only record of why a removal
 *      was reversed.
 */
const SECRET = process.env.ADMIN_API_SECRET || process.env.INGEST_SECRET;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;

const admin =
  SERVICE && URL_
    ? createClient<Database>(URL_, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/*
 * A SKIP MUST NOT PASS FOR A RUN IN CI.
 *
 * Locally this spec cannot run: .env.local's INGEST_SECRET is empty and its
 * service-role key is still the PASTE_… placeholder, so skipping is the honest
 * outcome. In CI both are present (ci.yml generates the admin secret per run
 * and injects the service key), so a skip there means the wiring broke — and a
 * silently-skipped spec is indistinguishable from a passing one on the summary
 * line. Fail loudly instead.
 */
if (process.env.CI && (!SECRET || !admin)) {
  throw new Error(
    "moderate-job-posting spec cannot run in CI: " +
      [!SECRET && "no ADMIN_API_SECRET/INGEST_SECRET", !admin && "no service-role key"]
        .filter(Boolean)
        .join(", "),
  );
}

test.describe("moderating a job posting", () => {
  test.skip(!SECRET || !admin, "needs an admin secret and the service-role key — see the CI guard above");

  let jobId: string;

  test.beforeAll(async () => {
    const { data, error } = await admin!
      .from("job_postings")
      .insert({
        source_type: "external",
        company_name: "MODERATE-TEST Co",
        title: "MODERATE-TEST Scam Role",
        description: "Fixture posting owned by e2e/moderate-job-posting.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: `moderate-test-${randomUUID()}`,
        external_source: "moderate-test",
        external_url: `https://example.test/${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
    jobId = data.id;
  });

  test.afterAll(async () => {
    if (!jobId) return;
    // A refused delete resolves with an error rather than throwing.
    const { error } = await admin!.from("job_postings").delete().eq("id", jobId);
    if (error) console.error("[moderate-job-posting cleanup]", error.message);
  });

  test("the whole remove/restore cycle, and the ways it refuses", async ({ baseURL }) => {
    const api = await pwRequest.newContext({ baseURL });
    const url = "/api/admin/moderate-job-posting";
    const auth = { "x-admin-secret": SECRET! };

    // 1. closed without the secret
    const noAuth = await api.post(url, {
      data: { id: jobId, action: "remove", reason: "no secret" },
    });
    expect(noAuth.status()).toBe(401);

    // 4. a reason is required
    const noReason = await api.post(url, {
      headers: auth,
      data: { id: jobId, action: "remove" },
    });
    expect(noReason.status()).toBe(400);

    const badAction = await api.post(url, {
      headers: auth,
      data: { id: jobId, action: "delete", reason: "x" },
    });
    expect(badAction.status()).toBe(400);

    // 2. remove acts once
    const removed = await api.post(url, {
      headers: auth,
      data: { id: jobId, action: "remove", reason: "Reported as an advance-fee scam." },
    });
    expect(removed.status()).toBe(200);
    expect((await removed.json()).status).toBe("removed");

    const removedAgain = await api.post(url, {
      headers: auth,
      data: { id: jobId, action: "remove", reason: "Again." },
    });
    expect(removedAgain.status()).toBe(409);

    // The first reason survived the second attempt.
    const { data: mid } = await admin!
      .from("job_postings")
      .select("status, removal_reason")
      .eq("id", jobId)
      .single();
    expect(mid!.status).toBe("removed");
    expect(mid!.removal_reason).toContain("advance-fee");

    // 3. restore lands on closed, not open
    const restored = await api.post(url, {
      headers: auth,
      data: { id: jobId, action: "restore", reason: "Report was wrong — verified the employer." },
    });
    expect(restored.status()).toBe(200);
    const body = await restored.json();
    expect(body.status).toBe("closed");
    expect(body.status).not.toBe("open");

    const { data: after } = await admin!
      .from("job_postings")
      .select("status, removed_at, removal_reason")
      .eq("id", jobId)
      .single();
    expect(after!.status).toBe("closed");
    expect(after!.removed_at).toBeNull();
    expect(after!.removal_reason).toBeNull();

    // restore acts once too
    const restoredAgain = await api.post(url, {
      headers: auth,
      data: { id: jobId, action: "restore", reason: "Again." },
    });
    expect(restoredAgain.status()).toBe(409);

    // an unknown id is a 409 that says so, not a 500
    const missing = await api.post(url, {
      headers: auth,
      data: { id: randomUUID(), action: "remove", reason: "nobody home" },
    });
    expect(missing.status()).toBe(409);
    expect((await missing.json()).error).toContain("No posting");

    await api.dispose();
  });
});
