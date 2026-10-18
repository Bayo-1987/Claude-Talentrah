/**
 * Where the local mail catcher (Mailpit) is, derived from the Supabase API URL the run already uses.
 *
 * The Supabase CLI puts the API on one port and Mailpit three above it (supabase/config.toml: 54321 and 54324; CI's local stack is the same), so a stack on other ports, such as a
 * second stack on a developer's machine, works without any setting. MAILPIT_URL still overrides. Loopback only, like the rest of the auth-link helpers: a hosted project has no
 * catcher and these specs create real users, so anything else is refused rather than guessed.
 */
function assertLoopback(url: URL, what: string) {
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") {
    throw new Error(`${what} must be a loopback (local stack) address, got host ${url.hostname}`);
  }
}

export function mailpitUrl(supabaseUrl: string | undefined, override: string | undefined): string {
  if (override) {
    assertLoopback(new URL(override), "MAILPIT_URL");
    return override.replace(/\/+$/, "");
  }
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set, so the mail catcher address cannot be derived (or set MAILPIT_URL)");
  const api = new URL(supabaseUrl);
  assertLoopback(api, "NEXT_PUBLIC_SUPABASE_URL");
  if (!api.port) throw new Error(`NEXT_PUBLIC_SUPABASE_URL has no port to derive the mail catcher's from: ${supabaseUrl}`);
  return `${api.protocol}//${api.hostname}:${Number(api.port) + 3}`;
}
