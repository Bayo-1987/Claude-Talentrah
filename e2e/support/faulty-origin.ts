/**
 * A real HTTP origin on its own port that forwards to the app under test and can be told to misbehave for chosen requests: answer a real 500,
 * or drop the connection (what a dead network looks like to a service worker's fetch). It exists because a service worker's own fetch() cannot
 * be intercepted by Playwright's route(), and the app has no route that answers a navigation with a 5xx on demand; a separate origin gets its
 * own worker registration, so the worker under test runs unmodified against a server that really fails.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Fault = "pass" | "500" | "drop";

export interface FaultyOrigin {
  /** `http://localhost:<port>`: localhost, so it is a secure context and can register a worker. */
  url: string;
  /** Request paths (with query) that reached the proxy, in order. */
  hits: string[];
  /** Decide, per request, how it is answered. Default: pass. */
  fault: (req: IncomingMessage) => Fault;
  close: () => Promise<void>;
}

export async function startFaultyOrigin(upstream: { host: string; port: number }): Promise<FaultyOrigin> {
  const origin: FaultyOrigin = { url: "", hits: [], fault: () => "pass", close: async () => undefined };
  const server: Server = createServer((req, res) => {
    origin.hits.push(req.url ?? "");
    const fault = origin.fault(req);
    if (fault === "500") {
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Server error</title><h1>The origin failed on purpose</h1>");
      return;
    }
    if (fault === "drop") {
      req.socket.destroy();
      return;
    }
    const up = httpRequest({ host: upstream.host, port: upstream.port, path: req.url, method: req.method, headers: req.headers }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin.url = `http://localhost:${(server.address() as AddressInfo).port}`;
  origin.close = () => new Promise((resolve) => server.close(() => resolve()));
  return origin;
}
