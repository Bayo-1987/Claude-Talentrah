/**
 * send-494 / S13 — the report-a-posting form must start with NOTHING selected.
 *
 * The first radio was `defaultChecked`, so "It looks like a scam" arrived pre-answered: pressing
 * "Send report" without reading anything filed an accusation of fraud against an employer. The server
 * already refused an empty reason ("Pick a reason before sending."), but the form could never send one,
 * so that branch was unreachable from the UI.
 *
 * The radios live in an exported `ReportReasonFields` so they can be rendered on their own (this repo has
 * no DOM test environment; the menu around them is open/close state, which static markup cannot reach).
 * Imported through loadModule: until the export exists each test fails on its own assertion instead of the
 * file failing to compile.
 */
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";

vi.mock("@/lib/reports/actions", () => ({ reportJobPostingAction: async () => ({ status: "idle" }) }));

interface MenuModule {
  ReportReasonFields?: ComponentType;
}

async function render(): Promise<string> {
  const mod = await loadModule<MenuModule>("@/components/jobs/report-job-menu");
  expect(mod.ReportReasonFields, "ReportReasonFields must be exported from report-job-menu.tsx").toBeTypeOf("function");
  return renderToStaticMarkup(createElement(mod.ReportReasonFields as ComponentType));
}

const radios = (html: string) => [...html.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);

describe("the report form's reason radios", () => {
  it("offers the four reasons, in order", async () => {
    const values = radios(await render()).map((tag) => tag.match(/value="([^"]+)"/)?.[1]);
    expect(values).toEqual(["scam", "closed_but_listed", "discriminatory", "other"]);
  });

  it("starts with none of them selected", async () => {
    const tags = radios(await render());
    expect(tags).toHaveLength(4);
    for (const tag of tags) expect(tag, "a radio is pre-checked").not.toMatch(/\bchecked\b/);
  });

  it("requires a choice before the form can be submitted", async () => {
    const tags = radios(await render());
    expect(tags).toHaveLength(4);
    for (const tag of tags) expect(tag, "a radio is not marked required").toMatch(/\brequired\b/);
  });

  it("still names the group for a screen reader", async () => {
    expect(await render()).toMatch(/<legend[^>]*>Reason<\/legend>/);
  });
});
