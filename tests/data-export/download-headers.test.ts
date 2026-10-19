/**
 * What the real site configuration does to the data export pages (DATA-EXPORT-DOWNLOAD-DELIVERY-1, sections 7 and 1b): the real Content-Security-Policy and where it comes from, that a
 * same-origin form POST and the page's one inline script are allowed by it, that Referrer-Policy: strict-origin wins for this route, and that the pages are minimal. Reads next.config.ts itself.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import nextConfig from "../../next.config";
import { renderConfirmPage, renderRefusalPage } from "@/lib/data-export/pages";
import { buildLinkEmail } from "@/lib/data-export/email";

type Rule = { source: string; headers: Array<{ key: string; value: string }> };
// The two source shapes next.config.ts uses that can match /data-export/<id>.
const matches = (source: string, path: string): boolean => {
  if (source === "/data-export/:path*") return /^\/data-export(?:\/.*)?$/.test(path);
  if (source === "/((?!embed/).*)") return /^\/((?!embed\/).*)$/.test(path);
  return false;
};
async function resolved(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers!()) as Rule[];
  const out = new Map<string, string>();
  for (const r of rules) if (matches(r.source, path)) for (const h of r.headers) out.set(h.key.toLowerCase(), h.value);
  return out;
}

describe("the site's real Content-Security-Policy on /data-export/<id>", () => {
  it("is Report-Only (nothing is enforced), has no form-action, and allows inline scripts; the finding is printed", async () => {
    const headers = await resolved(`/data-export/${randomUUID()}`);
    const policy = headers.get("content-security-policy-report-only") ?? "";
    process.stdout.write(`[observed] CSP header name: ${headers.has("content-security-policy") ? "Content-Security-Policy (enforced)" : "Content-Security-Policy-Report-Only only"}\n[observed] policy: ${policy}\n`);
    expect(headers.has("content-security-policy"), "no enforced policy on this route").toBe(false);
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    // form-action does NOT fall back to default-src, so with none set a same-origin POST (preview host, production, after the login redirect) is not restricted.
    expect(policy).not.toMatch(/form-action/);
    process.stdout.write("[observed] form-action: none set (it does not fall back to default-src), so a same-origin form POST is allowed\n");
  });

  it("the confirm page's only script is ONE inline script, covered by script-src 'unsafe-inline'; no external script, no inline event handler", () => {
    const html = renderConfirmPage({ id: randomUUID(), expiresText: "2026-10-22 09:30 UTC" });
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual(["<script>"]);
    expect(html).not.toMatch(/<script[^>]*\bsrc=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe("Referrer-Policy", () => {
  it("strict-origin is the LAST value set for /data-export/*, after the site-wide strict-origin-when-cross-origin, and not for other routes", async () => {
    expect((await resolved(`/data-export/${randomUUID()}`)).get("referrer-policy")).toBe("strict-origin");
    expect((await resolved("/jobs")).get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("the pages are minimal (the route handler serves them without the app layout)", () => {
  const id = randomUUID();
  const confirm = renderConfirmPage({ id, expiresText: "2026-10-22 09:30 UTC" });
  const refusal = renderRefusalPage();

  it("neither page links, preloads or fetches anything: no <link>, <img>, <iframe>, src= or prefetch, and no reference to the export URL except the confirm form's action", () => {
    for (const html of [confirm, refusal]) {
      expect(html).not.toMatch(/<link\b|<img\b|<iframe\b|<video\b|<audio\b|\ssrc=|rel="prefetch"|rel="preload"|fetch\(|XMLHttpRequest|sendBeacon/i);
    }
    expect(refusal).not.toContain("/data-export");
    expect(refusal).not.toMatch(/<script/i);
    const refs = confirm.match(/\/data-export\/[0-9a-f-]+/g) ?? [];
    expect(refs).toEqual([`/data-export/${id}`]);
    expect(confirm).toContain(`<form id="dl" method="post" action="/data-export/${id}">`);
    expect(confirm).not.toMatch(/<a\b[^>]*href="\/data-export/);
  });

  it("follows the editorial rules: no border-radius value, a 44px button, no emoji, a serif heading", () => {
    expect(confirm).not.toMatch(/border-radius:\s*(?!0)/);
    expect(confirm).toContain("min-height:44px");
    expect(confirm).toContain("Newsreader");
    expect(/\p{Extended_Pictographic}/u.test(confirm + refusal)).toBe(false);
  });
});

describe("the link email", () => {
  it("now says to press Download; the link and the rest are unchanged", () => {
    const link = `https://www.example.test/data-export/${randomUUID()}`;
    const mail = buildLinkEmail({ firstName: "Ada", link, expiresAt: new Date("2026-10-22T09:30:00Z"), supportUrl: "https://www.example.test/contact" });
    process.stdout.write(`[observed] email text:\n${mail.text}\n`);
    expect(mail.text).toContain("Open the link below while you are signed in to your Talentrah account, then press Download. It works once, only for this account, and until 2026-10-22 09:30 UTC.");
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(link);
    expect(mail.subject).toBe("Your copy of your Talentrah data is ready");
  });
});
