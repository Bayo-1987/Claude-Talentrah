/** /contact?topic=premium preselects "Talentrah Premium for employers"; a missing, unknown or repeated value keeps today's empty default. */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getContactRecipient: () => "support@talentrah.test" }));
vi.mock("@/components/marketing/marketing-masthead", () => ({ MarketingMasthead: () => null }));
vi.mock("@/components/marketing/marketing-footer", () => ({ MarketingFooter: () => null }));

const query = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query.value) }));

const { default: ContactPage } = await import("@/app/contact/page");
const { CONTACT_TOPICS, contactSchema, contactTopicFromParam } = await import("@/lib/contact/schemas");

const PREMIUM = "Talentrah Premium for employers";
const page = async (topic?: string | string[]) => {
  const q = new URLSearchParams();
  for (const t of topic === undefined ? [] : [topic].flat()) q.append("topic", t);
  query.value = q.toString();
  return renderToStaticMarkup(ContactPage());
};
/** The select's chosen option(s): React marks the match `selected`. */
const selected = (html: string) => [...html.matchAll(/<option[^>]*\bselected\b[^>]*value="([^"]*)"|<option[^>]*value="([^"]*)"[^>]*\bselected\b/g)].map((m) => m[1] ?? m[2]).filter(Boolean);
/** The empty "Select…" placeholder is what an untouched form shows today. */

describe("the topic list", () => {
  it("offers the Premium option, and the form accepts it", () => {
    expect(CONTACT_TOPICS).toContain(PREMIUM);
    expect(contactSchema.safeParse({ name: "A", email: "a@b.co", topic: PREMIUM, message: "A long enough message" }).success).toBe(true);
  });
});

describe("/contact?topic=", () => {
  it("premium preselects the Premium option", async () => {
    expect(selected(await page("premium"))).toEqual([PREMIUM]);
  });
  it("no param: nothing is preselected (unchanged)", async () => {
    const { ContactForm } = await import("@/app/contact/contact-form");
    const html = await page(undefined);
    expect(selected(html)).toEqual([]);
    expect(html).toContain(PREMIUM);
    const sel = (h: string) => /<select[\s\S]*?<\/select>/.exec(h)![0].replace(/\bid="[^"]*"/g, "");
    expect(sel(html)).toBe(sel(renderToStaticMarkup(createElement(ContactForm))));
  });
  it("an unknown value is ignored", async () => {
    for (const v of ["nope", "", "PREMIUM", "constructor", "__proto__", "General question"]) expect(selected(await page(v)), v).toEqual([]);
  });
  it("a repeated ?topic=premium&topic=premium is ignored rather than guessed at", async () => {
    expect(selected(await page(["premium", "premium"]))).toEqual([]);
    expect(contactTopicFromParam(["premium"])).toBe("");
  });
});

describe("/contact stays a static page", () => {
  it("the page reads no request data on the server: no searchParams, cookies, headers or dynamic export", () => {
    const src = readFileSync(path.join(__dirname, "../../src/app/contact/page.tsx"), "utf8");
    expect(src).not.toMatch(/searchParams|cookies\(|headers\(|connection\(|export const dynamic|revalidate\s*=\s*0/);
  });
  it("?topic= is read in the browser, inside Suspense, with the plain form as the fallback", () => {
    const src = readFileSync(path.join(__dirname, "../../src/app/contact/page.tsx"), "utf8");
    expect(src).toMatch(/<Suspense fallback=\{<ContactForm \/>\}>\s*<ContactFormFromLink \/>/);
    expect(readFileSync(path.join(__dirname, "../../src/app/contact/contact-form-from-link.tsx"), "utf8")).toContain("useSearchParams");
  });
});
