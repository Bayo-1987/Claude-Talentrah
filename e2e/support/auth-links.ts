/**
 * Real Supabase auth links for the PWA specs, from the local stack only: a real PKCE sign-up or password-reset request, the real email out of
 * the stack's own mail catcher (Mailpit), and the real `code` GoTrue mints when the link is followed. Nothing about the cookie is mocked: the
 * code-verifier cookie is the one @supabase/ssr wrote, handed to the browser unchanged.
 *
 * Why PKCE and not the admin generateLink API: the app's /auth/callback exchanges a `code`, and generateLink mints implicit-flow links that
 * carry the session in a URL fragment instead, which would never reach that route.
 */
import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

export interface Cookie {
  name: string;
  value: string;
}

/** A Supabase client with an in-memory cookie jar, so the PKCE verifier it writes can be given to a browser. */
export function pkceClient() {
  const jar = new Map<string, string>();
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) jar.set(c.name, c.value);
      },
    },
  });
  return { client, cookies: () => [...jar.entries()].map(([name, value]) => ({ name, value })) as Cookie[] };
}

function assertLoopback(url: string) {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`auth-links helper refuses a non-local host: ${host}`);
}

/** The newest email to `to` from the local mail catcher, polled until it arrives. Returns its text body. */
export async function waitForMail(to: string, timeoutMs = 20_000): Promise<string> {
  assertLoopback(MAILPIT);
  assertLoopback(SUPABASE_URL);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (search.ok) {
      const body = (await search.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;
      if (id) {
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
        return `${msg.Text ?? ""}\n${msg.HTML ?? ""}`;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no email arrived for ${to} within ${timeoutMs}ms`);
}

/** The GoTrue verify link inside an email body. */
export function verifyLink(mail: string): string {
  const m = mail.replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
  if (!m) throw new Error("no /auth/v1/verify link in the email");
  return m[0];
}

/**
 * Follows a verify link ONCE without a browser and returns where GoTrue sent it: the app's /auth/callback URL carrying the real `code`.
 * The code is minted here and spent only when the app exchanges it, so the test decides when (and how many times) that happens.
 */
export async function callbackUrlFor(link: string): Promise<string> {
  assertLoopback(link);
  const res = await fetch(link, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location || !new URL(location).searchParams.get("code")) throw new Error(`verify link did not redirect with a code (status ${res.status}, location ${location})`);
  return location;
}

/** Gives the browser the PKCE verifier cookies the SSR client wrote, as the browser that asked for the link would hold them. */
export async function giveVerifier(context: BrowserContext, baseURL: string, cookies: Cookie[]) {
  const url = new URL(baseURL);
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: url.hostname, path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const })));
}
