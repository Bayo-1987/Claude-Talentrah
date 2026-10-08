/**
 * Migration 0217: a VERIFIED listing may carry a deadline note only if its deadline was verified. A listing added by hand never has a verified deadline, so the form used to SAVE it as
 * pending with a note and only refuse it later, at approval ("A deadline note needs a verified-deadline date. ..."): the operator learned the rule after the work was done. The form now
 * refuses at SAVE with the same message, on the Deadline note field, and saves nothing. A listing without a note saves as before, and an ingested listing is untouched (it comes through
 * upsertScholarships with its own verified stamp, never through this action). Browser proof: e2e/admin-scholarship-deadline-note.spec.ts (QA's, test 1 red before this change).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handEntryNoteRefusal, NOTE_NEEDS_STAMP_MESSAGE } from "@/lib/scholarships/public-deadline-note";

const actions = readFileSync(path.join(__dirname, "../../src/lib/scholarships/admin-actions.ts"), "utf8").replace(/\s+/g, " ");

describe("handEntryNoteRefusal", () => {
  it("a hand-added listing WITH a deadline note is refused with the approval message", () => {
    expect(handEntryNoteRefusal("Varies by partner institution")).toBe(NOTE_NEEDS_STAMP_MESSAGE);
    expect(NOTE_NEEDS_STAMP_MESSAGE).toMatch(/^A deadline note needs a verified-deadline date\./);
  });
  it("no note, an empty note, or a blank one is not refused (the listing saves and approves as before)", () => {
    for (const none of [undefined, null, "", "   ", "\n\t"]) expect(handEntryNoteRefusal(none), JSON.stringify(none)).toBeNull();
  });
});

describe("createScholarshipAction", () => {
  const create = actions.slice(actions.indexOf("export async function createScholarshipAction"));
  it("refuses a note BEFORE anything is written (the check comes before upsertScholarships)", () => {
    const check = create.indexOf("handEntryNoteRefusal(");
    const write = create.indexOf("upsertScholarships(");
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeLessThan(write);
  });
  it("shows the message once, on the Deadline note field (the banner stays 'Check the highlighted fields.')", () => {
    expect(create).toMatch(/deadlineNote: \[noteRefusal\]/);
    expect(create).toContain('error: "Check the highlighted fields."');
  });
});
