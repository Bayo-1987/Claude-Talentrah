/**
 * The seeker's screening gate must always say what is attached, say why Submit is off, and say what was sent.
 *
 * Why (found by the pre-hydration file scan): a file lost before hydration left the seeker's form looking fine. With an
 * optional assessment, or a typed answer, Submit proceeded WITHOUT the attachment and nothing anywhere said so; with a
 * required assessment, Submit sat disabled with no reason given. An application reaching an employer without its
 * attachment, unknown to the seeker, is the worst outcome this form can have.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadModule } from "../support/load-module";

interface Copy {
  NO_FILE_ATTACHED: string;
  attachedItemText(name: string, bytes: number): string;
  sentNoteText(fileNames: string[]): string;
  submitBlockedReason(s: { requiredQuestionsUnanswered: boolean; assessmentResponseMissing: boolean; answerTooLong: boolean }): string | null;
}
const load = () => loadModule<Copy>("@/lib/jobs/screening-gate-copy");

describe("attachment status", () => {
  it("says 'No file attached' when there is none", async () => {
    const { NO_FILE_ATTACHED } = await load();
    expect(NO_FILE_ATTACHED).toBe("No file attached");
  });

  it("names each attached file with its size", async () => {
    const { attachedItemText } = await load();
    expect(attachedItemText("cv.pdf", 12_345)).toBe("Attached: cv.pdf (12 KB)");
    expect(attachedItemText("big.pdf", 2 * 1024 * 1024)).toBe("Attached: big.pdf (2.0 MB)");
  });
});

describe("the confirmation states what was sent", () => {
  it("names the files", async () => {
    const { sentNoteText } = await load();
    expect(sentNoteText(["cv.pdf"])).toBe("Submitted with cv.pdf");
    expect(sentNoteText(["a.pdf", "b.txt"])).toBe("Submitted with a.pdf, b.txt");
  });

  it("says plainly when nothing was attached", async () => {
    const { sentNoteText } = await load();
    expect(sentNoteText([])).toBe("Submitted without an attachment");
  });
});

describe("a disabled Submit says why", () => {
  it("is silent when nothing blocks it", async () => {
    const { submitBlockedReason } = await load();
    expect(submitBlockedReason({ requiredQuestionsUnanswered: false, assessmentResponseMissing: false, answerTooLong: false })).toBeNull();
  });

  it("names a missing required assessment response: a written answer, a link or a file", async () => {
    const { submitBlockedReason } = await load();
    const r = submitBlockedReason({ requiredQuestionsUnanswered: false, assessmentResponseMissing: true, answerTooLong: false });
    expect(r).toMatch(/attach a file/i);
    expect(r).toMatch(/submit/i);
  });

  it("names unanswered required questions", async () => {
    const { submitBlockedReason } = await load();
    expect(submitBlockedReason({ requiredQuestionsUnanswered: true, assessmentResponseMissing: false, answerTooLong: false })).toMatch(/required questions/i);
  });

  it("names an over-long answer", async () => {
    const { submitBlockedReason } = await load();
    expect(submitBlockedReason({ requiredQuestionsUnanswered: false, assessmentResponseMissing: false, answerTooLong: true })).toMatch(/shorten/i);
  });

  it("names every blocker when several apply", async () => {
    const { submitBlockedReason } = await load();
    const r = submitBlockedReason({ requiredQuestionsUnanswered: true, assessmentResponseMissing: true, answerTooLong: false })!;
    expect(r).toMatch(/required questions/i);
    expect(r).toMatch(/attach a file/i);
  });
});

describe("ScreeningGateApply is wired to all of it", () => {
  const read = () => readFileSync(path.join(process.cwd(), "src/components/jobs/screening-gate-apply.tsx"), "utf8");

  it("shows 'No file attached' and the 'Attached:' lines (copy from screening-gate-copy, not typed in)", () => {
    const src = read();
    expect(src).toMatch(/NO_FILE_ATTACHED/);
    expect(src).toMatch(/attachedItemText\(/);
  });

  it("links the disabled Submit to its reason with aria-describedby", () => {
    const src = read();
    expect(src).toMatch(/submitBlockedReason\(/);
    expect(src).toMatch(/aria-describedby=/);
    expect(src).toMatch(/id="submit-blocked-reason"/);
  });

  it("does not claim what was sent from the browser: no sessionStorage note, no client-side 'sent' record", () => {
    const src = read();
    expect(src).not.toMatch(/sessionStorage|writeApplicationSentNote/);
  });
});

describe("the confirmation is read from what was STORED, not from what the browser believes it sent", () => {
  interface Stored {
    storedSentNote(submission: { fileNames: string[] } | null): string | null;
  }
  const load = () => loadModule<Stored>("@/lib/jobs/screening-gate-copy");

  it("names the stored files", async () => {
    const { storedSentNote } = await load();
    expect(storedSentNote({ fileNames: ["cv.pdf"] })).toBe("Submitted with cv.pdf");
    expect(storedSentNote({ fileNames: ["a.pdf", "b.txt"] })).toBe("Submitted with a.pdf, b.txt");
  });

  it("a stored submission with NO stored file says 'without an attachment', whatever the browser tried to upload (e.g. the upload failed)", async () => {
    const { storedSentNote } = await load();
    expect(storedSentNote({ fileNames: [] })).toBe("Submitted without an attachment");
  });

  it("no stored submission at all (no assessment answered) claims nothing", async () => {
    const { storedSentNote } = await load();
    expect(storedSentNote(null)).toBeNull();
  });

  it("the job page reads the stored submission and its files through the application record", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"), "utf8");
    expect(page).toMatch(/fetchStoredSubmission\(/);
    expect(page).not.toMatch(/ApplicationSentNote/);
  });

  it("the query goes application -> submission -> response files, by the application's id", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/jobs/application-submission.ts"), "utf8");
    expect(src).toMatch(/application_assessment_submissions/);
    expect(src).toMatch(/application_assessment_response_files/);
    expect(src).toMatch(/\.eq\("application_id"/);
  });
});
