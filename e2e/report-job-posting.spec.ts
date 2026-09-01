import { test, expect, type Page, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { randomUUID } from "node:crypto";
import { acquireOperatorsLock } from "../tests/support/operators-lock";

/**
 * Reporting a posting, from the card to the operator's queue.
 *
 * The vitest suite proves the table refuses the wrong writes. This proves the
 * two ends a person actually touches: the affordance on the card, and the
 * ranked list an operator reads.
 *
 * THE HIT-TARGET MEASUREMENT IS NOT DECORATION. #69 shipped a target past
 * review that read as `min-h-10` and measured 39.1px WIDE, because height and
 * width are separate and only one was named. It measures both, in a browser,
 * rather than trusting the class.
 *
 * The trigger is now an IconButton, which is 40x40 by construction rather than
 * by a hand-written pair of classes, so the specific 39.1px trap is gone. The
 * measurement stays: it is the assertion that survives someone swapping the
 * component out again, which is exactly how the original bug arrived.
 */
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

const admin =
  SERVICE && SUPA_URL
    ? createClient<Database>(SUPA_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/*
 * A skip must not read as a pass in CI. Locally neither secret is present
 * (.env.local's INGEST_SECRET is empty and the service key is a placeholder),
 * so skipping is honest; in CI both exist, and a silent skip there would be
 * indistinguishable from a green run on the summary line.
 */
if (process.env.CI && (!admin || !DEMO_PASSWORD)) {
  throw new Error(
    "report-job-posting spec cannot run in CI: missing secret, service key, or demo password",
  );
}

/**
 * Open a card's report panel, tolerating a page that is not interactive yet.
 *
 * THE FIRST CLICK AFTER A FULL DOCUMENT LOAD GETS SWALLOWED. The jobs feed
 * renders 153 report buttons, and React attaches no onClick until the whole
 * list has hydrated — Playwright's actionability checks all pass in the
 * meantime, because the button is visible, enabled and unobstructed. It is
 * simply not wired up yet, so the click lands on nothing and is lost with no
 * error anywhere, and the test then hangs on the panel that never opened.
 *
 * That is why only the half of the test after `reload()` failed: arriving
 * from /login is a CLIENT-SIDE navigation onto an already-hydrated page,
 * while a reload starts hydration over. Instrumented on a dev server, the
 * trigger's aria-expanded stayed false through the first click and flipped on
 * the second, ~1.2s later.
 *
 * Clicking only when the panel is not already open matters — the trigger is a
 * toggle, so a blind retry would close what the previous attempt opened and
 * the loop would never converge.
 *
 * The underlying exposure is the PRODUCT'S, not the test's: a person clicking
 * Report in that window loses the click just as silently. That is generic
 * React hydration rather than a defect in this component, and it is filed
 * separately rather than worked around here.
 */
async function openReportPanel(page: Page, trigger: Locator): Promise<void> {
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("reporting a posting", () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");

  test.afterAll(async () => {
    if (!admin) return;
    /*
     * CLEANED BY REPORTER, not by details text.
     *
     * This used to delete only `details ilike 'E2E-REPORT%'`, which cannot see
     * the row the idempotency check below submits — that one is sent with the
     * details box deliberately EMPTY, so its `details` is null. Normally the
     * unique constraint refuses it and no row exists to clean. But when the
     * first submission does not land, the second one succeeds instead, writes
     * a null-details row, and nothing ever removes it. From then on the demo
     * account has already reported that posting, so every future run sees
     * "already reported this one" where it expects the confirmation, and the
     * suite fails on a line that has nothing to do with the cause.
     *
     * That is not hypothetical — it is what was sitting in the CI project when
     * this was written, and it made the first test fail on a branch that never
     * touched it.
     *
     * The reporter id covers both rows and cannot be outrun by a change to the
     * copy in the details box.
     */
    const { data: demo } = await admin
      .from("profiles").select("id").eq("email", "demo@talentrah.dev").maybeSingle();
    if (demo?.id) {
      const { error } = await admin
        .from("job_posting_reports").delete().eq("reporter_id", demo.id);
      if (error) console.error("[report cleanup] by reporter:", error.message);
    } else {
      console.error("[report cleanup] demo profile not found — falling back to details match");
    }
    // Belt and braces: anything tagged by an older run, whoever filed it.
    const { error } = await admin
      .from("job_posting_reports")
      .delete()
      .ilike("details", "E2E-REPORT%");
    if (error) console.error("[report cleanup]", error.message);
  });

  test("the affordance is a real target, and reporting is idempotent per person", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo@talentrah.dev");
    await page.getByLabel("Password").fill(DEMO_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/jobs");

    const trigger = page.getByRole("button", { name: "Report" }).first();
    const box = await trigger.boundingBox();
    expect(box, "the Report trigger should be on the page").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    const panel = page.getByRole("dialog");
    await openReportPanel(page, trigger);

    // Each reason's real target is the label wrapping the 13px radio — the
    // same "the glyph is small, the target is not" shape as FilterChip's x.
    const labels = await page.evaluate(() => {
      const p = document.querySelector('[role="dialog"]')!;
      return [...p.querySelectorAll("label")]
        .filter((l) => l.querySelector('input[type="radio"]'))
        .map((l) => {
          const r = l.getBoundingClientRect();
          return { w: r.width, h: r.height };
        });
    });
    expect(labels).toHaveLength(4);
    for (const l of labels) {
      expect(l.w).toBeGreaterThanOrEqual(40);
      expect(l.h).toBeGreaterThanOrEqual(40);
    }

    // Clicking the label, not the dot, must select the radio.
    await page.getByText("The posting is discriminatory").click();
    expect(
      await page.locator('input[value="discriminatory"]').isChecked(),
    ).toBe(true);

    // Escape dismisses it, like the Farah menu next to it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    await openReportPanel(page, trigger);
    await page.getByText("It looks like a scam").click();
    await page
      .locator('textarea[name="details"]')
      .fill("E2E-REPORT: asks for a training fee up front.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("that's with our team")).toBeVisible({
      timeout: 15000,
    });

    // Second time, same person, same posting: the unique constraint answers.
    await page.reload();
    await openReportPanel(
      page,
      page.getByRole("button", { name: "Report" }).first(),
    );
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("already reported this one")).toBeVisible({
      timeout: 15000,
    });
  });

  /*
   * THE OPERATOR-QUEUE TESTS NOW DRIVE THE SCREEN, not the retired route.
   *
   * They used to GET /api/admin/moderate-job-posting with a shared secret and
   * assert on JSON. That route is gone — every property it authenticated is
   * now behind an admin session with per-operator attribution — and the JSON
   * was never what anyone read: it was a proxy for a page, and a proxy can
   * agree with the handler while the page renders something else. The M2
   * restore bug is the proof: the query was correct and the screen still
   * offered a button that could not fire.
   *
   * WHERE THE OLD PROPERTIES WENT, so nothing is quietly dropped:
   *
   *   ranked by distinct reporters   -> here, read off the rendered queue
   *   a removed posting drops out    -> here
   *   a restored posting comes back  -> tests/rls/admin-content-enforcement,
   *                                     because there is no restore UI on main
   *                                     to drive: /admin/reports offers a
   *                                     Restore button on a queue that filters
   *                                     removed postings out, so it can never
   *                                     fire. #132 fixes that; until it lands
   *                                     the round trip is asserted at the
   *                                     database layer, where it does work.
   *   refused without a credential   -> e2e/admin-action-permissions
   *   remove/restore act once        -> tests/rls/admin-content-enforcement
   *   restore lands on `closed`      -> tests/rls/admin-content-enforcement
   *   a reason is required both ways -> tests/rls/admin-content-enforcement
   */
  test("the operator queue counts people, not clicks, and a removal drops out", async ({
    page,
  }) => {
    // Generous, because this now QUEUES on the operators lease before it does
    // anything — see 0082. The fixture below is a Super Admin, so it moves the
    // global `admin_operators_covered()` count that admin-permissions asserts
    // on, and running unlocked would make that suite fail somewhere else
    // entirely for a reason nothing in its own file explains.
    test.setTimeout(420_000);
    if (!admin) return;
    const releaseOperatorsLock = await acquireOperatorsLock(
      admin,
      "e2e-report-job-posting",
    );
    // Everything from here is inside a guard: the fixture inserts below can
    // throw too, and a lease held past a throw starves every other suite
    // that needs it until the TTL expires.
    try {
      /*
       * THE QUEUE THIS READS IS BUILT BY THIS TEST, on purpose.
       *
       * The first draft asserted the ranking over whatever happened to be in the
       * queue, and would have "passed" against a queue of one row — where
       * "sorted descending" is true of every possible ordering. The seeker test
       * above leaves exactly one report, so that is the case it would have hit
       * every time: an assertion that reads like it checks ranking and cannot
       * fail. Two postings with different reporter counts is the smallest fixture
       * where the order is capable of being wrong.
       */
      const tag = randomUUID().slice(0, 8);
      const email = `rjp-op-${tag}@talentrah.test`;
      const password = `E2E-${randomUUID()}Aa1!`;

      /*
       * ITS OWN REPORTERS, not two borrowed profiles.
       *
       * This used to take `profiles limit 2`, which in practice returned other
       * suites' transient @talentrah.test accounts — `perm-plain-…` from
       * admin-permissions, `colpriv-owner-…` from column-privileges. Those get
       * deleted by their owning suite's teardown, `job_posting_reports.
       * reporter_id` is ON DELETE CASCADE, and the report simply vanished
       * mid-run. The count then read 1 where the test expected 2, roughly
       * three runs in eight, and the failure pointed at the rendered number
       * rather than at the borrowed fixture that had been deleted underneath
       * it.
       *
       * Borrowing shared state is the same mistake this whole area keeps
       * making. These two accounts belong to this test and are removed by it.
       */
      const reporters: { id: string }[] = [];
      for (const which of ["a", "b"]) {
        const { data: r, error: rErr } = await admin.auth.admin.createUser({
          email: `rjp-reporter-${which}-${tag}@talentrah.test`,
          password: `E2E-${randomUUID()}Aa1!`,
          email_confirm: true,
        });
        if (rErr) throw new Error(`fixture reporter ${which}: ${rErr.message}`);
        reporters.push({ id: r!.user.id });
      }

      const posting = (n: string) => ({
        source_type: "external" as const,
        title: `E2E rank ${n} ${tag}`,
        company_name: `E2E Co ${tag}`,
        external_url: `https://example.invalid/e2e/${tag}/${n}`,
        external_source: "e2e",
        status: "open" as const,
        description: `Fixture posting for the operator-queue e2e (${tag}).`,
        // Unique per posting: the dedup key is a NOT NULL column and two
        // fixtures sharing one would collide with each other.
        dedup_fingerprint: `e2e-${tag}-${n}`,
      });
      const { data: made, error: me } = await admin
        .from("job_postings")
        .insert([posting("busier"), posting("quieter")])
        .select("id, title");
      if (me || !made) throw new Error(`fixture postings: ${me?.message}`);
      const busier = made.find((r) => r.title.includes("busier"))!.id;
      const quieter = made.find((r) => r.title.includes("quieter"))!.id;

      // Two distinct people on one, one person on the other.
      const { error: re } = await admin.from("job_posting_reports").insert([
        {
          job_posting_id: busier,
          reporter_id: reporters[0].id,
          reason: "scam",
          details: `E2E-REPORT rank ${tag} a1`,
        },
        {
          job_posting_id: busier,
          reporter_id: reporters[1].id,
          reason: "scam",
          details: `E2E-REPORT rank ${tag} a2`,
        },
        {
          job_posting_id: quieter,
          reporter_id: reporters[0].id,
          reason: "scam",
          details: `E2E-REPORT rank ${tag} b1`,
        },
      ]);
      if (re) throw new Error(`fixture reports: ${re.message}`);

      const { data: u, error: ue } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (ue) throw new Error(`fixture operator: ${ue.message}`);
      const { data: role } = await admin
        .from("admin_roles")
        .select("id")
        .eq("name", "Super Admin")
        .single();
      const { error: ae } = await admin
        .from("admin_users")
        .insert({
          id: u!.user.id,
          email,
          display_name: "rjp probe",
          role_id: role!.id,
        });
      if (ae) throw new Error(`fixture admin_users: ${ae.message}`);

      try {
        await page.goto("/admin/login");
        await page.locator("#admin-email").fill(email);
        await page.locator("#admin-password").fill(password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForURL((x) => !x.pathname.startsWith("/admin/login"), {
          timeout: 30_000,
        });

        await page.goto("/admin/reports");
        expect(new URL(page.url()).pathname).toBe("/admin/reports");

        // The wording is load-bearing: an operator acting on "12" has to know it
        // is twelve people and not one person twelve times. 0057's unique
        // constraint is what makes that true.
        await expect(page.getByText(/one report per person/i)).toBeVisible();

        const rowFor = (id: string) =>
          page.locator(`ul > li:has(input[name="id"][value="${id}"])`);
        await expect(rowFor(busier)).toHaveCount(1);
        await expect(rowFor(quieter)).toHaveCount(1);

        /*
         * Counted as people, and pluralised from the same number.
         *
         * Read off the COUNT ELEMENT, not the row. `toContainText("2")` on the
         * whole row passed under a sabotage that pinned every count to 1,
         * because the reason chip says "Scam · 2" — the assertion was true for
         * a reason that had nothing to do with what it claimed to check.
         */
        const countOf = (id: string) => rowFor(id).locator("span.font-display").first();
        await expect(countOf(busier)).toHaveText("2");
        await expect(rowFor(busier)).toContainText("people");
        await expect(countOf(quieter)).toHaveText("1");
        await expect(rowFor(quieter)).toContainText("person");

        // Ranked worst-first: the busier posting is ABOVE the quieter one.
        const order = await page
          .locator('ul > li input[name="id"]')
          .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        expect(order).toContain(busier);
        expect(order).toContain(quieter);
        expect(
          order.indexOf(busier),
          "two reporters must outrank one",
        ).toBeLessThan(order.indexOf(quieter));

        // Removing takes it out of the queue.
        //
        // Keyed on the row's hidden `id` input, not on rendered text: an earlier
        // draft matched `.eq("title", …)` against `h2` innerText and read back
        // nothing, which is indistinguishable from "the write never happened".
        // The id is what the form itself posts, so it is the action's own key.
        const first = rowFor(busier);
        await first
          .getByRole("textbox")
          .fill("E2E: removed by the queue test.");
        await first
          .getByRole("button", { name: "Remove from the board" })
          .click();

        await expect(rowFor(busier)).toHaveCount(0, { timeout: 15_000 });
        /*
         * The other posting is still there — proving the removal was targeted
         * and that `busier` did not "disappear" merely because the whole queue
         * failed to render.
         *
         * Timed out generously ON PURPOSE. The default 5s made this flake when
         * both tests in this file run in sequence: the revalidation after the
         * removal empties the list briefly, the assertion above is SATISFIED by
         * that empty state, and this one then raced the re-render. This is the
         * assertion that makes the previous one mean something, so it has to
         * wait for the page to settle rather than catch it mid-swap.
         */
        await expect(rowFor(quieter)).toHaveCount(1, { timeout: 15_000 });

        // And the database agrees, with the operator NAMED — the thing a shared
        // secret could never do: it proved "an operator", never which one.
        const { data: after, error: afterErr } = await admin
          .from("job_postings")
          .select("status, removed_by")
          .eq("id", busier)
          .single();
        if (afterErr)
          throw new Error(`re-read of ${busier} failed: ${afterErr.message}`);
        expect(after?.status).toBe("removed");
        expect(after?.removed_by, "the remover must be recorded").toBe(
          u!.user.id,
        );
      } finally {
        // Postings cascade their reports away (0057).
        const { error: dp } = await admin
          .from("job_postings")
          .delete()
          .in("id", [busier, quieter]);
        if (dp) console.error("[rjp cleanup] postings:", dp.message);
        const { error: da } = await admin
          .from("admin_audit_log")
          .delete()
          .eq("admin_user_id", u!.user.id);
        if (da) console.error("[rjp cleanup] audit:", da.message);
        const { error: du } = await admin
          .from("admin_users")
          .delete()
          .eq("id", u!.user.id);
        if (du) console.error("[rjp cleanup] admin_users:", du.message);
        const { error } = await admin.auth.admin.deleteUser(u!.user.id);
        if (error) console.error("[rjp cleanup] user:", error.message);
        // The reporters too — they are this test's, so it removes them. Their
        // reports go with them by cascade, which is why this can run after the
        // postings have already been deleted.
        for (const r of reporters) {
          const { error: dr } = await admin.auth.admin.deleteUser(r.id);
          if (dr) console.error("[rjp cleanup] reporter:", dr.message);
        }
      }
    } finally {
      // Unconditional: released whether the fixtures, the assertions or
      // the cleanup above threw.
      await releaseOperatorsLock();
    }
  });
});
