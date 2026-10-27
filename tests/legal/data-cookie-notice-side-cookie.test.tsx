/**
 * The Data & Cookie Notice names the tr_side cookie, with exactly one line, in the "Cookies we use" list, and does not use the occasion to list the other first-party cookies it leaves out today
 * (that is a separate owner decision). The wording of the line is DRAFT, awaiting the owner's approval.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DataCookieNoticePage from "@/app/legal/data-cookie-notice/page";

const html = renderToStaticMarkup(<DataCookieNoticePage />);
const section = (() => {
  const start = html.indexOf("Cookies we use</h2>");
  const end = html.indexOf("<h2", start + 1);
  return html.slice(start, end);
})();

describe("the cookie list", () => {
  it("has a 'Cookies we use' section", () => {
    expect(section.length).toBeGreaterThan(100);
  });

  it("names tr_side once, in one list item of its own", () => {
    const items = section.match(/<li>[\s\S]*?<\/li>/g) ?? [];
    expect(items.filter((li) => li.includes("tr_side"))).toHaveLength(1);
    expect(html.match(/tr_side/g)).toHaveLength(1);
    expect(items).toHaveLength(3);
  });

  it("says what it holds, how long it lasts, when it is set and when it goes", () => {
    const li = (section.match(/<li>[\s\S]*?<\/li>/g) ?? []).find((x) => x.includes("tr_side")) ?? "";
    expect(li).toMatch(/seeker or employer/);
    expect(li).toMatch(/a year/);
    expect(li).toMatch(/sign(s)? (you )?out|signed out/);
  });

  it("does not list the other first-party cookies in this change", () => {
    for (const name of ["talentrah_ref", "trh_demo_visitor", "tr_post_auth", "talentrah_admin_session"]) expect(html, name).not.toContain(name);
  });
});

describe("the page's date", () => {
  it("says it was last updated on October 27, 2026 (the day the cookie line was added), and not the old date", () => {
    expect(html).toContain("October 27, 2026");
    expect(html).not.toContain("September 16, 2026");
  });
});
