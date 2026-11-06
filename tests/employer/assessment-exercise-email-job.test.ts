/**
 * PR-E2b: the upload route for an assessment exercise refuses a job whose applications arrive by email (there is no in-app assessment to attach it to). Read as source, like the other route
 * wiring checks: the route needs a signed-in organisation member and a file upload.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(process.cwd(), "src/app/api/employer/job-assessment-exercise/route.ts"), "utf8").replace(/\s+/g, " ");

describe("job-assessment-exercise route", () => {
  it("the upload handler reads the column and refuses an email job with 409 and a plain sentence", () => {
    expect(src).toContain('.select("id, organization_id, source_type, import_feed_id, apply_email")');
    expect(src).toContain('if (takesApplicationsByEmail(job)) { return NextResponse.json({ error: "This job takes applications by email, so it can\'t have an assessment." }, { status: 409 }); }');
  });
  it("only the upload handler refuses: deleting an existing file stays possible", () => {
    expect(src.match(/takesApplicationsByEmail\(job\)/g)).toHaveLength(1);
  });
});
