/**
 * /signup/check-email (S1-101): the page takes no query string, reads the address from the pending-signup cookie and shows it masked, and with no cookie
 * shows the "start again" state. The page's own data (what it hands to the browser) never holds the full address.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeSignupPending } from "@/lib/auth/signup-pending-codec";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
  headers: async () => ({ get: () => null }),
}));

const { default: CheckEmailPage } = await import("@/app/(auth)/signup/check-email/page");
const { getCheckEmailView } = await import("@/lib/auth/check-email-view");

beforeEach(() => {
  jar.clear();
  vi.useRealTimers();
});

describe("with a pending signup", () => {
  beforeEach(() => {
    jar.set("tr_signup_pending", encodeSignupPending({ email: "ada@gmail.com", redirectTo: "", issuedAt: Date.now() - 20_000 }));
  });

  it("shows the masked address and not the full one, anywhere in the page", async () => {
    const html = renderToStaticMarkup(await CheckEmailPage());
    expect(html).toContain("a••••@gmail.com");
    expect(html).not.toContain("ada@gmail.com");
    expect(html).not.toContain("ada%40gmail.com");
  });

  it("starts the resend cooldown from when the code was sent (about 40 seconds left after 20)", async () => {
    const view = await getCheckEmailView();
    expect(view?.cooldownSeconds).toBeGreaterThanOrEqual(39);
    expect(view?.cooldownSeconds).toBeLessThanOrEqual(40);
  });

  it("the data it builds for the browser holds no full address", async () => {
    expect(JSON.stringify(await getCheckEmailView())).not.toContain("ada@gmail.com");
  });

  it("offers the person's mail provider, from the domain only", async () => {
    expect((await getCheckEmailView())?.webmailUrl).toMatch(/^https:\/\/mail\.google\.com/);
    expect((await getCheckEmailView())?.webmailUrl).not.toContain("ada");
  });
});

describe("with no pending signup", () => {
  it("shows the 'start again' state, not an error and not a form", async () => {
    const html = renderToStaticMarkup(await CheckEmailPage());
    expect(html).toContain("Back to sign up");
    expect(html).not.toContain('name="code"');
  });

  it("a cookie that is not ours to read is the same as none", async () => {
    jar.set("tr_signup_pending", "junk");
    expect(await getCheckEmailView()).toBeNull();
  });
});

describe("no personal data in the URL", () => {
  it("the page takes no props at all, so ?email= cannot reach it", () => {
    expect(CheckEmailPage.length).toBe(0);
    const src = readFileSync(path.resolve(__dirname, "../../src/app/(auth)/signup/check-email/page.tsx"), "utf8");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/searchParams/);
  });
});
