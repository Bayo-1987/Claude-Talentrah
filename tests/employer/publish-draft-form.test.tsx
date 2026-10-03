/**
 * The draft row's Publish button (EMP-1 / E3), as a pure view of (what the server last said, whether the employer is
 * changing the date). Static markup, because this repo has no DOM test library; what the server does on each button is
 * tested in closing-date-default.test.ts.
 *
 *   no answer yet      just a Publish button (no date control: the first click posts no `expiresIn`)
 *   closing date past  the message and a date control with "30 days" preselected
 *   under 3 days       a warning with two buttons: "Publish anyway" (a submit that posts confirmShortNotice) and
 *                      "Change date" (NOT a submit: it publishes nothing and only swaps in the date control)
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/employer/actions", () => ({ publishDraftFormAction: vi.fn() }));

import { PublishDraftView } from "@/components/employer/publish-draft-form";

const noop = () => {};
const render = (state: Parameters<typeof PublishDraftView>[0]["state"], changingDate = false) =>
  renderToStaticMarkup(
    <PublishDraftView jobId="job-1" state={state} changingDate={changingDate} pending={false} onChangeDate={noop} />,
  );

describe("before any answer", () => {
  const html = render(null);

  it("is a Publish button", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Publish<\/button>/);
  });

  it("shows no date control and no message yet", () => {
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="alert"');
  });
});

describe("a closing date that has passed", () => {
  const html = render({ ok: false, kind: "past", error: "This closing date has passed. Pick a new one" });

  it("shows the message and the date control with 30 days preselected", () => {
    expect(html).toContain("This closing date has passed. Pick a new one");
    expect(html).toMatch(/<select[^>]*name="expiresIn"/);
    expect(html).toMatch(/<option value="30" selected="">30 days<\/option>/);
  });

  it("offers one Publish button and no 'Publish anyway'", () => {
    expect(html).not.toContain("Publish anyway");
    expect(html).toMatch(/type="submit"[^>]*>Publish<\/button>/);
  });
});

describe("a closing date under 3 days away", () => {
  const html = render({
    ok: false,
    kind: "soon",
    error: "This job closes in 2 days, so you may not get a reminder before it closes",
  });

  it("warns with the real number of days", () => {
    expect(html).toContain("This job closes in 2 days, so you may not get a reminder before it closes");
  });

  it("has two buttons: 'Publish anyway' is a submit that posts the confirmation", () => {
    const tag = html.match(/<button[^>]*>Publish anyway<\/button>/)?.[0] ?? "";
    expect(tag, `no 'Publish anyway' button in: ${html}`).not.toBe("");
    expect(tag).toContain('type="submit"');
    expect(tag).toContain('name="confirmShortNotice"');
    expect(tag).toContain('value="1"');
  });

  it("'Change date' is NOT a submit, so it publishes nothing", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Change date<\/button>/);
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*>Change date<\/button>/);
  });

  it("does not show the date control until 'Change date' is chosen", () => {
    expect(html).not.toContain("<select");
  });

  it("after 'Change date' it shows the date control with 30 days preselected, and a plain Publish", () => {
    const changing = render(
      { ok: false, kind: "soon", error: "This job closes in 2 days, so you may not get a reminder before it closes" },
      true,
    );
    expect(changing).toMatch(/<option value="30" selected="">30 days<\/option>/);
    expect(changing).not.toContain("Publish anyway");
    expect(changing).toMatch(/type="submit"[^>]*>Publish<\/button>/);
  });
});
