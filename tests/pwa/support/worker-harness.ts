/**
 * Runs the REAL service worker script text inside a fake worker global scope: no mocks of the code under test, only a recording `caches`,
 * `fetch`, `registration` and `clients` around it. Node's own Request, Response and URL are the real ones.
 */
import vm from "node:vm";

export const ORIGIN = "https://www.talentrah.com";

export interface FakeCacheStore {
  /** Every cache name that was opened, in order. */
  opened: string[];
  /** Cache name -> URLs added via add() or put(), in order. */
  stored: Record<string, string[]>;
  /** Which write API stored it. */
  writes: { cache: string; api: "add" | "put" | "addAll"; url: string }[];
  deleted: string[];
  /** Names currently "existing" (tests seed old ones to see them deleted). */
  names: Set<string>;
  /** What match() answers for a URL, by cache name. */
  responses: Map<string, Response>;
}

export interface Worker {
  listeners: Record<string, (event: unknown) => void>;
  caches: FakeCacheStore;
  calls: { skipWaiting: number; claim: number; unregister: number; preloadEnable: number; navigate: number };
  /** Resolve/reject the next fetch() calls: set before dispatching a fetch event. */
  fetchImpl: { current: (req: Request) => Promise<Response> };
  fetched: Request[];
  fetchEvent(init: FetchInit): FetchResult;
  runInstall(): Promise<void>;
  runActivate(): Promise<void>;
  /** Added for push (U3): everything the push and notificationclick handlers did, and a way to dispatch those events. */
  shown: { title: string; options: Record<string, unknown> }[];
  opened: string[];
  focused: string[];
  closedNotifications: number;
  badge: { set: number[]; cleared: number };
  /** Ordered record of subscription and registration calls, for "unsubscribe before unregister". */
  log: string[];
  pushEvent(init?: PushInit): Promise<void>;
  clickEvent(init: ClickInit): Promise<void>;
}

export interface PushInit {
  /** A string is the raw body (json() parses it); an object is JSON.stringify'd; "none" is an event with no data; "throw" is data whose json() throws. */
  data?: string | object | "none" | "throw";
}

export interface ClickInit {
  /** The notification's own data.path, as the push handler stored it (or anything a hostile payload put there). */
  path?: unknown;
  /** The whole notification.data, when a test needs something other than { path }. */
  data?: unknown;
}

export interface WorkerOptions {
  cachedOffline?: boolean;
  /** Open window clients that matchAll() answers with; omitted keeps the original single client with only navigate(). */
  windows?: { url: string }[];
  /** false: the Badging API is missing on the worker's navigator. "set-only": setAppBadge exists, clearAppBadge does not. "throws": both exist and both reject. */
  badging?: boolean | "set-only" | "throws";
  /** When present the registration has a pushManager, with or without a current subscription. */
  pushManager?: { subscribed: boolean; getSubscriptionRejects?: boolean };
}

export interface FetchInit {
  url: string;
  mode?: "navigate" | "no-cors" | "cors" | "same-origin";
  method?: string;
  destination?: string;
  headers?: Record<string, string>;
  preload?: Promise<Response | undefined> | undefined;
}

export interface FetchResult {
  /** true when the worker called respondWith (it intercepted). */
  intercepted: boolean;
  /** The promise handed to respondWith, if any. */
  response: Promise<Response> | undefined;
}

export function loadWorker(source: string, opts: WorkerOptions = {}): Worker {
  const cacheStore: FakeCacheStore = { opened: [], stored: {}, writes: [], deleted: [], names: new Set(), responses: new Map() };
  const calls = { skipWaiting: 0, claim: 0, unregister: 0, preloadEnable: 0, navigate: 0 };
  const listeners: Record<string, (event: unknown) => void> = {};
  const fetched: Request[] = [];
  const shown: Worker["shown"] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const badge = { set: [] as number[], cleared: 0 };
  const log: string[] = [];
  const state = { closedNotifications: 0 };
  const fetchImpl = { current: (async () => new Response("net", { status: 200 })) as (req: Request) => Promise<Response> };

  const openCache = async (name: string) => {
    cacheStore.opened.push(name);
    cacheStore.names.add(name);
    cacheStore.stored[name] ??= [];
    const urlOf = (r: Request | string) => new URL(typeof r === "string" ? r : r.url, ORIGIN).pathname;
    return {
      async add(r: Request | string) {
        cacheStore.stored[name].push(urlOf(r));
        cacheStore.writes.push({ cache: name, api: "add", url: urlOf(r) });
      },
      async addAll(rs: (Request | string)[]) {
        for (const r of rs) {
          cacheStore.stored[name].push(urlOf(r));
          cacheStore.writes.push({ cache: name, api: "addAll", url: urlOf(r) });
        }
      },
      async put(r: Request | string) {
        cacheStore.stored[name].push(urlOf(r));
        cacheStore.writes.push({ cache: name, api: "put", url: urlOf(r) });
      },
      async match(r: Request | string) {
        if (urlOf(r) === "/offline" && opts.cachedOffline !== false) return cacheStore.responses.get(name) ?? new Response("OFFLINE PAGE", { status: 200 });
        return undefined;
      },
    };
  };

  const scope = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {
      calls.skipWaiting++;
    },
    clients: {
      claim: async () => {
        calls.claim++;
      },
      matchAll: async () =>
        opts.windows
          ? opts.windows.map((w) => ({
              url: w.url,
              focus: async () => {
                focused.push(w.url);
              },
            }))
          : [{ navigate: async () => calls.navigate++ }],
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
    navigator: {
      ...(opts.badging === false
        ? {}
        : opts.badging === "throws"
          ? {
              setAppBadge: async () => {
                throw new Error("badge refused");
              },
              clearAppBadge: async () => {
                throw new Error("badge refused");
              },
            }
          : {
            setAppBadge: async (n: number) => {
              badge.set.push(n);
            },
            ...(opts.badging === "set-only"
              ? {}
              : {
                  clearAppBadge: async () => {
                    badge.cleared++;
                  },
                }),
          }),
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
      ...(opts.pushManager
        ? {
            pushManager: {
              getSubscription: async () =>
                opts.pushManager!.getSubscriptionRejects
                  ? Promise.reject(new Error("getSubscription refused"))
                  : opts.pushManager!.subscribed
                  ? {
                      unsubscribe: async () => {
                        log.push("unsubscribe");
                        return true;
                      },
                    }
                  : null,
            },
          }
        : {}),
      unregister: async () => {
        log.push("unregister");
        calls.unregister++;
        return true;
      },
      navigationPreload: {
        enable: async () => {
          calls.preloadEnable++;
        },
      },
    },
  };

  const caches = {
    open: openCache,
    keys: async () => [...cacheStore.names],
    delete: async (name: string) => {
      cacheStore.deleted.push(name);
      return cacheStore.names.delete(name);
    },
    match: async () => undefined,
  };

  const sandbox = {
    self: scope,
    caches,
    fetch: async (req: Request) => {
      fetched.push(req);
      return fetchImpl.current(req);
    },
    // A worker resolves a relative URL against its own location; Node's Request does not, so do that here.
    Request: class extends Request {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" && input.startsWith("/") ? `${ORIGIN}${input}` : input, init);
      }
    },
    Response,
    URL,
    Promise,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: "sw.js" });

  const run = async (type: "install" | "activate") => {
    const waits: Promise<unknown>[] = [];
    listeners[type]?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners[type]?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)) });
    await Promise.all(waits);
  };

  return {
    listeners,
    shown,
    opened,
    focused,
    badge,
    log,
    get closedNotifications() {
      return state.closedNotifications;
    },
    pushEvent: (init = {}) => {
      const d = init.data;
      const data =
        d === "none" || d === undefined
          ? null
          : {
              json: () => {
                if (d === "throw") throw new SyntaxError("Unexpected token");
                return typeof d === "string" ? JSON.parse(d) : d;
              },
              text: () => (typeof d === "string" ? d : JSON.stringify(d)),
            };
      return dispatch("push", { data });
    },
    clickEvent: (init) =>
      dispatch("notificationclick", {
        notification: {
          data: init.data !== undefined ? init.data : { path: init.path },
          close: () => {
            state.closedNotifications++;
          },
        },
      }),
    caches: cacheStore,
    calls,
    fetchImpl,
    fetched,
    runInstall: () => run("install"),
    runActivate: () => run("activate"),
    fetchEvent(init) {
      const absolute = init.url.startsWith("http") ? init.url : `${ORIGIN}${init.url}`;
      const request = new Request(absolute, { method: init.method ?? "GET", headers: init.headers });
      // A real navigation Request cannot be constructed with mode "navigate"; the worker only READS these fields, so present them.
      const shaped = Object.create(request, {
        mode: { value: init.mode ?? "navigate" },
        destination: { value: init.destination ?? "document" },
      }) as Request;
      let response: Promise<Response> | undefined;
      let intercepted = false;
      const event = {
        request: shaped,
        preloadResponse: init.preload ?? Promise.resolve(undefined),
        respondWith(p: Promise<Response> | Response) {
          intercepted = true;
          response = Promise.resolve(p);
        },
        waitUntil() {},
      };
      listeners.fetch?.(event);
      return { intercepted, response };
    },
  };
}
