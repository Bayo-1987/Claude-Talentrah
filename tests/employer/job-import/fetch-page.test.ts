/**
 * fetchJobPage (src/lib/employer/job-import/fetch-page.ts) — the server-side
 * fetch + HTML-to-text step, network mocked. robots.txt itself is tested in
 * robots.test.ts; this suite mocks isUrlAllowedByRobots directly so it can
 * focus on this module's own job: URL validation, the actual page fetch,
 * content-type/status handling, and the HTML cleanup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/employer/job-import/robots", () => ({
  isUrlAllowedByRobots: vi.fn(),
}));

const { isUrlAllowedByRobots } = await import("@/lib/employer/job-import/robots");
const { fetchJobPage, htmlToPlainText } = await import("@/lib/employer/job-import/fetch-page");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(isUrlAllowedByRobots).mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("htmlToPlainText", () => {
  it("strips script/style/nav/header/footer and keeps the real content", () => {
    const html = `<!doctype html><html><head><style>.a{color:red}</style></head>
      <body>
        <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
        <script>trackPageView();</script>
        <main>
          <h1>Backend Engineer</h1>
          <p>We are looking for a Backend Engineer to join our team.</p>
          <ul><li>5+ years experience</li><li>Node.js</li></ul>
        </main>
        <footer>&copy; 2026 Example Co. <a href="/privacy">Privacy</a></footer>
      </body></html>`;

    const text = htmlToPlainText(html);
    expect(text).toContain("Backend Engineer");
    expect(text).toContain("We are looking for a Backend Engineer");
    expect(text).toContain("5+ years experience");
    expect(text).not.toContain("trackPageView");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Privacy");
    expect(text).not.toContain("Home");
  });
});

describe("fetchJobPage", () => {
  it("rejects an unparseable URL without ever calling fetch", async () => {
    const result = await fetchJobPage("not a url at all!!");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks robots.txt before fetching, and refuses when it disallows", async () => {
    vi.mocked(isUrlAllowedByRobots).mockResolvedValue(false);
    const result = await fetchJobPage("https://example.com/job/123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/robots\.txt/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades cleanly on a non-200 response — no crash", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      url: "https://example.com/careers/gone",
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "",
    });
    const result = await fetchJobPage("https://example.com/careers/gone");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/404/);
  });

  it("degrades cleanly on a network error — no crash", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await fetchJobPage("https://example.com/careers/down");
    expect(result.ok).toBe(false);
  });

  it("refuses a non-HTML response (e.g. a PDF or an API's JSON)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/careers.json",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{}",
    });
    const result = await fetchJobPage("https://example.com/careers.json");
    expect(result.ok).toBe(false);
  });

  it("succeeds on a real HTML page and returns both raw html and cleaned text", async () => {
    const html = "<html><body><h1>Product Manager</h1><p>Lagos, Nigeria. Full-time.</p></body></html>";
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/careers/pm",
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => html,
    });
    const result = await fetchJobPage("example.com/careers/pm");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toBe(html);
      expect(result.text).toContain("Product Manager");
      expect(result.text).toContain("Lagos, Nigeria");
    }
  });

  it("defaults a bare host (no scheme) to https rather than rejecting it", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://example.com/careers/pm",
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html><body><h1>Role</h1></body></html>",
    });
    await fetchJobPage("example.com/careers/pm");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/careers/pm",
      expect.anything(),
    );
  });
});
