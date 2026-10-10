/** Job Tracker (TRACKER-ADD-1, TRACKER-HIRED-1): a refused add or stage move is a message in place, never a throw into the error boundary; the add form keeps what was typed. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("tracker actions", () => {
  const actions = read("src/lib/applications/tracker-actions.ts");
  it("neither action throws for a refusal any more (a throw replaced the whole page with 'This page couldn't load'); only sign-in still throws", () => {
    expect(actions.split("throw new Error(").length - 1).toBe(1);
    expect(actions).toContain('throw new Error("Not signed in.")');
  });
});

describe("add-a-job form", () => {
  const form = read("src/components/tracker/manual-entry-form.tsx");
  it("runs through useActionState, shows the result as an alert/status in place, and defaults every field (the Stage select keyed) to the returned values", () => {
    expect(form).toContain("useActionState(addManualEntryAction");
    expect(form).toContain('role={state.status === "error" ? "alert" : "status"}');
    for (const f of ["companyName", "title", "location", "url", "notes"]) expect(form, f).toContain(`inputValue(values, "${f}")`);
    expect(form).toContain('key={selectKey(values, "stage")}');
  });
});

describe("stage select", () => {
  const form = read("src/components/tracker/stage-select.tsx");
  it("shows a refused move as an alert beside the select, and the select stays uncontrolled on the saved stage", () => {
    expect(form).toContain("useActionState(updateStageAction.bind(null, applicationId)");
    expect(form).toContain('<p role="alert"');
    expect(form).toContain("defaultValue={stage}");
  });
});
