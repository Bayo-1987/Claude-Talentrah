/**
 * No raw <textarea> outside the shared component (S1-56).
 *
 * Every multi-line field uses src/components/ui/text-area.tsx so every writing surface is one family: same frame, label, help, error and
 * character counter. The bold/italic and full editors are TipTap, not <textarea>, so they need no exception. A new raw <textarea> fails
 * here and should become a <TextArea>.
 *
 * PENDING lists the files whose conversion is a later step on purpose (each entry says why); the list only ever shrinks.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");

const ALLOWED = ["src/components/ui/text-area.tsx"];

/** Conversions that belong to a later PR or to another owner, with the reason. */
const PENDING: Record<string, string> = {
  "src/app/admin/(protected)/scholarships/new/admin-scholarship-form.tsx": "scholarship file; deferred to the scholarship owner (reviewNote, deadline note)",
  "src/app/(app)/mentorship/sessions/review-form.tsx": "call-site migration: PR 1b",
  "src/app/employer/talent-directory/[candidateId]/contact-request-form.tsx": "call-site migration: PR 1b",
  "src/components/admin/blog-post-form.tsx": "call-site migration: PR 1b",
  "src/components/admin/decision-form.tsx": "call-site migration: PR 1b",
  "src/components/jobs/report-job-menu.tsx": "call-site migration: PR 1b",
  "src/components/jobs/screening-gate-apply.tsx": "call-site migration: PR 1b",
  "src/components/marketing/jd-demo-input.tsx": "call-site migration: PR 1b",
  "src/components/resume-builder/resume-editor.tsx": "call-site migration: PR 1b",
  "src/components/scholarships/farah-actions.tsx": "call-site migration: PR 1b",
  "src/components/tailoring/tailor-form.tsx": "call-site migration: PR 1b",
  "src/components/tracker/notes-form.tsx": "call-site migration: PR 1b",
};

describe("no raw <textarea>", () => {
  const files = walk(join(ROOT, "src")).map((p) => ({ path: relative(ROOT, p), code: stripComments(readFileSync(p, "utf8")) }));

  it("scans the source it should (the check itself is not empty)", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.path === "src/components/ui/text-area.tsx" && /<textarea\b/.test(f.code))).toBe(true);
  });

  it("every <textarea> is the shared component's, or on the pending list", () => {
    const raw = files.filter((f) => /<textarea\b/.test(f.code)).map((f) => f.path).filter((p) => !ALLOWED.includes(p)).sort();
    const unexpected = raw.filter((p) => !(p in PENDING));
    expect(unexpected, "use <TextArea> from @/components/ui instead of a raw <textarea>").toEqual([]);
  });

  it("the pending list names only files that still have a raw <textarea> (it shrinks as they convert)", () => {
    const stale = Object.keys(PENDING).filter((p) => !files.find((f) => f.path === p && /<textarea\b/.test(f.code)));
    expect(stale, "converted already: remove from PENDING").toEqual([]);
  });
});
