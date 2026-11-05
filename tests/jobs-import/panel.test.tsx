/**
 * PR-U1: the page's panel (what the admin sees before and after choosing a file). Static render of its first state: it asks for a CSV, says the rows go live on the public feed at once,
 * and holds nothing that looks like an address.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobsImportPanel } from "@/components/admin/jobs-import-panel";

describe("the jobs import panel", () => {
  const html = renderToStaticMarkup(<JobsImportPanel />);
  it("asks for a CSV file, with a preview step first", () => {
    expect(html).toMatch(/type="file"/);
    expect(html).toMatch(/accept="[^"]*\.csv/);
    expect(html).toMatch(/Preview/);
  });
  it("says that confirmed rows go live on the public feed at once, and that nothing is written by the preview", () => {
    expect(html).toMatch(/public feed/i);
    expect(html).toMatch(/at once/i);
    expect(html).toMatch(/nothing is (written|saved)/i);
  });
  it("shows no address, link or e-mail", () => {
    expect(html).not.toMatch(/@|https?:\/\/|mailto/i);
  });
  it("has no Confirm button until a preview exists", () => {
    expect(html).not.toMatch(/Confirm and write/);
  });
});
