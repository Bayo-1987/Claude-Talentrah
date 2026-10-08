import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { IncomingMessage } from "node:http";
import { checkResolvedAddress, type SsrfCheckResult } from "./ssrf-guard";

/**
 * A server-side fetch of a URL the CALLER does not control, that resolves the hostname ONCE, checks EVERY address it returned, and CONNECTS TO THAT SAME CHECKED ADDRESS.
 *
 * WHY. ssrf-guard.ts resolves a hostname to check it, and then lets `fetch` resolve it a second time to connect. A DNS answer that changes between the two (rebinding) could send the request to a private
 * address the check never saw; the guard's header recorded that as a known limit, because Node's global `fetch` would not accept a custom connection hook (an installed undici dispatcher is rejected by
 * Node 22's bundled one). The built-in `http`/`https` request functions DO take a `lookup`: here it returns the checked answer, so there is no second resolution to attack. The name is still what
 * TLS verifies (SNI and certificate) and what the Host header carries; only the address the socket connects to is fixed.
 *
 * WHAT IT IS NOT. One request per call. A 3xx is returned as it is; following it is the caller's loop, and every hop calls this again, so each hop is resolved, checked and pinned afresh. It is not a general
 * HTTP client: GET only, no cookies, no proxies, no HTTP/2, a body cap instead of unbounded reads.
 *
 * ERRORS. A refusal (non-http scheme, an address that is not public, a name that does not resolve) throws SsrfBlockedError and nothing connects. A network failure after that is a plain Error. Callers map both to
 * their own words; neither message is for an end user (the guard's reason names a range, which would tell a caller which internal addresses exist).
 */

export class SsrfBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`blocked: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

type Answer = Array<{ address: string; family: number }>;
export interface PinnedFetchDeps {
  /** Replaced in tests; the default is the system resolver, asked for every address, in the order it returned them. */
  resolve?: (hostname: string) => Promise<Answer>;
  /** Replaced in tests that must connect to a local server; the default is the guard's own address rules. */
  check?: (address: string, family: 4 | 6) => SsrfCheckResult;
  transports?: { http: typeof http.request; https: typeof https.request };
}
export interface PinnedFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** The body is cut here rather than read without limit. */
  maxBodyBytes?: number;
}

export const DEFAULT_MAX_BODY_BYTES = 4_000_000;

const defaultResolve = async (hostname: string): Promise<Answer> => dns.promises.lookup(hostname, { all: true, verbatim: true });

async function resolveChecked(url: URL, deps: PinnedFetchDeps): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const check = deps.check ?? checkResolvedAddress;
  let answers: Answer;
  const literal = net.isIP(hostname);
  if (literal) {
    answers = [{ address: hostname, family: literal }];
  } else {
    try {
      answers = await (deps.resolve ?? defaultResolve)(hostname);
    } catch {
      throw new SsrfBlockedError("the hostname did not resolve");
    }
  }
  if (!answers || answers.length === 0) throw new SsrfBlockedError("the hostname resolved to no address");
  for (const { address, family } of answers) {
    const verdict = check(address, family === 6 ? 6 : 4);
    if (!verdict.allowed) throw new SsrfBlockedError(verdict.reason ?? "a non-public address");
  }
  const first = answers[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

function decode(res: IncomingMessage) {
  const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

export async function pinnedFetch(input: string | URL, init: PinnedFetchInit = {}, deps: PinnedFetchDeps = {}): Promise<Response> {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new SsrfBlockedError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfBlockedError("not an http(s) URL");

  const pinned = await resolveChecked(url, deps);
  const secure = url.protocol === "https:";
  const request = (secure ? (deps.transports?.https ?? https.request) : (deps.transports?.http ?? http.request)) as typeof http.request;
  const maxBytes = init.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;

  return new Promise<Response>((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname, // the NAME (or the literal): TLS verifies it and the Host header carries it
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "Accept-Encoding": "identity", ...(init.headers ?? {}) },
        signal: init.signal,
        // The one and only resolution: the answer that was checked. Node asks in two shapes (a single address, or all of them when it tries several families).
        lookup: (_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (options && options.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        },
        ...(secure && !net.isIP(hostname) ? { servername: hostname } : {}),
      } as http.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (k === "content-encoding" || k === "content-length") continue;
            if (Array.isArray(v)) for (const item of v) headers.append(k, item);
            else if (v !== undefined) headers.set(k, v);
          }
          const status = res.statusCode ?? 502;
          const bodyless = status === 204 || status === 205 || status === 304 || (status >= 100 && status < 200);
          const response = new Response(bodyless ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage ?? "", headers });
          Object.defineProperty(response, "url", { value: url.toString() });
          resolve(response);
        };
        const body = decode(res);
        body.on("data", (chunk: Buffer) => {
          if (done) return;
          const room = maxBytes - total;
          if (room <= 0) return;
          const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
          chunks.push(piece);
          total += piece.length;
          if (total >= maxBytes) {
            finish();
            res.destroy();
          }
        });
        body.on("end", finish);
        body.on("error", (err) => (done ? undefined : (done = true, reject(err))));
        res.on("error", (err) => (done ? undefined : (done = true, reject(err))));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
