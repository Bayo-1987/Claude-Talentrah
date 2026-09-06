/**
 * Confirms the self-healing claim in CLAUDE.md's Auto-Apply/ingestion notes
 * and this bug's own fix: "existing rows self-correct on their next normal
 * ingest pass once the function is fixed — no backfill script needed."
 *
 * That claim rests on two facts that are each true independently, and this
 * test is only responsible for the first:
 *
 *   1. `fetchGreenhouseJobs` (src/lib/jobs/sources/greenhouse.ts) recomputes
 *      `description` from the board's raw `content` on EVERY call, via the
 *      now-fixed `stripHtml` — it never reads or reuses a previously stored
 *      value. Proven here, DB-free, using the actual shape of job
 *      79a05392-4621-4038-b13d-661cd2edb4ca's real Greenhouse source
 *      (double-escaped "&amp;amp;" inside a `<li><p><strong>` sub-header).
 *   2. `ingestAllSources` (src/lib/jobs/ingest.ts) upserts that recomputed
 *      row with `onConflict: "dedup_fingerprint"`, which overwrites
 *      `description` on an existing row rather than skipping it. That part
 *      is untouched by this fix and already exercised against a real
 *      database by tests/jobs/empty-fetch-guard-greenhouse.test.ts and
 *      tests/jobs/ingest-workable-dedup.test.ts (both need `npm run
 *      db:local`, unavailable in this sandbox) — not re-proven here to avoid
 *      a redundant DB-dependent copy of coverage that already exists.
 *
 * Together, (1) here plus (2) already-covered elsewhere is the actual
 * end-to-end guarantee — this file does not claim to be a full ingest
 * integration test on its own.
 */
import { describe, expect, it, vi } from "vitest";
import { fetchGreenhouseJobs } from "@/lib/jobs/sources/greenhouse";

const realFetch = globalThis.fetch;

function mockBoard(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jobs: [
          {
            id: 8011114,
            title: "Senior Learning Experience Designer",
            location: { name: "Remote" },
            absolute_url: "https://boards.greenhouse.io/alxafrica/jobs/8011114",
            content,
            updated_at: new Date().toISOString(),
          },
        ],
      }),
    })),
  );
}

describe("fetchGreenhouseJobs recomputes description from raw content on every call", () => {
  it(
    "SABOTAGE-PROOF TARGET: the exact double-escaped-ampersand, p-wrapped-bullet shape job 79a05392 actually shipped with comes back fully fixed — proving the next ingest run would overwrite the stale stored row",
    async () => {
      // A trimmed but structurally faithful copy of the real
      // boards-api.greenhouse.io/v1/boards/alxafrica/jobs/8011114 payload's
      // `content` field (itself HTML-entity-encoded HTML, per Greenhouse's
      // API) — same double escaping, same <li><p><strong> nesting.
      const rawContent =
        "&lt;h2&gt;&lt;strong&gt;Specific Responsibilities&lt;/strong&gt;&lt;/h2&gt;\n" +
        "&lt;ul&gt;\n" +
        "&lt;li&gt;\n" +
        "&lt;p&gt;&lt;strong&gt;Program &amp;amp; Curriculum Development&lt;/strong&gt;&lt;/p&gt;\n" +
        "&lt;ul&gt;\n" +
        "&lt;li&gt;Oversee the design of new programs.&lt;/li&gt;\n" +
        "&lt;li&gt;Ensure curricula embody our learning design principles.&lt;/li&gt;\n" +
        "&lt;/ul&gt;\n" +
        "&lt;/li&gt;\n" +
        "&lt;/ul&gt;";

      mockBoard(rawContent);
      try {
        const [job] = await fetchGreenhouseJobs("alxafrica", "ALX Africa");

        // Bug 2: no under-decoded entity survives.
        expect(job.description).not.toContain("&amp;");
        expect(job.description).toContain("Program & Curriculum Development");

        // Bug 3: bold preserved, and the two sibling bullets sit on
        // consecutive lines with no blank line between them.
        expect(job.description).toContain("**Program & Curriculum Development**");
        expect(job.description).toContain(
          "- Oversee the design of new programs.\n- Ensure curricula embody our learning design principles.",
        );

        // This IS what ingest.ts's upsert row shape reads directly
        // (`description: job.description`) — no separate transform sits
        // between this return value and the database write.
      } finally {
        vi.stubGlobal("fetch", realFetch);
      }
    },
  );
});
