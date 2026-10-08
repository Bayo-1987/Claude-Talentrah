/**
 * The Company Profile card for the employer job-list widget (src/components/employer/job-widget-card.tsx), rendered to static markup.
 *
 * With the server-side switch off (`available` false: EMBED_WIDGET_ENABLED unset) the card says plainly that the widget is not available yet and offers NOTHING to act on: no checkbox, no
 * count, no Save, no embed code, no preview frame. With it on, the toggle, the count, the code box (the shared TextArea) and, when saved as on, the preview are there.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/employer/widget-actions", () => ({ saveJobWidgetSettingsAction: async () => null }));

import { JobWidgetCard } from "@/components/employer/job-widget-card";

const base = { enabled: true, maxItems: 10, verified: true, snippet: '<iframe src="https://www.talentrah.com/embed/jobs/x"></iframe>', previewSrc: "/embed/jobs/x" };

describe("JobWidgetCard: the server-side switch is off", () => {
  const html = renderToStaticMarkup(<JobWidgetCard {...base} available={false} />);
  it("says it is not available yet", () => {
    expect(html).toContain("isn&#x27;t available yet");
  });
  it("offers no toggle, count, Save, embed code or preview", () => {
    for (const bad of ["<input", "<select", "<textarea", "<button", "<iframe", "name=\"enabled\"", "Show my open jobs on my website", "Copy code"]) expect(html, bad).not.toContain(bad);
  });
  it("does not print the embed URL or snippet at all", () => {
    expect(html).not.toContain("embed/jobs");
  });
});

describe("JobWidgetCard: the server-side switch is on", () => {
  it("shows the switch, the count, the code box, Save and Copy", () => {
    const html = renderToStaticMarkup(<JobWidgetCard {...base} available />);
    expect(html).toContain('name="enabled"');
    expect(html).toContain('name="maxItems"');
    expect(html).toContain("Embed code for your website");
    expect(html).toContain("Copy code");
    expect(html).toContain("<iframe");
  });
  it("shows the preview only when the widget is saved as on", () => {
    expect(renderToStaticMarkup(<JobWidgetCard {...base} enabled={false} available />)).not.toContain('title="Preview of your jobs widget"');
  });
});
