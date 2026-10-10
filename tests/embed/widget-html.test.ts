/**
 * The employer job-list widget's document (src/lib/embed/widget-html.ts): a complete static HTML page for an iframe on a third-party site.
 *
 * What it must never do is as much the contract as what it shows (plan v2.1, owner-approved 7 Oct 2026): no script, no form, no button, no applicant or application data, no job
 * description, nothing from the payload beyond the seven public fields the database function returns, every value escaped, and one neutral body for every cause of "nothing to show".
 */
import { describe, expect, it } from "vitest";
import { SITE_ORIGIN } from "@/lib/seo/site";
import { parseWidgetPayload, renderWidgetHtml, type WidgetData } from "@/lib/embed/widget-html";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const payload = {
  org: { name: "Acme Ltd", logo_url: "https://cdn.example.com/acme.png" },
  jobs: [
    { id: ID_A, title: "Senior Engineer", location: "Lagos, Nigeria", work_type: "hybrid", employment_type: "full_time", posted_at: "2026-10-02T09:30:00.000Z" },
    { id: ID_B, title: "Designer", location: null, work_type: null, employment_type: "contract", posted_at: "2026-09-20T09:30:00.000Z" },
  ],
};

describe("parseWidgetPayload", () => {
  it("accepts the function's exact shape", () => {
    const data = parseWidgetPayload(payload)!;
    expect(data.org).toEqual({ name: "Acme Ltd", logo_url: "https://cdn.example.com/acme.png" });
    expect(data.jobs.map((j) => j.id)).toEqual([ID_A, ID_B]);
  });

  it("is null for null, a non-object, a missing org or a missing jobs array", () => {
    expect(parseWidgetPayload(null)).toBeNull();
    expect(parseWidgetPayload("x")).toBeNull();
    expect(parseWidgetPayload({ jobs: [] })).toBeNull();
    expect(parseWidgetPayload({ org: { name: "A", logo_url: null } })).toBeNull();
    expect(parseWidgetPayload({ org: { name: "", logo_url: null }, jobs: [] })).toBeNull();
  });

  it("drops a job with a malformed id or no title, and any key outside the seven public fields", () => {
    const data = parseWidgetPayload({
      org: { name: "Acme", logo_url: null, secret: "x" },
      jobs: [
        { ...payload.jobs[0], applicant_count: 12, description: "SECRET BODY", salary_min: 1 },
        { ...payload.jobs[1], id: "not-a-uuid" },
        { ...payload.jobs[1], title: "" },
      ],
    })!;
    expect(data.jobs).toHaveLength(1);
    expect(Object.keys(data.jobs[0]).sort()).toEqual(["employment_type", "id", "location", "posted_at", "title", "work_type"]);
    expect(Object.keys(data.org).sort()).toEqual(["logo_url", "name"]);
  });

  it("keeps only an https logo", () => {
    for (const bad of ["http://x.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//x.example/a.png", ""]) {
      expect(parseWidgetPayload({ ...payload, org: { name: "A", logo_url: bad } })!.org.logo_url, bad).toBeNull();
    }
    expect(parseWidgetPayload({ ...payload, org: { name: "A", logo_url: "https://x.example/a.png" } })!.org.logo_url).toBe("https://x.example/a.png");
  });
});

describe("renderWidgetHtml: a verified organisation with open jobs", () => {
  const html = renderWidgetHtml(parseWidgetPayload(payload));

  it("is a complete document with a language, a viewport and a title", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("<title>Jobs at Acme Ltd</title>");
  });

  it("lists each job as a real link to its Talentrah page, in a new tab that cannot reach back", () => {
    for (const id of [ID_A, ID_B]) {
      const link = new RegExp(`<a href="${SITE_ORIGIN}/jobs/${id}" target="_blank" rel="noopener"`).exec(html);
      expect(link, id).not.toBeNull();
    }
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html).toContain("<ul");
  });

  it("shows title, location, work type, employment type and a posted date, in the order given", () => {
    expect(html.indexOf("Senior Engineer")).toBeLessThan(html.indexOf("Designer"));
    expect(html).toContain("Lagos, Nigeria");
    expect(html).toContain("Hybrid");
    expect(html).toContain("Full-time");
    expect(html).toContain("Contract");
    expect(html).toContain("2 Oct 2026");
  });

  it("names the organisation, shows its logo, links to all jobs, and says who powers it", () => {
    expect(html).toContain("Acme Ltd");
    expect(html).toContain('<img src="https://cdn.example.com/acme.png"');
    expect(html).toContain(`href="${SITE_ORIGIN}/jobs"`);
    expect(html).toContain("Powered by Talentrah");
  });

  it("has no script, form, button, input, iframe, object, external stylesheet or inline event handler", () => {
    for (const bad of ["<script", "<form", "<button", "<input", "<iframe", "<object", "<embed", "<link", " on", "javascript:"]) {
      // " on" would also match prose, so only attributes are looked for
      if (bad === " on") expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      else expect(html.toLowerCase(), bad).not.toContain(bad);
    }
  });

  it("makes every link a target of at least 24px", () => {
    expect(html).toMatch(/a\s*\{[^}]*min-height:\s*(2[4-9]|[3-9]\d)px/);
  });

  it("never prints applicant data, a description, a salary or an internal field even when the payload carries them", () => {
    const hostile = renderWidgetHtml(
      parseWidgetPayload({
        org: { name: "Acme", logo_url: null, applicant_total: 99 },
        jobs: [{ ...payload.jobs[0], applicant_count: 77, description: "SECRET BODY", salary_min: 123456, internal_notes: "NOTE" }],
      }),
    );
    for (const leak of ["77", "99", "SECRET BODY", "123456", "NOTE"]) expect(hostile).not.toContain(leak);
  });
});

describe("renderWidgetHtml: escaping", () => {
  it("escapes markup in the organisation name, titles, locations and the logo URL", () => {
    const data: WidgetData = {
      org: { name: `<img src=x onerror=alert(1)>"&`, logo_url: 'https://x.example/a.png"onload="alert(1)' },
      jobs: [{ id: ID_A, title: "<script>alert(2)</script>", location: `"><b>x</b>`, work_type: "remote", employment_type: "full_time", posted_at: "2026-10-02T09:30:00.000Z" }],
    };
    const html = renderWidgetHtml(data);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toMatch(/\sonload=/);
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("prints an unknown work or employment type as nothing rather than raw text", () => {
    const data: WidgetData = { org: { name: "A", logo_url: null }, jobs: [{ id: ID_A, title: "T", location: null, work_type: "<x>", employment_type: "weird", posted_at: null }] };
    const html = renderWidgetHtml(data);
    expect(html).not.toContain("<x>");
    expect(html).not.toContain("weird");
  });
});

describe("renderWidgetHtml: nothing to show", () => {
  it("is ONE neutral body for null, whatever the cause, and reveals nothing about the organisation", () => {
    const a = renderWidgetHtml(null);
    const b = renderWidgetHtml(parseWidgetPayload("garbage"));
    expect(a).toBe(b);
    expect(a).toContain("No open jobs right now");
    expect(a).toContain("Powered by Talentrah");
    expect(a).not.toContain("<script");
    expect(a).not.toContain("Acme");
  });

  it("an enabled organisation with no open job still names itself and says there are none", () => {
    const html = renderWidgetHtml(parseWidgetPayload({ org: { name: "Acme Ltd", logo_url: null }, jobs: [] }));
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("No open jobs right now");
    expect(html).not.toContain("<li");
  });
});

describe("renderWidgetHtml: long unbroken data never widens the frame (QA, 320 px)", () => {
  const long = "A" + "very".repeat(18); // 73 characters, no space or hyphen to break at
  const html = renderWidgetHtml(
    parseWidgetPayload({
      org: { name: long, logo_url: "https://cdn.example.com/a.png" },
      jobs: [{ id: ID_A, title: long, location: long, work_type: "remote", employment_type: "full_time", posted_at: "2026-10-02T09:30:00.000Z" }],
    }),
  );
  const css = /<style>([^<]*)<\/style>/.exec(html)![1];
  /** The declarations of every rule whose selector list contains exactly `selector`, joined. */
  const rule = (selector: string) =>
    css
      .split("}")
      .map((r) => r.split("{"))
      .filter(([sel, body]) => body !== undefined && sel.split(",").map((x) => x.trim()).includes(selector))
      .map(([, body]) => body)
      .join(";");

  it("the job title link, the meta line, the company heading and the neutral note all break anywhere", () => {
    for (const sel of ["a", ".m", "h1", ".n"]) expect(rule(sel), sel).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("the heading sits in a flex row, so its text box may shrink below its content (min-width:0)", () => {
    expect(css).toMatch(/header\s*>\s*h1[^{]*\{[^}]*min-width:\s*0|h1\s*\{[^}]*min-width:\s*0/);
  });

  it("the long token is still printed in full (wrapped by CSS, never truncated)", () => {
    expect(html).toContain(long);
  });
});
