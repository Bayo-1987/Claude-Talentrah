import { PUSH_WORKER_VERSION, WORKER_VERSION_REQUEST } from "@/lib/pwa/push/worker-version";
/**
 * The two scripts /sw.js can serve, as plain JavaScript text. Kept as strings (not a build step, not a dependency) so the route can answer with
 * them and tests/pwa/service-worker.test.ts can run the REAL text in a fake worker scope.
 *
 * THE WORKER IS A DECISION TABLE, NOT A CACHE. It owns exactly one cache and that cache holds exactly one thing, the /offline page.
 *
 *   a GET navigation, same-origin, not an iframe, not under /api, /billing, /embed or /data-export
 *       -> respondWith(navigation preload if there is one, else fetch). If that REJECTS (no network at all), the cached /offline.
 *          Any HTTP response, 2xx through 5xx, goes back unchanged. NOTHING is stored.
 *   any other navigation (a form POST, /api/*, /billing/*, /embed/*, /data-export/*, an iframe)  -> not intercepted
 *   everything else (scripts, styles, images, fonts, fetch()/XHR, Server Actions, RSC and prefetch, range requests, any cross-origin request)
 *       -> not intercepted
 *
 * "Not intercepted" means the worker never calls respondWith, so the browser handles the request exactly as if no worker existed.
 *
 * DELIBERATE EXTRAS beyond the table's literal wording, each the safer side: the exact paths /api, /billing, /embed and /data-export are
 * passed through as well as their children (a bare "/billing" is a payments page, and "/api" and "/embed" are the prefixes themselves);
 * /apix, /billing-x and /embedded are NOT excluded, because they are different paths.
 *
 * /data-export/* IS PASS-THROUGH because a data-export link is single use: if the worker answered a failed attempt with the offline page, the
 * person would be told to retry a link that is already spent. (The same reason /billing/callback is never intercepted: a return from a
 * payment must reach the server exactly once, untouched.)
 *
 * NOTHING IS STORED, and not because of a rule the script could check: a service worker cannot read Set-Cookie (it is a forbidden response
 * header name), so "never cache a response that sets a cookie" cannot be enforced by looking at headers. It is enforced by never caching a
 * response at all. That also means no stale credits balance, no tracker page surviving a sign-out and nothing to leak between two people on a
 * shared phone: the worker's one cache holds a page that is identical for everyone.
 *
 * PUSH (U3, behind flags that ship OFF: nothing sends a push until the sender exists and a flag is turned on). Two more listeners, between the "push handlers" markers
 * below. The push handler always shows a notification (a generic one for an empty or bad payload), sets the app badge from a NUMERIC `badge` field only, and uses
 * neither the network nor the cache. A click opens a path only if it is same-origin, starts with one "/", is not on the pass-through list, and carries no control
 * character, also after percent-decoding (twice); anything else opens /dashboard. The worker still stores nothing but /offline.
 *
 * WHAT THE SERVED TEXT CARRIES. Only code, apart from the one comment that says why nothing is stored (tests/pwa/service-worker.test.ts pins it). The explanations of the
 * parts of the script live here, outside the string, so they cost the person no bytes:
 *   - PASS_THROUGH is matched on whole path segments: /apix and /billing-x are NOT in it.
 *   - install fetches /offline fresh from the network (not the HTTP cache), so a new worker version stores the page it was released with. It is the only write the script makes.
 *   - safePath returns a same-origin path the app really serves, or /dashboard. It also checks the percent-decoded forms (twice), because the server decodes before it routes; a
 *     second decode that fails is simply not a second form.
 *   - the origin check in safePath is DEFENCE IN DEPTH that no input reaches: a path that starts with exactly one "/" and has passed the "//" and backslash checks, raw and
 *     decoded, cannot resolve to another origin. It stays so a future change to those checks cannot turn this into an open redirect. (The mutant that removes it survives, and
 *     that is accepted as an equivalent mutant: there is deliberately no test for it.)
 *   - the badge is a whole number from the payload and nothing else; anything else leaves the badge alone.
 *   - the kill worker unsubscribes this browser's push subscription first: a subscription outlives the worker that created it, so unregistering alone would leave the push service
 *     holding an endpoint that nothing answers. Every step is guarded; none may stop the unregister, or the kill switch would fail open.
 *
 * AN UPDATE ACTIVATES ON THE NEXT LOAD. The normal worker never takes over a running page, so a half-finished form is not swapped under a
 * person; only the self-destruct worker below does that. It enables navigation preload on activate (so the navigation request starts while the
 * worker boots instead of after it) and claims the open page so the page that registered it is controlled at once.
 *
 * The cache name is versioned. Bump the number to retire the old cache: activate deletes every cache that is not this one.
 */
export const OFFLINE_CACHE_NAME = "talentrah-offline-v1";
export const OFFLINE_URL = "/offline";

/** The prefix every cache this app ever created starts with; the page uses it to delete only its own when the kill switch is on. */
export const CACHE_PREFIX = "talentrah-offline-";

export const WORKER_SOURCE = `"use strict";
// This worker stores NOTHING but the /offline page. It cannot do better: a worker cannot read Set-Cookie (a forbidden response header name),
// so a rule like "never cache a response that sets a cookie" cannot be enforced here. Not caching responses is the enforcement.
var CACHE = ${JSON.stringify(OFFLINE_CACHE_NAME)};
var OFFLINE_URL = ${JSON.stringify(OFFLINE_URL)};
var PASS_THROUGH = ["/api", "/billing", "/embed", "/data-export"];

function isPassThroughPath(pathname) {
  for (var i = 0; i < PASS_THROUGH.length; i++) {
    var p = PASS_THROUGH[i];
    if (pathname === p || pathname.indexOf(p + "/") === 0) return true;
  }
  return false;
}

function shouldAnswer(request) {
  if (request.mode !== "navigate") return false;
  if (request.method !== "GET") return false;
  var dest = request.destination;
  if (dest === "iframe" || dest === "frame" || dest === "embed" || dest === "object") return false;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return !isPassThroughPath(url.pathname);
}

var DEFAULT_PATH = "/dashboard";

function hasControlChar(text) {
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function safePath(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2000) return DEFAULT_PATH;
  if (raw.charAt(0) !== "/" || raw.charAt(1) === "/" || raw.charAt(1) === "\\\\") return DEFAULT_PATH;
  var forms = [raw];
  try {
    var once = decodeURIComponent(raw);
    forms.push(once);
    try { forms.push(decodeURIComponent(once)); } catch (e) {}
  } catch (e) {
    return DEFAULT_PATH;
  }
  for (var i = 0; i < forms.length; i++) {
    var form = forms[i];
    if (hasControlChar(form) || form.charAt(0) !== "/" || form.charAt(1) === "/" || form.charAt(1) === "\\\\") return DEFAULT_PATH;
  }
  var url;
  try { url = new URL(raw, self.location.origin); } catch (e) { return DEFAULT_PATH; }
  if (url.origin !== self.location.origin) return DEFAULT_PATH;
  var decodedPath = url.pathname;
  try { decodedPath = decodeURIComponent(url.pathname); } catch (e) { return DEFAULT_PATH; }
  if (isPassThroughPath(url.pathname) || isPassThroughPath(decodedPath)) return DEFAULT_PATH;
  return url.pathname + url.search + url.hash;
}

function readPayload(event) {
  var data = null;
  try { data = event.data ? event.data.json() : null; } catch (e) { data = null; }
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function textOr(value, fallback, max) {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : fallback;
}

function badgeFrom(value) {
  return typeof value === "number" && isFinite(value) && value >= 0 && value <= 99999 && value === Math.floor(value) ? value : null;
}

function applyBadge(count) {
  var nav = self.navigator;
  if (count === null || !nav) return Promise.resolve();
  try {
    if (count > 0) return typeof nav.setAppBadge === "function" ? Promise.resolve(nav.setAppBadge(count)).catch(function () {}) : Promise.resolve();
    return typeof nav.clearAppBadge === "function" ? Promise.resolve(nav.clearAppBadge()).catch(function () {}) : Promise.resolve();
  } catch (e) {
    return Promise.resolve();
  }
}

self.addEventListener("push", function (event) {
  var data = readPayload(event);
  var options = {
    body: textOr(data.body, "You have a new notification.", 200),
    data: { path: safePath(data.path) },
    icon: "/icons/talentrah-mark-any-192.png"
  };
  if (typeof data.tag === "string" && data.tag.length > 0) options.tag = data.tag.slice(0, 64);
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(textOr(data.title, "Talentrah", 100), options),
      applyBadge(badgeFrom(data.badge))
    ])
  );
});

self.addEventListener("notificationclick", function (event) {
  var notification = event.notification;
  if (notification && typeof notification.close === "function") notification.close();
  var path = safePath(notification && notification.data && typeof notification.data === "object" ? notification.data.path : undefined);
  var target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        if (windows[i].url === target && typeof windows[i].focus === "function") return windows[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

var PUSH_WORKER_VERSION = ${JSON.stringify(PUSH_WORKER_VERSION)};

self.addEventListener("message", function (event) {
  var data = event && event.data;
  if (!data || typeof data !== "object" || data.type !== ${JSON.stringify(WORKER_VERSION_REQUEST)}) return;
  var port = event.ports && event.ports[0];
  if (port && typeof port.postMessage === "function") port.postMessage(PUSH_WORKER_VERSION);
});

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    Promise.all([
      caches.keys().then(function (names) {
        return Promise.all(
          names.filter(function (name) { return name !== CACHE; }).map(function (name) { return caches.delete(name); })
        );
      }),
      self.registration.navigationPreload ? self.registration.navigationPreload.enable() : Promise.resolve(),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", function (event) {
  if (!shouldAnswer(event.request)) return;
  event.respondWith(
    Promise.resolve(event.preloadResponse)
      .then(function (preloaded) { return preloaded || fetch(event.request); })
      .catch(function () {
        return caches.open(CACHE)
          .then(function (cache) { return cache.match(OFFLINE_URL); })
          .then(function (page) { return page || Response.error(); });
      })
  );
});
`;

/**
 * The self-destruct worker, served instead of the normal one when PWA_KILL is "1". For a browser that fetches /sw.js during its background
 * update check: it takes over at once, deletes every cache, and unregisters itself. It does NOT reload or navigate any window (no force-reload
 * at all); windows pick up the unregistered state on their next navigation. It has no fetch handler, so while it lives it answers nothing.
 * The page stops registering when the kill switch is on (src/lib/pwa/bootstrap.ts), so nothing reinstalls it.
 */
export const KILL_SOURCE = `"use strict";
self.addEventListener("install", function () {
  self.skipWaiting();
});
function unsubscribePush() {
  return Promise.resolve()
    .then(function () {
      var manager = self.registration.pushManager;
      if (!manager || typeof manager.getSubscription !== "function") return false;
      return manager.getSubscription().then(function (subscription) {
        return subscription ? subscription.unsubscribe() : false;
      });
    })
    .catch(function () {
      return false;
    });
}
self.addEventListener("activate", function (event) {
  event.waitUntil(
    unsubscribePush()
      .then(function () {
        return caches.keys();
      })
      .then(function (names) {
        return Promise.all(names.map(function (name) { return caches.delete(name); }));
      })
      .then(function () {
        return self.registration.unregister();
      })
  );
});
`;
