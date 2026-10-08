/**
 * robots.txt gate for "Import from URL" (src/lib/employer/job-import/robots.ts).
 *
 * Network mocked with vi.stubGlobal("fetch", ...), same pattern
 * tests/jobs/schema-org.test.ts already uses for the aggregation fetcher —
 * this feature's robots.txt check is the one piece of it that talks to a
 * second host (robots.txt lives at the origin root, not the page's own URL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The robots.txt request goes through pinnedFetch (tests/security/pinned-fetch.test.ts covers resolve-once-and-connect-to-that-address with real sockets). Here it is a stand-in that asks `guard.check` first and
// then uses the stubbed global fetch, so these tests prove robots.ts's own wiring: every hop goes through it, a refused address fails open, a redirect is followed hop by hop, and nothing follows a redirect on its own.
const guard = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/security/pinned-fetch", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/pinned-fetch")>("@/lib/security/pinned-fetch");
  return {
    ...actual,
    pinnedFetch: async (url: string | URL, init?: unknown) => {
      const verdict = await guard.check(new URL(String(url)));
      if (!verdict.allowed) throw new actual.SsrfBlockedError(verdict.reason ?? "blocked");
      return globalThis.fetch(String(url), init as RequestInit);
    },
  };
});
const { isPathDisallowed, isUrlAllowedByRobots } = await import("@/lib/employer/job-import/robots");

describe("isPathDisallowed — the parser/matcher, no network", () => {
  it("blocks a path under a Disallow rule in the wildcard group", () => {
    const robots = "User-agent: *\nDisallow: /job/\n";
    expect(isPathDisallowed(robots, "/job/12345")).toBe(true);
    expect(isPathDisallowed(robots, "/careers")).toBe(false);
  });

  it("an empty Disallow means nothing is disallowed", () => {
    const robots = "User-agent: *\nDisallow:\n";
    expect(isPathDisallowed(robots, "/anything")).toBe(false);
  });

  it("Disallow: / blocks the entire site", () => {
    const robots = "User-agent: *\nDisallow: /\n";
    expect(isPathDisallowed(robots, "/careers/123")).toBe(true);
  });

  it("only the wildcard group counts — a named-bot-only block doesn't apply here", () => {
    // The real hotnigerianjobs.com shape this repo's own docs record
    // (CLAUDE.md / sources.config.ts): named AI crawlers blocked, but no
    // general "*" restriction. This feature isn't one of those crawlers —
    // see robots.ts's header for why the "*" group is the right one to
    // check regardless.
    const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n";
    expect(isPathDisallowed(robots, "/careers/123")).toBe(false);
  });

  it("a more specific Allow overrides a shorter Disallow (longest-match-wins)", () => {
    const robots = "User-agent: *\nDisallow: /job/\nAllow: /job/public/\n";
    expect(isPathDisallowed(robots, "/job/public/123")).toBe(false);
    expect(isPathDisallowed(robots, "/job/private/123")).toBe(true);
  });

  it("a $ end-anchor only matches the exact end of the path", () => {
    const robots = "User-agent: *\nDisallow: /search$\n";
    expect(isPathDisallowed(robots, "/search")).toBe(true);
    expect(isPathDisallowed(robots, "/search/nigeria")).toBe(false);
  });

  it("a literal '?' in a pattern is not a regex quantifier — real jobs.workable.com shape", () => {
    // Real, live robots.txt (fetched 2026-09-10, this feature's own build):
    //   Allow: /search/*
    //   Disallow: /search*?*
    //   Disallow: /search
    // The middle rule's '?' means "a query string starts here", literally —
    // it must NOT make the preceding '*' a lazy quantifier (which is what a
    // naive `.replace(/\*/g, ".*")` with '?' left unescaped produces, and
    // which then matches everything under /search, silently defeating the
    // Allow rule above it). This is a real regression this exact fixture
    // caught during manual verification against the live site — not a
    // synthesized edge case.
    const robots = "User-agent: *\nAllow: /search/*\nDisallow: /search*?*\nDisallow: /search\n";
    expect(isPathDisallowed(robots, "/search/nigeria")).toBe(false);
    // The query-string rule should still do its actual job: an unrelated
    // path with a literal '?' immediately after /search IS disallowed.
    expect(isPathDisallowed(robots, "/search?page=2")).toBe(true);
  });

  it("real jobberman.com shape: /job/ is disallowed, other paths are not", () => {
    // Reproduces the exact fact CLAUDE.md/sources.config.ts record about
    // jobberman.com — a real-world regression fixture, not a synthesized one.
    const robots = "User-agent: *\nDisallow: /job/\nDisallow: /account/\n";
    expect(isPathDisallowed(robots, "/job/some-real-listing")).toBe(true);
    expect(isPathDisallowed(robots, "/companies/some-employer")).toBe(false);
  });
});

describe("isUrlAllowedByRobots — with network mocked", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    guard.check.mockReset().mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails OPEN when robots.txt is missing (404)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/careers/123"));
    expect(allowed).toBe(true);
  });

  it("fails OPEN when robots.txt is unreachable (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/careers/123"));
    expect(allowed).toBe(true);
  });

  it("fails CLOSED when a real robots.txt disallows the path", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nDisallow: /job/\n",
    });
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/job/12345"));
    expect(allowed).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/robots.txt",
      expect.anything(),
    );
  });

  it("allows a path a real robots.txt does not disallow", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nDisallow: /job/\n",
    });
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/careers/backend-engineer"));
    expect(allowed).toBe(true);
  });

  it("fails CLOSED through a redirect too: a robots.txt that redirects to another host is read there, hop by hop", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: "https://www.example.com/robots.txt" }), text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => "User-agent: *\nDisallow: /job/\n" });
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/job/12345"));
    expect(allowed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(guard.check).toHaveBeenCalledTimes(2);
  });

  it("a robots.txt that redirects to a non-public address is NOT fetched: the hop is refused before any request, and the answer fails open (the page fetch has its own refusal)", async () => {
    guard.check.mockImplementation(async (u: URL) => (u.hostname === "169.254.169.254" ? { allowed: false, reason: "metadata" } : { allowed: true }));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }), text: async () => "" });
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/job/12345"));
    expect(allowed).toBe(true);
    expect(fetchMock, "the redirect target was requested").toHaveBeenCalledTimes(1);
  });

  it("a host that resolves to a non-public address never gets its robots.txt requested", async () => {
    guard.check.mockResolvedValue({ allowed: false, reason: "loopback" });
    const allowed = await isUrlAllowedByRobots(new URL("http://internal.example/job/1"));
    expect(allowed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up after a few redirects instead of following forever, and fails open", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 302, headers: new Headers({ location: "https://example.com/robots.txt" }), text: async () => "" }));
    const allowed = await isUrlAllowedByRobots(new URL("https://example.com/job/1"));
    expect(allowed).toBe(true);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
