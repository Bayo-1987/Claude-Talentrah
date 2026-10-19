import { test, expect } from "@playwright/test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import nextConfig from "../next.config";
import { renderConfirmPage } from "../src/lib/data-export/pages";
import { isOwnOrigin } from "../src/lib/data-export/origin";

/**
 * The Origin header a REAL browser puts on the confirm page's POST (DATA-EXPORT-DOWNLOAD-DELIVERY-1, follow-up 1).
 *
 * A form POST from a page whose Referrer-Policy is no-referrer is sent with "Origin: null" (Fetch spec, "serializing a request origin"), and isOwnOrigin refuses "null", so a real click would get the refusal
 * page. The unit tests write Origin by hand, so they cannot see this. Here the page is served over real HTTP, with the headers the site really resolves for /data-export/<id> (the Referrer-Policy is the one
 * next.config.ts resolves for the path, which is what wins in production; the markup, including its <meta name="referrer">, is renderConfirmPage's), the button is pressed in Chromium, and the server records
 * the Origin and Host the browser actually sent, then hands them to the real isOwnOrigin.
 *
 * Needs no database and no Next server. It lives here and not in Vitest because it needs a real browser.
 */
type Rule = { source: string; headers: Array<{ key: string; value: string }> };
const matches = (source: string, path: string): boolean => (source === "/data-export/:path*" ? /^\/data-export(?:\/.*)?$/.test(path) : source === "/((?!embed/).*)" ? /^\/((?!embed\/).*)$/.test(path) : false);
async function resolvedHeaders(path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const r of (await nextConfig.headers!()) as Rule[]) if (matches(r.source, path)) for (const h of r.headers) out.set(h.key.toLowerCase(), h.value);
  return out;
}

interface Seen {
  origin: string | undefined;
  host: string | undefined;
  referer: string | undefined;
}

let server: Server;
let port = 0;
let seen: Seen[] = [];
let pagePolicy = "";

test.beforeAll(async () => {
  const id = randomUUID();
  pagePolicy = (await resolvedHeaders(`/data-export/${id}`)).get("referrer-policy") ?? "";
  server = createServer((req: IncomingMessage, res) => {
    const common = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": pagePolicy };
    if (req.method === "POST") {
      seen.push({ origin: req.headers.origin, host: req.headers.host, referer: req.headers.referer });
      res.writeHead(200, { ...common, "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="talentrah-data-2026-10-19.json"' });
      res.end("{}");
      return;
    }
    const pageId = (req.url ?? "").split("/").pop() ?? id;
    res.writeHead(200, { ...common, "Content-Type": "text/html; charset=utf-8" });
    res.end(renderConfirmPage({ id: pageId, expiresText: "2026-10-22 09:30 UTC" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

test("the POST the browser sends carries the page's own origin, and isOwnOrigin accepts it", async ({ page }) => {
  seen = [];
  const id = randomUUID();
  const pageOrigin = `http://127.0.0.1:${port}`;
  await page.goto(`${pageOrigin}/data-export/${id}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  await download;

  expect(seen).toHaveLength(1);
  const { origin, host, referer } = seen[0];
  process.stdout.write(`[observed] Referrer-Policy served: ${pagePolicy}; Origin the browser sent: ${String(origin)}; Referer: ${String(referer)}; Host: ${String(host)}\n`);
  expect(origin, "the recorded Origin is the page's own origin").toBe(pageOrigin);
  const asRequest = new Request(`${pageOrigin}/data-export/${id}`, { method: "POST", headers: { ...(origin !== undefined ? { origin } : {}), ...(referer !== undefined ? { referer } : {}), ...(host !== undefined ? { host } : {}) } });
  expect(isOwnOrigin(asRequest), "isOwnOrigin accepts what the browser really sent").toBe(true);
});
