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

// The SSRF check does a real DNS lookup (ssrf-guard.test.ts covers that, and
// the IP-range logic, directly and without mocking). This suite is about
// fetchJobPage's OWN wiring — that it asks the guard before every fetch,
// including a redirect target — so the guard itself is mocked to keep this
// file's tests fast, deterministic, and independent of what any real
// hostname happens to resolve to today.
vi.mock("@/lib/security/ssrf-guard", () => ({
  checkUrlIsSafeToFetch: vi.fn(),
}));

const { isUrlAllowedByRobots } = await import("@/lib/employer/job-import/robots");
const { checkUrlIsSafeToFetch } = await import("@/lib/security/ssrf-guard");
const { fetchJobPage, htmlToPlainText } = await import("@/lib/employer/job-import/fetch-page");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(isUrlAllowedByRobots).mockReset().mockResolvedValue(true);
  vi.mocked(checkUrlIsSafeToFetch).mockReset().mockResolvedValue({ allowed: true });
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

describe("fetchJobPage — SSRF guard (real finding: a pasted URL could target a private/loopback/metadata address)", () => {
  it("refuses the pasted URL itself without ever calling fetch, when the SSRF check disallows it", async () => {
    vi.mocked(checkUrlIsSafeToFetch).mockResolvedValue({
      allowed: false,
      reason: "resolves to a loopback address",
    });
    const result = await fetchJobPage("http://127.0.0.1:8080/internal-admin");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the SSRF guard AFTER passing robots.txt but BEFORE the network call — refuses cleanly either way", async () => {
    vi.mocked(isUrlAllowedByRobots).mockResolvedValue(true);
    vi.mocked(checkUrlIsSafeToFetch).mockResolvedValue({
      allowed: false,
      reason: "resolves to the cloud metadata address",
    });
    const result = await fetchJobPage("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT auto-follow a redirect — refuses a redirect target the SSRF guard disallows, without fetching it", async () => {
    // First hop: a normal-looking external page that redirects.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      url: "https://example.com/careers/123",
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
      text: async () => "",
    });
    // The guard allows the FIRST url, but not the redirect target.
    vi.mocked(checkUrlIsSafeToFetch).mockImplementation(async (url: URL) =>
      url.hostname === "169.254.169.254"
        ? { allowed: false, reason: "resolves to the cloud metadata address" }
        : { allowed: true },
    );

    const result = await fetchJobPage("https://example.com/careers/123");
    expect(result.ok).toBe(false);
    // Exactly one real network call — the redirect target was checked and
    // refused BEFORE a second fetch was ever attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(checkUrlIsSafeToFetch).toHaveBeenCalledTimes(2);
  });

  it("follows a legitimate redirect chain (re-checking each hop) and returns the final page", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 301,
        url: "https://example.com/careers",
        headers: new Headers({ location: "https://example.com/careers/123" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://example.com/careers/123",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html><body><h1>Real Role</h1></body></html>",
      });

    const result = await fetchJobPage("https://example.com/careers");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("Real Role");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(checkUrlIsSafeToFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after too many redirects rather than following forever", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 302,
      url: "https://example.com/loop",
      headers: new Headers({ location: "https://example.com/loop" }),
      text: async () => "",
    }));

    const result = await fetchJobPage("https://example.com/loop");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/redirected too many times/i);
  });
});
