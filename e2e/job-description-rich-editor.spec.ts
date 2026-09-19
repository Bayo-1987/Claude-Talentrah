/**
 * send-367 — the real WYSIWYG editor replacing the job-description /
 * assessment-instructions plain textarea, driven through an actual browser
 * against a real `npm run build && npm run start` server: the founder's own
 * reported bug (pasting a real formatted job description flattened every
 * heading and bullet into one wall of text) reproduced and fixed, plus the
 * three things a pure-function unit test cannot prove — that a REAL paste
 * event converts correctly, that pasted content outside the supported
 * subset is actually flattened by the browser's own HTML parser feeding
 * this app's sanitizer (not just asserted against a hand-built HTML
 * string), and that a literal `<script>`/`<img onerror>` payload — typed OR
 * pasted — renders as inert text through the REAL published page, not just
 * the editor's own live view.
 *
 * `tests/employer/markdown-editor-roundtrip.test.ts` already proves the
 * deserializer/serializer pair is byte-faithful against real production
 * descriptions in isolation; this file proves the same pipeline holds when
 * driven by an actual browser paste event and a real save/reload/render
 * cycle.
 */
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import type { Page } from "@playwright/test";

/**
 * The form requires at least one skill to publish — unrelated to this
 * feature, but every test below that submits the form needs one regardless
 * of whether its own pasted/typed description happens to contain a real
 * `SKILL_VOCABULARY` term. `sql` is real vocabulary; Enter commits the top
 * filtered suggestion (see SkillsAutocomplete's own `onKeyDown`).
 */
async function addSkill(page: Page, skill: string) {
  await page.getByLabel("Skills seekers are matched against").fill(skill);
  await page.getByLabel("Skills seekers are matched against").press("Enter");
}

async function createVerifiedOrg(page: Page, orgName: string) {
  await page.goto("/employer/onboarding");
  await page.getByLabel("Company name").fill(orgName);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/employer\/jobs$/);
  const { data: org } = await admin.from("organizations").select("id").eq("name", orgName).single();
  await admin.from("organizations").update({ verified: true }).eq("id", org!.id);
  return org!.id as string;
}

/**
 * Dispatches a real `paste` ClipboardEvent at the editor's own contenteditable
 * root (`#description`/`#assessment-instructions` — the id `editorProps.attributes`
 * assigns in rich-markdown-editor.tsx), carrying both `text/html` and
 * `text/plain` payloads exactly the way a browser's own paste does. This is
 * what actually exercises `transformPastedHTML` (the sanitizer) and
 * ProseMirror's own HTML-to-document parsing — a `.fill()`/`.type()` call
 * would never touch either.
 */
async function pasteHtml(page: Page, selector: string, html: string, text: string) {
  await page.locator(selector).click();
  await page.evaluate(
    ({ selector, html, text }) => {
      const el = document.querySelector(selector) as HTMLElement;
      el.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/html", html);
      dataTransfer.setData("text/plain", text);
      const event = new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    },
    { selector, html, text },
  );
}

test.describe("rich job-description editor", () => {
  let alertFired = false;

  test.beforeEach(({ page }) => {
    alertFired = false;
    // The concrete test for the injection concern: if ANY payload this
    // suite pastes or types ever executes rather than rendering as inert
    // text, a real `alert(1)` fires and this catches it — the test fails
    // loudly instead of a dialog silently blocking the page.
    page.on("dialog", async (dialog) => {
      alertFired = true;
      await dialog.dismiss();
    });
  });

  test.afterEach(async () => {
    await runCleanups([
      "rich-editor e2e organisations",
      async () => {
        const { data: orgs, error } = await admin
          .from("organizations")
          .select("id")
          .like("name", "E2E Rich Editor Co%");
        if (error) throw new Error(`listing organisations: ${error.message}`);
        await deleteOrgsCascade(admin, (orgs ?? []).map((o) => o.id));
      },
    ]);
  });

  test("pasting real rich HTML (bold, heading, bulleted list) converts live, and the founder's own reported wall-of-text bug does not reproduce", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Rich Editor Co ${testUser.id.slice(0, 8)}`);
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Rich Editor Role ${testUser.id.slice(0, 6)}`);

    // Representative of real Word/Docs/Gmail clipboard HTML: a heading, a
    // bold run, and a bulleted list — exactly the constructs the founder's
    // real pasted job-description document used and that came out flattened
    // before this feature existed.
    await pasteHtml(
      authedPage,
      "#description",
      "<h2>About the role</h2><p>We need someone with <strong>real ownership</strong>.</p><ul><li>Ship features</li><li>Own outcomes</li></ul>",
      "About the role\nWe need someone with real ownership.\nShip features\nOwn outcomes",
    );

    // Live-converted, not flattened: a real <h2>/<strong>/<li> exist in the
    // editor's own rendered DOM right after paste, before any save.
    await expect(authedPage.locator("#description h2")).toHaveText("About the role");
    await expect(authedPage.locator("#description strong")).toHaveText("real ownership");
    await expect(authedPage.locator("#description li")).toHaveCount(2);

    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    const { data: job, error } = await admin.from("job_postings").select("description").eq("id", jobId).single();
    if (error) throw error;
    // A real browser's own form submission normalizes `\n` to `\r\n` in
    // submitted text field values (standard HTML forms behaviour, not
    // something this feature's own code does) — the same, already-
    // documented CRLF normalization markdown-editor-roundtrip.test.ts
    // and document.ts's own header both call out. Real production data
    // (the Fabricator posting) already stores `\r\n` too.
    expect(job!.description?.replace(/\r\n/g, "\n")).toBe(
      "## About the role\n\nWe need someone with **real ownership**.\n\n- Ship features\n- Own outcomes",
    );

    // The REAL published page, through the REAL renderer — not the editor's
    // own view. This is what a job seeker actually sees.
    await authedPage.goto(`/jobs/${jobId}`);
    const description = authedPage.getByTestId("job-full-description");
    await expect(description.locator("h2, p.font-semibold")).toContainText("About the role");
    await expect(description.locator("strong")).toHaveText("real ownership");
    await expect(description.locator("li")).toHaveCount(2);
  });

  test("pasting content outside the supported subset flattens to plain text, never smuggled through", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Rich Editor Co ${testUser.id.slice(0, 8)}`);
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Rich Editor Role ${testUser.id.slice(0, 6)}`);

    // A table, an image, a font-colored span, and a hyperlink whose visible
    // text lies about its destination — none of these have a node/mark this
    // editor's schema can represent.
    await pasteHtml(
      authedPage,
      "#description",
      '<p>Notes:</p><table><tr><td>Cell A</td><td>Cell B</td></tr></table><img src="https://evil.example/x.png" alt="tracker"><span style="color:red;text-decoration:underline">warning text</span><p><a href="https://evil.example/phish">Click here for your prize</a></p>',
      "Notes:\nCell A\tCell B\ntracker\nwarning text\nClick here for your prize",
    );

    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    const { data: job, error } = await admin.from("job_postings").select("description").eq("id", jobId).single();
    if (error) throw error;

    // No table markup, no <img> reference, no href anywhere in the stored
    // string — only the plain visible text the schema CAN represent
    // survived, exactly the "flattened, never smuggled through" contract.
    expect(job!.description).not.toContain("evil.example");
    expect(job!.description).not.toMatch(/<[a-z]/i);
    expect(job!.description).toContain("Notes:");
    expect(job!.description).toContain("Cell A");
    expect(job!.description).toContain("Cell B");
    expect(job!.description).toContain("warning text");
    // The misleading label survives as plain text — its lie just has
    // nowhere to point any more.
    expect(job!.description).toContain("Click here for your prize");

    // And the real published page never renders an <a> for it either.
    await authedPage.goto(`/jobs/${jobId}`);
    const description = authedPage.getByTestId("job-full-description");
    await expect(description.locator("a")).toHaveCount(0);
  });

  test("a literal <script>/<img onerror> payload — typed AND pasted — renders as inert text through the real published page, never executes", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Rich Editor Co ${testUser.id.slice(0, 8)}`);
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Rich Editor Role ${testUser.id.slice(0, 6)}`);

    // Typed, character by character — exactly as brittle as a real employer
    // fat-fingering angle brackets, with no clipboard/HTML path involved at
    // all. The plain textarea this replaces already handled this correctly
    // (inert text); this proves the rich editor still does.
    await authedPage.locator("#description").click();
    await authedPage.keyboard.type('<script>alert(1)</script> and <img src=x onerror=alert(1)>');

    // Pasted as an actual HTML clipboard payload — the harder case, since
    // this exercises transformPastedHTML/ProseMirror's own HTML parsing,
    // not just character-by-character typing into plain text.
    await pasteHtml(
      authedPage,
      "#description",
      "<p><script>alert(2)</script> pasted <img src=x onerror=alert(2)></p>",
      "pasted",
    );

    expect(alertFired, "no script must ever execute inside the editor itself").toBe(false);

    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    const { data: job, error } = await admin.from("job_postings").select("description").eq("id", jobId).single();
    if (error) throw error;
    // The typed literal characters survive as literal text — same "never
    // parsed, never dropped silently, always visible as what it literally
    // is" guarantee render-markdown.tsx's own header describes.
    expect(job!.description).toContain("<script>alert(1)</script>");
    expect(job!.description).not.toContain("<script>alert(2)</script>");

    // The real published page, reloaded fresh — the concrete, explicit test
    // this feature's own spec calls for: not just the editor's own preview.
    await authedPage.goto(`/jobs/${jobId}`);
    expect(alertFired, "no script must ever execute on the real published page").toBe(false);
    const bodyText = await authedPage.getByTestId("job-full-description").innerText();
    expect(bodyText).toContain("<script>alert(1)</script>");
    expect(bodyText).toContain("onerror=alert(1)");
  });

  test("extractStructuredJd's skill suggestion still runs off the same stored string", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Rich Editor Co ${testUser.id.slice(0, 8)}`);
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Rich Editor Role ${testUser.id.slice(0, 6)}`);
    await authedPage.locator("#description").click();
    await authedPage.keyboard.type(
      "We need strong experience with typescript, sql, and react for this role.",
    );
    // Scoped to the skill CHIP specifically (its "Remove … filter" button
    // has a unique accessible name) rather than plain text — the typed
    // sentence in the editor already contains these same words verbatim,
    // which would otherwise make a bare text match ambiguous. Lowercase,
    // matching SKILL_VOCABULARY's own stored casing exactly (extract-jd.ts
    // returns the vocabulary entries themselves, unmodified). Same debounce
    // this field already had as a plain textarea — see job-posting-form.tsx's
    // own handleDescriptionChange comment.
    await expect(authedPage.getByRole("button", { name: "Remove typescript filter" })).toBeVisible({
      timeout: 3000,
    });
    await expect(authedPage.getByRole("button", { name: "Remove sql filter" })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "Remove react filter" })).toBeVisible();
  });

  test("the assessment instructions field round-trips independently, with its own real content", async ({
    authedPage,
    testUser,
  }) => {
    await createVerifiedOrg(authedPage, `E2E Rich Editor Co ${testUser.id.slice(0, 8)}`);
    await authedPage.goto("/employer/jobs/new");
    await authedPage.getByLabel("Job title").fill(`E2E Rich Editor Role ${testUser.id.slice(0, 6)}`);
    await authedPage.locator("#description").click();
    // Must clear the form's own 40-character minimum (postJobAction).
    await authedPage.keyboard.type("A short internal role description, at least a couple of sentences long.");

    await authedPage.getByLabel("Attach an assessment (optional)").check();
    // Scoped by id — "Title" alone is ambiguous with the job posting's own
    // "Job title" field once accessible-name matching considers substrings.
    await authedPage.locator("#assessment-title").fill("Take-home exercise");
    await pasteHtml(
      authedPage,
      "#assessment-instructions",
      "<p>Please complete the attached <strong>SQL exercise</strong> and reply within 48 hours.</p>",
      "Please complete the attached SQL exercise and reply within 48 hours.",
    );
    await expect(authedPage.locator("#assessment-instructions strong")).toHaveText("SQL exercise");

    await addSkill(authedPage, "sql");
    await authedPage.getByRole("button", { name: "Publish job" }).click();
    await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
    const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

    const { data: assessment, error } = await admin
      .from("job_posting_assessments")
      .select("instructions")
      .eq("job_posting_id", jobId)
      .single();
    if (error) throw error;
    expect(assessment!.instructions).toBe(
      "Please complete the attached **SQL exercise** and reply within 48 hours.",
    );
  });

  test(
    "send-382: the <meta name=\"description\"> tag and the JobPosting JSON-LD description are clean plain " +
      "text, not raw markdown — real live bug (Moniepoint posting shipped with literal \"**Who We Are**\")",
    async ({ authedPage, testUser }) => {
      // The org name keeps the "E2E Rich Editor Co" prefix this file's own
      // afterEach cleanup filters on (`.like("name", "E2E Rich Editor Co%")`
      // below) — a shorter, differently-prefixed name here would silently
      // stop matching that filter and leak orgs. The job TITLE is what's
      // deliberately kept short instead: generateMetadata's own meta
      // description is cut to ~155 chars total (`lead` + a snippet of
      // `body`), and a long `lead` here would leave too little `room` for
      // the snippet to reach the bulleted content below, confounding this
      // test with that separate, pre-existing truncation logic rather than
      // testing markdown-stripping specifically.
      const shortId = testUser.id.slice(0, 6);
      await createVerifiedOrg(authedPage, `E2E Rich Editor Co ${shortId}`);
      await authedPage.goto("/employer/jobs/new");
      await authedPage.getByLabel("Job title").fill(`Meta Role ${shortId}`);
      await authedPage.getByLabel("Location").fill("Lagos, Nigeria");

      // A heading, a bold run, and a bulleted list — the exact real-shaped
      // combination the internal editor can produce (and, separately, the
      // exact **bold**/- bullet shape stripHtml produces for an EXTERNAL,
      // schema.org-ingested posting like the real Moniepoint one this bug
      // was found on).
      await pasteHtml(
        authedPage,
        "#description",
        "<h2>Who We Are</h2><p>We build <strong>payment infrastructure</strong> across Africa.</p><ul><li>Investigate fraud attacks</li><li>Propose mitigations</li></ul>",
        "Who We Are\nWe build payment infrastructure across Africa.\nInvestigate fraud attacks\nPropose mitigations",
      );

      await addSkill(authedPage, "sql");
      await authedPage.getByRole("button", { name: "Publish job" }).click();
      await expect(authedPage).toHaveURL(/\/employer\/jobs\?posted=.+$/);
      const jobId = new URL(authedPage.url()).searchParams.get("posted")!;

      await authedPage.goto(`/jobs/${jobId}`);

      const metaDescription = await authedPage
        .locator('meta[name="description"]')
        .getAttribute("content");
      expect(metaDescription, "meta description was missing entirely").not.toBeNull();
      expect(metaDescription, "raw ** bold markers leaked into the meta description").not.toContain("**");
      expect(
        metaDescription,
        "a leading bullet dash leaked into the meta description",
      ).not.toContain("- Investigate");
      expect(metaDescription).toContain("payment infrastructure across Africa");
      // NOT asserting "Investigate fraud attacks" survives here — the meta
      // description's own ~155-char snippet cap (generateMetadata's `room`)
      // is a separate, pre-existing, unrelated piece of logic, and whether
      // the tail end of a long description survives it depends on exactly
      // how many characters `lead` and the un-stripped "## " (see the known-
      // gap block below) ate into that budget. The JSON-LD description below
      // has no such cap, so it's the one that checks the bulleted content
      // itself survived stripping intact.

      const jsonLdRaw = await authedPage.locator('script[type="application/ld+json"]').textContent();
      expect(jsonLdRaw, "no JobPosting JSON-LD script tag on the page").not.toBeNull();
      const jsonLd = JSON.parse(jsonLdRaw!);
      expect(jsonLd.description, "raw ** bold markers leaked into the JSON-LD description").not.toContain(
        "**",
      );
      expect(
        jsonLd.description,
        "a leading bullet dash leaked into the JSON-LD description",
      ).not.toContain("- Investigate");
      expect(jsonLd.description).toContain("payment infrastructure across Africa");
      expect(jsonLd.description).toContain("Investigate fraud attacks");
      expect(jsonLd.description).toContain("Propose mitigations");

      /*
       * KNOWN, DELIBERATELY UNFIXED GAP — confirmed here, not just asserted
       * in a comment: stripMarkdownToPlainText (extract-jd.ts) was built for
       * stripHtml's own narrow output grammar (`**bold**` and leading `- `
       * bullets only — see that function's own doc comment), not the FULL
       * grammar the internal job-description WYSIWYG editor supports
       * (headings, single-`*`/`_` italic, numbered lists, blockquotes,
       * horizontal rules, links). A `## ` heading marker is NOT stripped by
       * either fix in this send, so it survives into both surfaces below.
       * send-382 explicitly scoped its fix to reusing stripMarkdownToPlainText
       * "rather than writing a second stripper" — this assertion exists so
       * that scoping decision stays a documented, tested fact instead of an
       * assumption, and so a future full-grammar stripper (if one is ever
       * built) has a failing test here to turn green rather than a silent
       * gap nobody is watching.
       */
      expect(metaDescription).toContain("## Who We Are");
      expect(jsonLd.description).toContain("## Who We Are");
    },
  );
});
