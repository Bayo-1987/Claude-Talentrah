/**
 * P6 (JOBS-POLISH-1): the origin an invite link is built on. Production had NEXT_PUBLIC_SITE_URL unset, and the operator invite fell back to http://localhost:3000, so the owner's invite pointed at
 * their own machine. In production an unset or localhost origin is REFUSED, never used; in development the local default still works. One helper, so the Resend invite work can share it.
 */
import { describe, expect, it } from "vitest";
import { DEV_INVITE_ORIGIN, INVITE_ORIGIN_UNSET_MESSAGE, resolveInviteOrigin } from "@/lib/auth/invite-origin";

const NOT_SENT = /the invite was not sent$/;

describe("production", () => {
  it("POSITIVE CONTROL: a configured site URL is used, with no trailing slash", () => {
    expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.talentrah.com" })).toEqual({ ok: true, origin: "https://www.talentrah.com" });
    expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: " https://www.talentrah.com/ " })).toEqual({ ok: true, origin: "https://www.talentrah.com" });
  });
  it("an unset site URL is refused with the plain message, and never falls back", () => {
    const r = resolveInviteOrigin({ NODE_ENV: "production" });
    expect(r).toEqual({ ok: false, message: "Site URL is not configured; the invite was not sent" });
    expect(INVITE_ORIGIN_UNSET_MESSAGE).toBe("Site URL is not configured; the invite was not sent");
  });
  it("a blank site URL is the same as unset", () => {
    expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "   " }).ok).toBe(false);
    expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "" }).ok).toBe(false);
  });
  it.each(["http://localhost:3000", "https://localhost", "http://127.0.0.1:3000", "http://[::1]:3000", "http://app.localhost:3000", "HTTP://LOCALHOST:3000"])("a site URL that is this machine (%s) is refused", (url) => {
    const r = resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: url });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(NOT_SENT);
  });
  it.each(["not a url", "talentrah.com", "ftp://talentrah.com"])("a site URL that is not an http(s) address (%s) is refused", (url) => {
    expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: url }).ok).toBe(false);
  });
  it("only the origin is kept: a path or query on the configured URL is dropped", () => {
    expect(resolveInviteOrigin({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.talentrah.com/app?x=1" })).toEqual({ ok: true, origin: "https://www.talentrah.com" });
  });
});

describe("development and test", () => {
  it("an unset site URL falls back to the local default, as it always did", () => {
    expect(DEV_INVITE_ORIGIN).toBe("http://localhost:3000");
    expect(resolveInviteOrigin({ NODE_ENV: "development" })).toEqual({ ok: true, origin: "http://localhost:3000" });
    expect(resolveInviteOrigin({ NODE_ENV: "test" })).toEqual({ ok: true, origin: "http://localhost:3000" });
    expect(resolveInviteOrigin({})).toEqual({ ok: true, origin: "http://localhost:3000" });
  });
  it("a configured site URL wins, even when it is localhost on another port", () => {
    expect(resolveInviteOrigin({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:4000" })).toEqual({ ok: true, origin: "http://localhost:4000" });
  });
});
