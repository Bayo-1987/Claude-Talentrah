/**
 * HWR-2: the masthead decides "is there a session?" from the PRESENCE of Supabase's auth cookie in document.cookie, not by importing the Supabase browser client, which would add
 * its whole bundle to every info page for a signal this cheap. The cookie is `sb-<project ref>-auth-token`, split into `.0`, `.1` chunks when large. Presence is only used to choose
 * which links to show; /dashboard and every protected page still check the real session on the server, so a stale cookie costs one redirect to /login, never access.
 */
import { describe, expect, it } from "vitest";
import { hasAuthCookie } from "@/lib/auth/session-cookie";

describe("hasAuthCookie", () => {
  it("true for the auth cookie, plain or chunked", () => {
    expect(hasAuthCookie("sb-abcdefgh-auth-token=base64-xyz")).toBe(true);
    expect(hasAuthCookie("theme=dark; sb-abcdefgh-auth-token.0=aaa; sb-abcdefgh-auth-token.1=bbb")).toBe(true);
  });
  it("false with no cookies, other cookies, or a look-alike name or value", () => {
    expect(hasAuthCookie("")).toBe(false);
    expect(hasAuthCookie("theme=dark; consent=yes")).toBe(false);
    expect(hasAuthCookie("x-sb-abcdefgh-auth-token=1")).toBe(false);
    expect(hasAuthCookie("note=sb-abcdefgh-auth-token")).toBe(false);
    expect(hasAuthCookie("sb-abcdefgh-auth-token-code-verifier=zzz")).toBe(false);
  });
});
