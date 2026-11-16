/**
 * The help copy on /admin/messages/new: what each kind means, what the consent line must say, and which audience a country applies to.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposeForm } from "@/components/admin/messages/compose-form";

const noop = async () => ({ status: "idle" as const });
const html = renderToStaticMarkup(<ComposeForm action={noop} promotionsOn emailOn />);
const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("under Kind", () => {
  it("says what a service announcement is", () => {
    expect(text).toContain("Service announcement: a notice about the service itself (changes, outages, policy, security). People receive it by default.");
  });
  it("says what a promotion is, that each person can turn it off, that it is off by default, and that it needs a consent line", () => {
    expect(text).toContain("Promotion: anything that encourages use or offers something (offers, new-jobs news). Each person can turn it off, it is off by default, and it needs a consent line.");
  });
  it("sits under the Kind field, before the Title field", () => {
    expect(html.indexOf("Service announcement: a notice")).toBeGreaterThan(html.indexOf('name="kind"'));
    expect(html.indexOf("Service announcement: a notice")).toBeLessThan(html.indexOf('name="title"'));
  });
});

describe("under the consent line", () => {
  it("says why the person is receiving it, and that it must be true for everyone in the audience", () => {
    expect(text).toContain("Why this person is receiving it. It must be true for everyone in the audience.");
  });
  it("offers the three sample sentences as hint text", () => {
    for (const s of [
      "You turned on offers and promotions in your Talentrah notification settings.",
      "You signed up to Talentrah and agreed to receive offers and updates.",
      "You asked us to tell you about new jobs in Nigeria.",
    ]) expect(text, s).toContain(s);
  });
  it("prefills nothing: the consent field has no value and no default text, and the samples are not its placeholder", () => {
    const field = /<input[^>]*name="consentLine"[^>]*>/.exec(html)![0];
    expect(field).not.toMatch(/\bvalue=/);
    expect(field).not.toMatch(/placeholder=/);
    expect(field).not.toMatch(/You turned on|You signed up|You asked us/);
  });
});
