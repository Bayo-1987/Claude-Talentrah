/**
 * A small in-process stand-in for Supabase Auth (GoTrue), for tests that need the REAL @supabase/ssr and proxy code to talk to something
 * that rotates refresh tokens. No Docker, no database, no network: an http server on 127.0.0.1.
 *
 * What it models, because the sign-out bugs it exists to catch depend on it: a refresh token is used once and rotated; a revoked token
 * presented within the 10-second reuse interval gets the session's current tokens back; a revoked token presented later revokes the whole
 * session (`refresh_token_already_used`); an unknown token or a deleted session is `refresh_token_not_found`; `/logout` deletes this session
 * (`local`), the user's other sessions (`others`) or all of them (`global`). `/user` answers 200 for a live session's unexpired access token.
 * It is a model of documented behaviour, not GoTrue itself: it proves the APP's handling of those responses, not GoTrue's.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

interface Tok { value: string; sid: string; revoked: boolean; parent: string | null; at: number }
export interface RecordedRequest { method: string; path: string; query: string; authorization: string | null; body: unknown }

/**
 * An optional password policy for /signup and PUT /user, shaped like the dashboard's: a minimum length, required character classes and a
 * leaked-password list. The refusals use GoTrue's documented shapes (HTTP 422, `weak_password` with `weak_password.reasons`, `same_password`),
 * so the real supabase-js client turns them into the same AuthWeakPasswordError / AuthApiError the app sees from production. The wording of
 * `msg` is a model of GoTrue's English, not a copy; the app is meant to read the reasons and the quoted numbers, not the sentence.
 */
export interface FakePasswordPolicy {
  minimumLength: number;
  /** "" (none) or "lower_upper_letters_digits". */
  requirements: "" | "lower_upper_letters_digits";
  /** Passwords the leaked-password check refuses. */
  pwned?: string[];
  /** While true, /signup and PUT /user answer 429 over_request_rate_limit. */
  rateLimited?: boolean;
}

export interface FakeGoTrueOptions { passwordPolicy?: FakePasswordPolicy }

export interface FakeGoTrue {
  url: string;
  /** The password the fake holds for a user, for the same-password check. */
  setPassword(userId: string, password: string): void;
  /** Lifetime, in seconds, of access tokens issued from now on (negative: already expired). */
  ttl: number;
  /** While true, GET /user answers 503 (a transient auth outage). */
  failUser: boolean;
  /** `app_metadata` on every user the fake returns from now on (e.g. `{ deletion_pending: true }`, the flag ACCT-1's proxy gate reads). */
  appMetadata: Record<string, unknown>;
  requests: RecordedRequest[];
  /** Deletes every live session, as a global sign-out elsewhere would. */
  clearSessions(): void;
  /** How many sessions are alive. */
  sessionCount(): number;
  /** Signs in: creates a session for `userId` and returns the body a client stores. */
  signIn(userId?: string): ReturnType<typeof sessionBody>;
  close(): Promise<void>;
}

function sessionBody(sid: string, userId: string, t: Tok, ttl: number, appMetadata: Record<string, unknown> = {}) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, sid, aud: "authenticated", role: "authenticated", email: "t@talentrah.test", exp })}.sig`;
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: ttl,
    expires_at: exp,
    refresh_token: t.value,
    user: { id: userId, aud: "authenticated", role: "authenticated", email: "t@talentrah.test", app_metadata: appMetadata, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

export async function startFakeGoTrue(options: FakeGoTrueOptions = {}): Promise<FakeGoTrue> {
  const sessions = new Map<string, string>(); // sid -> user id
  const toks = new Map<string, Tok>();
  const requests: RecordedRequest[] = [];
  const state = { ttl: 3600, failUser: false, appMetadata: {} as Record<string, unknown> };
  const passwords = new Map<string, string>(); // user id -> current password

  /** GoTrue's weak-password refusal for `pw`, or null when the policy accepts it. */
  const weakness = (pw: string): { reasons: string[]; msg: string } | null => {
    const policy = options.passwordPolicy;
    if (!policy) return null;
    const reasons: string[] = [];
    const parts: string[] = [];
    if (pw.length < policy.minimumLength) { reasons.push("length"); parts.push(`be at least ${policy.minimumLength} characters`); }
    if (policy.requirements === "lower_upper_letters_digits" && !(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw))) {
      reasons.push("characters");
      parts.push("contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789");
    }
    if (reasons.length) return { reasons, msg: `Password should ${parts.join(" and ")}.` };
    if (policy.pwned?.includes(pw)) return { reasons: ["pwned"], msg: "Password is known to be weak and easy to guess, please choose a different one." };
    return null;
  };

  const issue = (sid: string, parent: string | null): Tok => {
    const t: Tok = { value: randomUUID().slice(0, 12), sid, revoked: false, parent, at: Date.now() };
    toks.set(t.value, t);
    return t;
  };
  const body = (sid: string, t: Tok) => sessionBody(sid, sessions.get(sid)!, t, state.ttl, state.appMetadata);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = chunks.length ? Buffer.concat(chunks).toString() : "";
    let parsed: unknown = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = raw; }
    const b = parsed as Record<string, string>;
    requests.push({ method: req.method!, path: url.pathname, query: url.search, authorization: (req.headers.authorization as string) ?? null, body: parsed });
    const send = (s: number, o: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const grant = url.searchParams.get("grant_type");

    if (url.pathname === "/auth/v1/token" && (grant === "password" || grant === "pkce")) {
      const sid = randomUUID(); sessions.set(sid, "user-1");
      return send(200, body(sid, issue(sid, null)));
    }
    if (url.pathname === "/auth/v1/token" && grant === "refresh_token") {
      const t = toks.get(b.refresh_token);
      if (!t || !sessions.has(t.sid)) return send(400, { code: "refresh_token_not_found", error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
      if (t.revoked) {
        const active = [...toks.values()].find((x) => x.sid === t.sid && !x.revoked);
        if (active && active.parent === t.value && Date.now() - active.at < 10_000) return send(200, body(t.sid, active));
        sessions.delete(t.sid);
        return send(400, { code: "refresh_token_already_used", error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" });
      }
      t.revoked = true;
      return send(200, body(t.sid, issue(t.sid, t.value)));
    }
    if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
      if (options.passwordPolicy?.rateLimited) return send(429, { code: "over_request_rate_limit", error_code: "over_request_rate_limit", msg: "Request rate limit reached" });
      const weak = weakness(String(b.password ?? ""));
      if (weak) return send(422, { code: "weak_password", error_code: "weak_password", msg: weak.msg, weak_password: { reasons: weak.reasons } });
      const sid = randomUUID(); sessions.set(sid, "user-new"); passwords.set("user-new", String(b.password));
      return send(200, body(sid, issue(sid, null)));
    }
    if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
      if (options.passwordPolicy?.rateLimited) return send(429, { code: "over_request_rate_limit", error_code: "over_request_rate_limit", msg: "Request rate limit reached" });
      let sid = "", sub = "";
      try { const p = JSON.parse(Buffer.from(((req.headers.authorization ?? "").replace("Bearer ", "")).split(".")[1], "base64url").toString()); if (p.exp * 1000 > Date.now() && sessions.has(p.sid)) { sid = p.sid; sub = p.sub; } } catch { /* anonymous */ }
      if (!sid) return send(401, { code: "bad_jwt", msg: "invalid JWT" });
      const next = String(b.password ?? "");
      const weak = weakness(next);
      if (weak) return send(422, { code: "weak_password", error_code: "weak_password", msg: weak.msg, weak_password: { reasons: weak.reasons } });
      if (passwords.get(sub) === next) return send(422, { code: "same_password", error_code: "same_password", msg: "New password should be different from the old password." });
      passwords.set(sub, next);
      return send(200, sessionBody(sid, sub, { value: "x", sid, revoked: false, parent: null, at: 0 }, 3600).user);
    }
    if (url.pathname === "/auth/v1/user") {
      if (state.failUser) return send(503, { code: "unexpected_failure", msg: "temporarily unavailable" });
      try {
        const p = JSON.parse(Buffer.from(((req.headers.authorization ?? "").replace("Bearer ", "")).split(".")[1], "base64url").toString());
        if (p.exp * 1000 > Date.now() && sessions.has(p.sid)) return send(200, sessionBody(p.sid, p.sub, { value: "x", sid: p.sid, revoked: false, parent: null, at: 0 }, 3600, state.appMetadata).user);
      } catch { /* fall through */ }
      return send(401, { code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") {
      const scope = url.searchParams.get("scope") ?? "global";
      let sid: string | null = null;
      try { sid = JSON.parse(Buffer.from(((req.headers.authorization ?? "").replace("Bearer ", "")).split(".")[1], "base64url").toString()).sid; } catch { /* anonymous */ }
      if (scope === "global") sessions.clear();
      else if (scope === "others") for (const s of [...sessions.keys()]) { if (s !== sid) sessions.delete(s); }
      else if (sid) sessions.delete(sid);
      res.writeHead(204); return res.end();
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return send(200, null);
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const urlBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    url: urlBase,
    get ttl() { return state.ttl; },
    set ttl(v: number) { state.ttl = v; },
    get failUser() { return state.failUser; },
    set failUser(v: boolean) { state.failUser = v; },
    get appMetadata() { return state.appMetadata; },
    set appMetadata(v: Record<string, unknown>) { state.appMetadata = v; },
    requests,
    setPassword: (userId: string, password: string) => { passwords.set(userId, password); },
    clearSessions: () => sessions.clear(),
    sessionCount: () => sessions.size,
    signIn(userId = "user-1") { const sid = randomUUID(); sessions.set(sid, userId); return body(sid, issue(sid, null)); },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A browser's cookie jar, filled from Set-Cookie headers and replayed as a Cookie header. */
export class CookieJar {
  m = new Map<string, string>();
  apply(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/max-age=0/i.test(attrs.join(";")) || v === "") this.m.delete(k); else this.m.set(k, v);
    }
  }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join("; "); }
}
