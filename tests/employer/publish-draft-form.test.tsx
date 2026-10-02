/**
 * The draft row's Publish button (EMP-1 / E3). Before any refusal it is just a button: no date control, so the first
 * click posts no `expiresIn` and the server keeps a date that is fine. The refusal path (message + a "30 days"
 * preselected control) needs client state and is exercised end to end by the server-action tests
 * (closing-date-default.test.ts) and the e2e spec.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/employer/actions", () => ({ publishDraftFormAction: vi.fn() }));

import { PublishDraftForm } from "@/components/employer/publish-draft-form";

describe("PublishDraftForm, before any refusal", () => {
  const html = renderToStaticMarkup(<PublishDraftForm jobId="job-1" />);

  it("is a Publish button", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Publish<\/button>/);
  });

  it("shows no date control and no message yet", () => {
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="alert"');
  });
});
